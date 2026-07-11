import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { CommandExecutionMetadata, ToolName, ToolProposal } from './types';
import { classifyCommandNetworkIntent } from './commandNetwork';

export interface ToolResult {
  success: boolean;
  output: string;
  diff?: string;
  commandMetadata?: CommandExecutionMetadata;
}

export type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>;

export class WorkspaceTools {
  constructor(private readonly workspaceRootOverride?: string) {}

  public registry(): Record<ToolName, ToolHandler> {
    return {
      repo_search: args => this.repoSearch(String(args.query || '')),
      symbol_search: args => this.symbolSearch(String(args.query || '')),
      read_file: args => this.readFile(String(args.path || '')),
      read_range: args => this.readRange(String(args.path || ''), Number(args.startLine || 1), Number(args.endLine || 1)),
      write_file: args => this.writeFile(String(args.path || ''), String(args.content || '')),
      apply_patch: args => this.applyPatch(String(args.path || ''), String(args.patchContent || '')),
      run_command: args => this.runCommand(String(args.command || '')),
      run_tests: () => this.runCommand('npm run test'),
      get_diff: () => this.getDiff(),
      update_tasks: async () => ({ success: true, output: 'Task graph update handled by harness state.' }),
      update_plan: async () => ({ success: true, output: 'Plan update handled by harness state.' }),
      record_evidence: async () => ({ success: true, output: 'Evidence update handled by harness state.' }),
      declare_success: async () => ({ success: true, output: 'Success declaration accepted for oracle validation.' })
    };
  }

  public async dispatch(proposal: ToolProposal): Promise<ToolResult> {
    const handler = this.registry()[proposal.name];
    if (!handler) {
      return { success: false, output: `Unknown tool: ${proposal.name}` };
    }
    return handler(proposal.arguments || {});
  }

  public getWorkspaceRoot(): string {
    if (this.workspaceRootOverride) {
      return fs.realpathSync(this.workspaceRootOverride);
    }
    const vscode = getVscode();
    if (!vscode) {
      throw new Error('No active workspace folder open in VS Code.');
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      throw new Error('No active workspace folder open in VS Code.');
    }
    return fs.realpathSync(folders[0].uri.fsPath);
  }

