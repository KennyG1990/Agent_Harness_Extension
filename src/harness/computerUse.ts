import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ComputerActionKind = 'invoke' | 'set_value' | 'focus';

export interface ComputerUsePolicy { enabled: boolean; allowedWindows: string[]; }
export interface ComputerTarget { id: string; name: string; controlType: string; automationId: string; className: string; ordinal: number; enabled: boolean; patterns: string[]; }
export interface ComputerUseState {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  status: 'ready' | 'consumed' | 'failed';
  windowTitle: string;
  targets: ComputerTarget[];
  screenshotPath: string;
  reportPath: string;
  createdAt: string;
  consumedAt?: string;
  previousStateId?: string;
  action?: { kind: ComputerActionKind; targetId: string; value?: string };
  failureReason?: string;
}

export class ComputerUseRunner {
  private readonly root: string;
  private readonly sessionsDir: string;

  constructor(workspaceRoot: string, private readonly policy: ComputerUsePolicy) {
    this.root = fs.realpathSync(workspaceRoot);
    this.sessionsDir = path.join(this.root, '.forge', 'computer-sessions');
  }

  public async inspect(options: { windowTitle: string; sessionId: string }): Promise<{ success: boolean; output: string; state: ComputerUseState }> {
    const allowed = this.validateWindow(options.windowTitle);
    if (!allowed.valid) return this.failed(options.sessionId, options.windowTitle, allowed.reason!);
    const id = createId();
    const screenshot = path.join(this.sessionsDir, `${id}.png`);
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      const result = await runUia({ operation: 'inspect', windowTitle: allowed.title, screenshot });
      const counts = new Map<string, number>();
      const targets = (result.targets || []).slice(0, 200).map((item: any) => {
        const key = [item.controlType, item.name, item.automationId, item.className].join('\0');
        const ordinal = counts.get(key) || 0;
        counts.set(key, ordinal + 1);
        return { ...item, ordinal, id: `ct-${crypto.createHash('sha256').update(`${id}\0${key}\0${ordinal}`).digest('hex').slice(0, 16)}` } as ComputerTarget;
      });
      const state: ComputerUseState = { schemaVersion: 1, id, sessionId: bounded(options.sessionId, 160), status: 'ready', windowTitle: result.windowTitle, targets, screenshotPath: relative(this.root, screenshot), reportPath: relative(this.root, path.join(this.sessionsDir, `${id}.json`)), createdAt: new Date().toISOString() };
      this.persist(state);
      return { success: true, output: renderState(state), state };
    } catch (error: any) { return this.failed(options.sessionId, allowed.title, `Computer inspection failed: ${bounded(error?.message || error, 1000)}`); }
  }

  public async act(options: { stateId: string; action: ComputerActionKind; targetId: string; value?: string }): Promise<{ success: boolean; output: string; state: ComputerUseState }> {
    const previous = this.load(options.stateId);
    if (!previous || previous.status !== 'ready') return this.failed('unknown', '', 'Computer action rejected: state is missing, stale, or already consumed.');
    const allowed = this.validateWindow(previous.windowTitle);
    if (!allowed.valid) return this.failed(previous.sessionId, previous.windowTitle, allowed.reason!);
    if (!['invoke', 'set_value', 'focus'].includes(options.action)) return this.failed(previous.sessionId, previous.windowTitle, 'Computer action rejected: unsupported action.');
    const target = previous.targets.find(item => item.id === options.targetId);
    if (!target) return this.failed(previous.sessionId, previous.windowTitle, 'Computer action rejected: target ID is not present in the inspected state.');
    if (options.action === 'set_value' && typeof options.value !== 'string') return this.failed(previous.sessionId, previous.windowTitle, 'Computer set_value requires a string value.');
    previous.status = 'consumed';
    previous.consumedAt = new Date().toISOString();
    previous.action = { kind: options.action, targetId: target.id, value: options.value === undefined ? undefined : bounded(options.value, 2000) };
    this.persist(previous);
    try {
      await runUia({ operation: 'action', windowTitle: allowed.title, target, action: options.action, value: previous.action.value });
      const next = await this.inspect({ windowTitle: allowed.title, sessionId: previous.sessionId });
      next.state.previousStateId = previous.id;
      next.state.action = previous.action;
      this.persist(next.state);
      return { success: next.success, output: `Computer action ${options.action} completed.\n${next.output}`, state: next.state };
    } catch (error: any) { return this.failed(previous.sessionId, previous.windowTitle, `Computer action failed: ${bounded(error?.message || error, 1000)}`, previous.id, previous.action); }
  }

  private validateWindow(requested: string): { valid: boolean; title: string; reason?: string } {
    if (process.platform !== 'win32') return { valid: false, title: '', reason: 'Computer use is available only on Windows.' };
    if (!this.policy.enabled) return { valid: false, title: '', reason: 'Computer use is disabled by forge.computerUseEnabled.' };
    const title = bounded(requested, 200).trim();
    if (!title) return { valid: false, title, reason: 'computer_inspect requires a windowTitle.' };
    const match = this.policy.allowedWindows.map(item => bounded(item, 200).trim()).filter(Boolean).find(item => item.toLocaleLowerCase() === title.toLocaleLowerCase());
    return match ? { valid: true, title: match } : { valid: false, title, reason: `Window '${title}' is not in forge.computerUseAllowedWindows.` };
  }

  private load(id: string): ComputerUseState | null {
    if (!/^computer-state-[a-zA-Z0-9-]{8,100}$/.test(String(id || ''))) return null;
    try { const state = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, `${id}.json`), 'utf8')); return state.schemaVersion === 1 && state.id === id && Array.isArray(state.targets) ? state : null; } catch { return null; }
  }

  private failed(sessionId: string, windowTitle: string, failureReason: string, previousStateId?: string, action?: ComputerUseState['action']): { success: false; output: string; state: ComputerUseState } {
    const id = createId();
    const state: ComputerUseState = { schemaVersion: 1, id, sessionId, status: 'failed', windowTitle, targets: [], screenshotPath: '', reportPath: relative(this.root, path.join(this.sessionsDir, `${id}.json`)), createdAt: new Date().toISOString(), previousStateId, action, failureReason };
    this.persist(state);
    return { success: false, output: failureReason, state };
  }

  private persist(state: ComputerUseState): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const report = path.join(this.sessionsDir, `${state.id}.json`);
    fs.writeFileSync(report, JSON.stringify(state, null, 2), 'utf8');
    fs.copyFileSync(report, path.join(this.sessionsDir, 'latest-computer-state.json'));
    if (state.screenshotPath && fs.existsSync(path.join(this.root, state.screenshotPath))) fs.copyFileSync(path.join(this.root, state.screenshotPath), path.join(this.sessionsDir, 'latest-computer-state.png'));
  }
}

