import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page, chromium } from 'playwright-core';
import { detectBrowserExecutable, validateBrowserUrl } from './browserValidation';

export type BrowserActionKind = 'click' | 'fill' | 'press' | 'select' | 'wait';

export interface BrowserTarget {
  id: string;
  role: string;
  name: string;
  ordinal: number;
  tag: string;
  inputType?: string;
  disabled: boolean;
}

export interface BrowserUseState {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  status: 'ready' | 'consumed' | 'failed';
  url: string;
  title: string;
  visibleTextExcerpt: string;
  targets: BrowserTarget[];
  screenshotPath: string;
  reportPath: string;
  createdAt: string;
  consumedAt?: string;
  action?: { kind: BrowserActionKind; targetId?: string; value?: string; key?: string };
  previousStateId?: string;
  failureReason?: string;
}

export class BrowserUseRunner {
  private readonly root: string;
  private readonly sessionsDir: string;
  private readonly profileDir: string;

  constructor(workspaceRoot: string) {
    this.root = fs.realpathSync(workspaceRoot);
    this.sessionsDir = path.join(this.root, '.forge', 'browser-sessions');
    this.profileDir = path.join(this.sessionsDir, 'profile');
  }

  public async inspect(options: { url: string; sessionId: string; timeoutMs?: number }): Promise<{ success: boolean; output: string; state: BrowserUseState }> {
    const policy = validateBrowserUrl(options.url);
    if (!policy.valid || !policy.normalizedUrl) return this.failed(options.sessionId, options.url, policy.reason || 'Browser URL rejected.');
    const timeoutMs = boundedTimeout(options.timeoutMs);
    let context: BrowserContext | undefined;
    try {
      context = await this.launch(timeoutMs);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(policy.normalizedUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
      const state = await this.capture(page, options.sessionId);
      return { success: true, output: renderState(state), state };
    } catch (error: any) {
      return this.failed(options.sessionId, policy.normalizedUrl, `Browser inspection failed: ${String(error?.message || error).slice(0, 1_000)}`);
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  public async act(options: { stateId: string; action: BrowserActionKind; targetId?: string; value?: string; key?: string; timeoutMs?: number }): Promise<{ success: boolean; output: string; state: BrowserUseState }> {
    const previous = this.loadState(options.stateId);
    if (!previous || previous.status !== 'ready') return this.failed('unknown', '', 'Browser action rejected: state is missing, stale, or already consumed.');
    const policy = validateBrowserUrl(previous.url);
    if (!policy.valid || !policy.normalizedUrl) return this.failed(previous.sessionId, previous.url, policy.reason || 'Browser URL rejected.');
    const action = normalizeAction(options);
    const target = action.kind === 'wait' ? undefined : previous.targets.find(item => item.id === action.targetId);
    if (action.kind !== 'wait' && !target) return this.failed(previous.sessionId, previous.url, 'Browser action rejected: target ID is not present in the inspected state.');
    previous.status = 'consumed';
    previous.consumedAt = new Date().toISOString();
    previous.action = action;
    this.persist(previous);
    const timeoutMs = boundedTimeout(options.timeoutMs);
    let context: BrowserContext | undefined;
    try {
      context = await this.launch(timeoutMs);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(policy.normalizedUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
      if (action.kind === 'wait') {
        await page.waitForTimeout(Math.min(5_000, Math.max(100, Number(action.value) || 500)));
      } else {
        const locator = page.getByRole(target!.role as any, { name: target!.name, exact: true }).nth(target!.ordinal);
        if (await locator.count() !== 1) throw new Error('The inspected target no longer resolves uniquely. Inspect the page again.');
        if (action.kind === 'click') await locator.click({ timeout: timeoutMs });
        else if (action.kind === 'fill') await locator.fill(action.value || '', { timeout: timeoutMs });
        else if (action.kind === 'press') await locator.press(action.key || 'Enter', { timeout: timeoutMs });
        else if (action.kind === 'select') await locator.selectOption({ label: action.value || '' }, { timeout: timeoutMs });
      }
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5_000) }).catch(() => undefined);
      const state = await this.capture(page, previous.sessionId, previous.id, action);
      return { success: true, output: `Browser action ${action.kind} completed.\n${renderState(state)}`, state };
    } catch (error: any) {
      return this.failed(previous.sessionId, previous.url, `Browser action failed: ${String(error?.message || error).slice(0, 1_000)}`, previous.id, action);
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  private async launch(timeoutMs: number): Promise<BrowserContext> {
    const executablePath = detectBrowserExecutable();
    if (!executablePath) throw new Error('No supported Edge or Chrome executable was found.');
    fs.mkdirSync(this.profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(this.profileDir, { executablePath, headless: true, viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(timeoutMs);
    return context;
  }

  private async capture(page: Page, sessionId: string, previousStateId?: string, action?: BrowserUseState['action']): Promise<BrowserUseState> {
    const id = `browser-state-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const raw = await page.locator('button,a,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="combobox"]').evaluateAll(elements => elements.slice(0, 200).map((element: any) => {
      const tag = String(element.tagName || '').toLowerCase();
      const inputType = String(element.type || '').toLowerCase();
      const role = element.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' && ['checkbox', 'radio', 'button', 'submit'].includes(inputType) ? inputType === 'submit' ? 'button' : inputType : tag === 'input' ? 'textbox' : 'button');
      const name = String(element.getAttribute('aria-label') || element.innerText || element.placeholder || element.value || element.name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { role, name, tag, inputType: inputType || undefined, disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true') };
    }));
    const counts = new Map<string, number>();
    const targets: BrowserTarget[] = [];
    for (const item of raw) {
      if (!item.name || item.disabled) continue;
      const key = `${item.role}\0${item.name}`;
      const ordinal = counts.get(key) || 0;
      counts.set(key, ordinal + 1);
      targets.push({ ...item, ordinal, id: `bt-${crypto.createHash('sha256').update(`${id}\0${key}\0${ordinal}`).digest('hex').slice(0, 16)}` });
    }
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const screenshotPath = path.join(this.sessionsDir, `${id}.png`);
    const reportPath = path.join(this.sessionsDir, `${id}.json`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const visibleTextExcerpt = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 4_000);
    const state: BrowserUseState = {
      schemaVersion: 1, id, sessionId: String(sessionId || 'unknown').slice(0, 160), status: 'ready', url: page.url(), title: (await page.title()).slice(0, 500),
      visibleTextExcerpt, targets: targets.slice(0, 100), screenshotPath: relative(this.root, screenshotPath), reportPath: relative(this.root, reportPath), createdAt: new Date().toISOString(),
      previousStateId, action
    };
    this.persist(state);
    return state;
  }

  private loadState(stateId: string): BrowserUseState | null {
    if (!/^browser-state-[a-zA-Z0-9-]{8,100}$/.test(String(stateId || ''))) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, `${stateId}.json`), 'utf8')) as BrowserUseState;
      if (parsed.schemaVersion !== 1 || parsed.id !== stateId || !Array.isArray(parsed.targets) || parsed.targets.length > 100) return null;
      return parsed;
    } catch { return null; }
  }

  private failed(sessionId: string, url: string, failureReason: string, previousStateId?: string, action?: BrowserUseState['action']): { success: false; output: string; state: BrowserUseState } {
    const id = `browser-state-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const state: BrowserUseState = { schemaVersion: 1, id, sessionId, status: 'failed', url, title: '', visibleTextExcerpt: '', targets: [], screenshotPath: '', reportPath: relative(this.root, path.join(this.sessionsDir, `${id}.json`)), createdAt: new Date().toISOString(), previousStateId, action, failureReason };
    this.persist(state);
    return { success: false, output: failureReason, state };
  }

  private persist(state: BrowserUseState): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const reportPath = path.join(this.sessionsDir, `${state.id}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(state, null, 2), 'utf8');
    fs.copyFileSync(reportPath, path.join(this.sessionsDir, 'latest-browser-state.json'));
    if (state.screenshotPath) fs.copyFileSync(path.join(this.root, state.screenshotPath), path.join(this.sessionsDir, 'latest-browser-state.png'));
  }
}

function normalizeAction(options: { action: BrowserActionKind; targetId?: string; value?: string; key?: string }): NonNullable<BrowserUseState['action']> {
  const kind = options.action;
  if (!['click', 'fill', 'press', 'select', 'wait'].includes(kind)) throw new Error('Unsupported browser action.');
  const value = options.value === undefined ? undefined : String(options.value).replace(/\u0000/g, '').slice(0, 2_000);
  const key = options.key === undefined ? undefined : String(options.key).replace(/[^a-zA-Z0-9+_-]/g, '').slice(0, 60);
  if (kind === 'fill' && value === undefined) throw new Error('browser_action fill requires value.');
  if (kind === 'press' && !key) throw new Error('browser_action press requires key.');
  if (kind === 'select' && value === undefined) throw new Error('browser_action select requires value.');
  return { kind, targetId: options.targetId ? String(options.targetId).slice(0, 100) : undefined, value, key };
}

function boundedTimeout(value?: number): number { return Math.max(1_000, Math.min(30_000, Number(value) || 15_000)); }
function relative(root: string, target: string): string { return path.relative(root, target).replace(/\\/g, '/'); }
function renderState(state: BrowserUseState): string {
  const targets = state.targets.map(item => `${item.id} role=${item.role} name=${JSON.stringify(item.name)}${item.inputType ? ` type=${item.inputType}` : ''}`).join('\n') || '(no actionable targets)';
  return `Browser state ${state.id}\nURL: ${state.url}\nTitle: ${state.title}\nVisible text: ${state.visibleTextExcerpt}\nTargets:\n${targets}\nScreenshot: ${state.screenshotPath}`;
}