  public resolveWorkspacePath(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error(`Access denied: path must be workspace-relative (${relativePath}).`);
    }
    const root = this.getWorkspaceRoot();
    const resolved = path.resolve(root, relativePath);
    let parent = path.dirname(resolved);
    while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
      parent = path.dirname(parent);
    }
    const realParent = fs.existsSync(resolved) ? fs.realpathSync(resolved) : fs.realpathSync(parent);
    const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
    if (realParent !== root && !realParent.startsWith(normalizedRoot)) {
      throw new Error(`Access denied: path '${relativePath}' lies outside the workspace directory.`);
    }
    return resolved;
  }

  public async readFile(relativePath: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolveWorkspacePath(relativePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `File not found: ${relativePath}` };
      }
      return { success: true, output: fs.readFileSync(fullPath, 'utf8') };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  }

  public async readRange(relativePath: string, startLine: number, endLine: number): Promise<ToolResult> {
    const file = await this.readFile(relativePath);
    if (!file.success) {
      return file;
    }
    const lines = file.output.split(/\r?\n/);
    return { success: true, output: lines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine)).join('\n') };
  }

  public async writeFile(relativePath: string, content: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolveWorkspacePath(relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      return { success: true, output: `Wrote ${relativePath}` };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  }

  public async runCommand(command: string): Promise<ToolResult> {
    return new Promise(resolve => {
      const cwd = this.getWorkspaceRoot();
      const timeoutMs = 120000;
      const started = Date.now();
      const sandbox = buildCommandSandbox(cwd, timeoutMs);
      const network = classifyCommandNetworkIntent(command);
      exec(command, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8, env: sandbox.env }, (error: any, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const metadata: CommandExecutionMetadata = {
          cwd,
          timeoutMs,
          durationMs: Date.now() - started,
          exitCode: typeof error?.code === 'number' ? error.code : (error ? 1 : 0),
          signal: typeof error?.signal === 'string' ? error.signal : null,
          sanitizedEnv: true,
          inheritedEnvKeyCount: Object.keys(process.env).length,
          allowedEnvKeys: sandbox.allowedEnvKeys,
          blockedEnvKeys: sandbox.blockedEnvKeys,
          network
        };
        resolve({ success: !error, output: error ? `Command failed: ${error.message}\n${output}` : output, commandMetadata: metadata });
      });
    });
  }

  public async repoSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return { success: false, output: 'Search query is empty.' };
    }
    const root = this.getWorkspaceRoot();
    const vscode = getVscode();
    const files = vscode
      ? await vscode.workspace.findFiles('**/*', '**/{node_modules,out,dist,.git}/**', 250)
      : listWorkspaceFiles(root, () => true, 250).map(fsPath => ({ fsPath }));
    const matches: string[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file.fsPath, 'utf8');
        if (content.toLowerCase().includes(query.toLowerCase())) {
          matches.push(path.relative(root, file.fsPath));
        }
      } catch {
        // Skip binary/unreadable files.
      }
    }
    return { success: true, output: matches.length ? matches.join('\n') : 'No matches.' };
  }

  public async symbolSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return { success: false, output: 'Symbol query is empty.' };
    }
    const root = this.getWorkspaceRoot();
    const vscode = getVscode();
    const files = vscode
      ? await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx}', '**/{node_modules,out,dist,.git}/**', 250)
      : listWorkspaceFiles(root, file => /\.(ts|tsx|js|jsx)$/i.test(file), 250).map(fsPath => ({ fsPath }));
    const re = new RegExp(`\\b(interface|class|function|const|let|enum|type)\\s+${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const matches: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file.fsPath, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (re.test(line)) {
          matches.push(`${path.relative(root, file.fsPath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    return { success: true, output: matches.length ? matches.join('\n') : 'No symbols found.' };
  }

  public async applyPatch(relativePath: string, patchContent: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolveWorkspacePath(relativePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `File not found: ${relativePath}` };
      }
      const hunks = parseSearchReplaceHunks(patchContent);
      if (!hunks.length) {
        return { success: false, output: 'Malformed patch: expected SEARCH/REPLACE hunk.' };
      }

      let content = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
      let lenientApplications = 0;
      for (const hunk of hunks) {
        const match = findLenientMatch(content, hunk.search);
        if (match.status === 'ambiguous') {
          return { success: false, output: `Patch application failed: search block matches ${match.matchCount} locations in ${relativePath}; include more surrounding context to disambiguate.` };
        }
        if (match.status === 'not_found' || !match.actual) {
          return { success: false, output: `Patch application failed: context not found in ${relativePath}.` };
        }
        if (match.status === 'lenient') {
          lenientApplications += 1;
        }
        content = content.replace(match.actual, hunk.replace);
      }
      fs.writeFileSync(fullPath, content, 'utf8');
      const lenientNote = lenientApplications ? ` (${lenientApplications} hunk(s) located with whitespace-lenient matching)` : '';
      return { success: true, output: `Applied ${hunks.length} patch hunk(s) to ${relativePath}${lenientNote}`, diff: await this.getDiffText() };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  }

  public async getDiff(): Promise<ToolResult> {
    return { success: true, output: await this.getDiffText() };
  }

  private async getDiffText(): Promise<string> {
    return new Promise(resolve => {
      exec('git diff -- .', { cwd: this.getWorkspaceRoot(), timeout: 30000 }, (error, stdout, stderr) => {
        resolve(error ? stderr || stdout || 'No git diff available.' : stdout || 'No changes.');
      });
    });
  }
}

function getVscode(): typeof import('vscode') | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode');
  } catch {
    return undefined;
  }
}

function buildCommandSandbox(cwd: string, timeoutMs: number): { env: NodeJS.ProcessEnv; allowedEnvKeys: string[]; blockedEnvKeys: string[] } {
  void cwd;
  void timeoutMs;
  const allowPatterns = [
    /^path$/i,
    /^pathext$/i,
    /^systemroot$/i,
    /^windir$/i,
    /^comspec$/i,
    /^temp$/i,
    /^tmp$/i,
    /^home$/i,
    /^userprofile$/i,
    /^appdata$/i,
    /^localappdata$/i,
    /^programfiles/i,
    /^processor_/i,
    /^number_of_processors$/i,
    /^os$/i,
    /^shell$/i,
    /^npm_/i,
    /^node_/i
  ];
  const env: NodeJS.ProcessEnv = {};
  const allowedEnvKeys: string[] = [];
  const blockedEnvKeys: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (allowPatterns.some(pattern => pattern.test(key))) {
      env[key] = value;
      allowedEnvKeys.push(key);
    } else {
      blockedEnvKeys.push(key);
    }
  }
  if (!Object.keys(env).some(key => /^node_env$/i.test(key))) {
    env.NODE_ENV = 'test';
    allowedEnvKeys.push('NODE_ENV');
  }
  return {
    env,
    allowedEnvKeys: allowedEnvKeys.sort(),
    blockedEnvKeys: blockedEnvKeys.sort()
  };
}

function listWorkspaceFiles(root: string, include: (filePath: string) => boolean, limit: number): string[] {
  const out: string[] = [];
  const ignored = new Set(['node_modules', 'out', 'dist', '.git']);
  const visit = (dir: string) => {
    if (out.length >= limit) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (include(fullPath)) {
        out.push(fullPath);
      }
      if (out.length >= limit) {
        break;
      }
    }
  };
  visit(root);
  return out;
}

export function parseSearchReplaceHunks(patchContent: string): { search: string; replace: string }[] {
  const hunks: { search: string; replace: string }[] = [];
  const hunkRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
  let match: RegExpExecArray | null;
  while ((match = hunkRegex.exec(patchContent)) !== null) {
    hunks.push({ search: match[1].replace(/\r\n/g, '\n'), replace: match[2].replace(/\r\n/g, '\n') });
  }
  return hunks;
}

export interface LenientMatchResult {
  status: 'exact' | 'lenient' | 'ambiguous' | 'not_found';
  /** The exact byte sequence from the file to replace (for exact/lenient). */
  actual?: string;
  matchCount?: number;
}