function runUia(input: any): Promise<any> {
  const script = String.raw`
$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; Add-Type -AssemblyName System.Drawing
$i=$env:FORGE_UIA_INPUT|ConvertFrom-Json; $root=[System.Windows.Automation.AutomationElement]::RootElement
$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,[string]$i.windowTitle)
$win=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,$cond); if($null -eq $win){throw 'Allowlisted window was not found by exact title.'}
function Props($e){
 $patterns=@($e.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName.Replace('PatternIdentifiers.Pattern','').ToLowerInvariant()})
 [pscustomobject]@{name=[string]$e.Current.Name;controlType=[string]$e.Current.ControlType.ProgrammaticName.Replace('ControlType.','');automationId=[string]$e.Current.AutomationId;className=[string]$e.Current.ClassName;enabled=[bool]$e.Current.IsEnabled;patterns=$patterns}
}
if($i.operation -eq 'inspect'){
 $items=@($win.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Select-Object -First 200|ForEach-Object {Props $_})
 $r=$win.Current.BoundingRectangle; if($r.Width -gt 0 -and $r.Height -gt 0){$bmp=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height);$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bmp.Size);$bmp.Save([string]$i.screenshot,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose()}
 [pscustomobject]@{windowTitle=[string]$win.Current.Name;targets=$items}|ConvertTo-Json -Depth 6 -Compress
} else {
 $matches=@($win.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -eq [string]$i.target.name -and $_.Current.ControlType.ProgrammaticName.Replace('ControlType.','') -eq [string]$i.target.controlType -and $_.Current.AutomationId -eq [string]$i.target.automationId -and $_.Current.ClassName -eq [string]$i.target.className})
 if($matches.Count -le [int]$i.target.ordinal){throw 'Inspected control is stale or missing.'}; $e=$matches[[int]$i.target.ordinal]
 if($i.action -eq 'focus'){$e.SetFocus()} elseif($i.action -eq 'invoke'){$p=$e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);$p.Invoke()} elseif($i.action -eq 'set_value'){$p=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$p.SetValue([string]$i.value)} else {throw 'Unsupported UIA action.'}
 [pscustomobject]@{ok=$true}|ConvertTo-Json -Compress
}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 15000, windowsHide: true, env: { ...process.env, FORGE_UIA_INPUT: JSON.stringify(input) }, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || stdout || error.message).trim()));
    try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error(`UI Automation returned invalid JSON: ${bounded(stdout, 500)}`)); }
  }));
}

function createId(): string { return `computer-state-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }
function bounded(value: any, limit: number): string { return String(value || '').replace(/\u0000/g, '').slice(0, limit); }
function relative(root: string, target: string): string { return path.relative(root, target).replace(/\\/g, '/'); }
function renderState(state: ComputerUseState): string { return `Computer state ${state.id}\nWindow: ${state.windowTitle}\nTargets:\n${state.targets.map(item => `${item.id} type=${item.controlType} name=${JSON.stringify(item.name)} patterns=${item.patterns.join(',')}`).join('\n') || '(no actionable targets)'}\nScreenshot: ${state.screenshotPath}`; }