/**
 * Locate a SEARCH block in file content. Exact match wins. Otherwise a
 * whitespace-lenient pass compares trimmed lines over a sliding window; the
 * window must be UNIQUE in the file or the match is rejected as ambiguous.
 * The replacement target is rebuilt from the file's actual bytes so lenient
 * application never invents content. (Weak models drift on indentation and
 * trailing whitespace — the most common cause of failed context edits.)
 */
/**
 * Content-addressed patch target resolution. When a proposal's path is empty,
 * the SEARCH blocks themselves can identify the target — but ONLY when every
 * hunk matches (exact or lenient) in exactly one candidate file. Zero or
 * multiple matches refuse resolution: ambiguity is never guessed away.
 */
export function resolvePatchTargetByContent(candidates: Array<{ path: string; content: string }>, patchContent: string): { path?: string; matchCount: number } {
  const hunks = parseSearchReplaceHunks(patchContent);
  if (!hunks.length) {
    return { matchCount: 0 };
  }
  const matches = candidates.filter(candidate => {
    const normalized = candidate.content.replace(/\r\n/g, '\n');
    return hunks.every(hunk => {
      const match = findLenientMatch(normalized, hunk.search);
      return match.status === 'exact' || match.status === 'lenient';
    });
  });
  if (matches.length === 1) {
    return { path: matches[0].path, matchCount: 1 };
  }
  return { matchCount: matches.length };
}

export function findLenientMatch(content: string, search: string): LenientMatchResult {
  if (content.includes(search)) {
    return { status: 'exact', actual: search, matchCount: 1 };
  }
  const contentLines = content.split('\n');
  const searchTrimmed = search.split('\n').map(line => line.trim());
  if (!searchTrimmed.length || searchTrimmed.every(line => line.length === 0)) {
    return { status: 'not_found', matchCount: 0 };
  }
  const windows: number[] = [];
  for (let start = 0; start + searchTrimmed.length <= contentLines.length; start++) {
    let matched = true;
    for (let offset = 0; offset < searchTrimmed.length; offset++) {
      if (contentLines[start + offset].trim() !== searchTrimmed[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      windows.push(start);
    }
  }
  if (windows.length === 1) {
    const start = windows[0];
    return { status: 'lenient', actual: contentLines.slice(start, start + searchTrimmed.length).join('\n'), matchCount: 1 };
  }
  if (windows.length > 1) {
    return { status: 'ambiguous', matchCount: windows.length };
  }
  return { status: 'not_found', matchCount: 0 };
}
