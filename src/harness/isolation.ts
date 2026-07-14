import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentHarnessLoop } from './loop';
import { createConfiguredProvider, Provider } from './provider';
import { HarnessState, RunBudget } from './types';

export type IsolationMode = 'auto' | 'worktree' | 'copy';

export interface IsolatedRunOptions {
  sourceRoot?: string;
  goal?: string;
  modelBindings?: Record<string, string>;
  runBudget?: Partial<RunBudget>;
  maxSteps?: number;
  keepIsolated?: boolean;
  isolationMode?: IsolationMode;
}

export interface IsolatedRunReport {
  generatedAt: string;
  goal: string;
  sourceRoot: string;
  isolatedRoot: string;
  keptIsolated: boolean;
  sourceMutated: boolean;
  changedFiles: string[];
  addedFiles: string[];
  deletedFiles: string[];
  stateStatus: HarnessState['status'];
  steps: number;
  statePath: string;
  diffPath: string;
  reportPath?: string;
  requestedIsolationMode: IsolationMode;
  isolationMode: 'worktree' | 'copy';
  isolationFallbackReason: string | null;
  baseCommit: string | null;
  dirtyFilesOverlaid: string[];
  sourceDirtyStatusPreserved: boolean;
}

export interface PreparedIsolation {
  sourceRoot: string;
  isolatedRoot: string;
  tempParent: string;
  requestedMode: IsolationMode;
  mode: 'worktree' | 'copy';
  fallbackReason: string | null;
  baseCommit: string | null;
  dirtyFilesOverlaid: string[];
}

const ISOLATION_EXCLUDED = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', 'artifacts', '.vscode-test']);

interface GitDetection {
  ok: boolean;
  head?: string;
  reason?: string;
}

export async function runIsolatedAgentGoal(options: IsolatedRunOptions = {}, provider: Provider = createConfiguredProvider()): Promise<IsolatedRunReport> {
  const sourceRoot = fs.realpathSync(options.sourceRoot || getWorkspaceRoot());
  const goal = options.goal || 'Run Forge Agent in an isolated workspace copy.';
  const requestedMode: IsolationMode = options.isolationMode || 'auto';
  const git = detectGitRepo(sourceRoot);

  const sourceBefore = snapshotFiles(sourceRoot);
  const sourceDirtyBefore = git.ok ? normalizedDirtyStatus(sourceRoot) : null;
  const prepared = prepareIsolatedWorkspace(sourceRoot, requestedMode);
  const { isolatedRoot, tempParent, mode, fallbackReason, dirtyFilesOverlaid } = prepared;
  const isolatedBefore = snapshotFiles(isolatedRoot);

  const loop = new AgentHarnessLoop(provider, isolatedRoot);
  let state = await loop.initializeHarness(goal, options.modelBindings || {}, options.runBudget || {});
  if (Number.isFinite(options.maxSteps) && Number(options.maxSteps) > 0) {
    state.maxSteps = Number(options.maxSteps);
  }
  while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
    state = await loop.runStep(state, options.modelBindings || {});
  }

  const isolatedAfter = snapshotFiles(isolatedRoot);
  const sourceAfter = snapshotFiles(sourceRoot);
  const sourceDirtyAfter = git.ok ? normalizedDirtyStatus(sourceRoot) : null;
  const diff = compareSnapshots(isolatedBefore, isolatedAfter);
  const sourceMutated = !snapshotsEqual(sourceBefore, sourceAfter);
  const sourceDirtyStatusPreserved = git.ok ? sourceDirtyBefore === sourceDirtyAfter : !sourceMutated;
  const forgeDir = path.join(sourceRoot, '.forge', 'isolated-runs');
  fs.mkdirSync(forgeDir, { recursive: true });
  const diffPath = path.join(forgeDir, 'latest-isolated-run.diff');
  fs.writeFileSync(diffPath, renderDiffSummary(diff), 'utf8');
  const statePath = path.join(isolatedRoot, '.forge', 'state.json');
  const keptIsolated = options.keepIsolated !== false;
  const report: IsolatedRunReport = {
    generatedAt: new Date().toISOString(),
    goal,
    sourceRoot,
    isolatedRoot,
    keptIsolated,
    sourceMutated,
    changedFiles: diff.changed,
    addedFiles: diff.added,
    deletedFiles: diff.deleted,
    stateStatus: state.status,
    steps: state.currentStepIndex,
    statePath,
    diffPath,
    requestedIsolationMode: requestedMode,
    isolationMode: mode,
    isolationFallbackReason: fallbackReason,
    baseCommit: prepared.baseCommit,
    dirtyFilesOverlaid,
    sourceDirtyStatusPreserved
  };
  report.reportPath = path.join(forgeDir, 'latest-isolated-run.json');
  fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2), 'utf8');
  if (!keptIsolated) {
    cleanupIsolatedWorkspace(prepared);
  }
  return report;
}

export function prepareIsolatedWorkspace(sourceRootInput: string, requestedMode: IsolationMode = 'auto'): PreparedIsolation {
  const sourceRoot = fs.realpathSync(sourceRootInput);
  const git = detectGitRepo(sourceRoot);
  let mode: 'worktree' | 'copy';
  let fallbackReason: string | null = null;
  if (requestedMode === 'copy') {
    mode = 'copy';
    fallbackReason = 'copy_mode_requested';
  } else if (git.ok) {
    mode = 'worktree';
  } else if (requestedMode === 'worktree') {
    throw new Error(`git worktree isolation is unavailable for this workspace: ${git.reason}`);
  } else {
    mode = 'copy';
    fallbackReason = git.reason || 'git_unavailable';
  }

  let tempParent: string;
  let isolatedRoot: string;
  let dirtyFilesOverlaid: string[] = [];
  if (mode === 'worktree') {
    tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-isolated-wt-'));
    isolatedRoot = path.join(tempParent, 'worktree');
    try {
      runGit(sourceRoot, ['worktree', 'add', '--detach', isolatedRoot, 'HEAD']);
      dirtyFilesOverlaid = overlayDirtyState(sourceRoot, isolatedRoot);
    } catch (err: any) {
      fs.rmSync(tempParent, { recursive: true, force: true });
      if (requestedMode === 'worktree') throw new Error(`git worktree add failed: ${err?.message || err}`);
      mode = 'copy';
      fallbackReason = `worktree_add_failed: ${String(err?.message || err).slice(0, 200)}`;
      tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-isolated-run-'));
      isolatedRoot = tempParent;
      copyWorkspace(sourceRoot, isolatedRoot);
    }
  } else {
    tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-isolated-run-'));
    isolatedRoot = tempParent;
    copyWorkspace(sourceRoot, isolatedRoot);
  }
  return {
    sourceRoot,
    isolatedRoot,
    tempParent,
    requestedMode,
    mode,
    fallbackReason,
    baseCommit: mode === 'worktree' ? git.head || null : null,
    dirtyFilesOverlaid
  };
}

export function cleanupIsolatedWorkspace(prepared: PreparedIsolation): void {
  if (prepared.mode === 'worktree') removeWorktree(prepared.sourceRoot, prepared.isolatedRoot, prepared.tempParent);
  else fs.rmSync(prepared.tempParent, { recursive: true, force: true });
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function detectGitRepo(root: string): GitDetection {
  try {
    const inside = runGit(root, ['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') {
      return { ok: false, reason: 'not_a_git_worktree' };
    }
  } catch {
    return { ok: false, reason: 'git_unavailable_or_not_a_repo' };
  }
  try {
    const head = runGit(root, ['rev-parse', '--verify', 'HEAD']);
    return { ok: true, head };
  } catch {
    return { ok: false, reason: 'repo_has_no_commits' };
  }
}

function normalizedDirtyStatus(root: string): string | null {
  try {
    const raw = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return raw
      .split('\0')
      .filter((entry) => entry.length > 3)
      .filter((entry) => !isIsolationExcludedPath(entry.slice(3)))
      .sort()
      .join('\0');
  } catch {
    return null;
  }
}

function isIsolationExcludedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const first = normalized.split('/')[0];
  return ISOLATION_EXCLUDED.has(first) || normalized.endsWith('.vsix');
}

function overlayDirtyState(sourceRoot: string, worktreeRoot: string): string[] {
  const raw = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tokens = raw.split('\0').filter((token) => token.length > 0);
  const overlaid: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const entry = tokens[index];
    index += 1;
    if (entry.length < 4) {
      continue;
    }
    const status = entry.slice(0, 2);
    const relPath = entry.slice(3);
    let previousPath: string | null = null;
    if (status[0] === 'R' || status[0] === 'C') {
      previousPath = tokens[index] || null;
      index += 1;
    }
    if (previousPath && !isIsolationExcludedPath(previousPath)) {
      fs.rmSync(path.join(worktreeRoot, previousPath), { force: true });
    }
    if (isIsolationExcludedPath(relPath)) {
      continue;
    }
    const sourcePath = path.join(sourceRoot, relPath);
    const targetPath = path.join(worktreeRoot, relPath);
    if (status.includes('D') && !fs.existsSync(sourcePath)) {
      fs.rmSync(targetPath, { force: true });
      overlaid.push(relPath.replace(/\\/g, '/'));
      continue;
    }
    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      overlaid.push(relPath.replace(/\\/g, '/'));
    }
  }
  return overlaid.sort();
}

function removeWorktree(sourceRoot: string, worktreeRoot: string, tempParent: string): void {
  try {
    runGit(sourceRoot, ['worktree', 'remove', '--force', worktreeRoot]);
  } catch {
    // Fall through to filesystem cleanup + prune below.
  }
  try {
    fs.rmSync(tempParent, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup.
  }
  try {
    runGit(sourceRoot, ['worktree', 'prune']);
  } catch {
    // Best-effort registration cleanup.
  }
}

function getWorkspaceRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.length) {
      return folders[0].uri.fsPath;
    }
  } catch {
    // Plain Node tests can pass sourceRoot explicitly.
  }
  return process.cwd();
}

function copyWorkspace(sourceRoot: string, isolatedRoot: string): void {
  const visit = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (ISOLATION_EXCLUDED.has(entry.name) || entry.name.endsWith('.vsix')) {
        continue;
      }
      const sourcePath = path.join(from, entry.name);
      const targetPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        visit(sourcePath, targetPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  };
  visit(sourceRoot, isolatedRoot);
}

function snapshotFiles(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ISOLATION_EXCLUDED.has(entry.name) || entry.name.endsWith('.vsix')) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(root, fullPath).replace(/\\/g, '/');
        const hash = crypto.createHash('sha1').update(fs.readFileSync(fullPath)).digest('hex');
        snapshot.set(rel, hash);
      }
    }
  };
  visit(root);
  return snapshot;
}

function compareSnapshots(before: Map<string, string>, after: Map<string, string>): { added: string[]; changed: string[]; deleted: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [file, hash] of after) {
    if (!before.has(file)) {
      added.push(file);
    } else if (before.get(file) !== hash) {
      changed.push(file);
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      deleted.push(file);
    }
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    deleted: deleted.sort()
  };
}

function snapshotsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  const diff = compareSnapshots(a, b);
  return diff.added.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0;
}

function renderDiffSummary(diff: { added: string[]; changed: string[]; deleted: string[] }): string {
  return [
    '# Isolated Forge Run Diff Summary',
    '',
    '## Added',
    ...(diff.added.length ? diff.added : ['none']),
    '',
    '## Changed',
    ...(diff.changed.length ? diff.changed : ['none']),
    '',
    '## Deleted',
    ...(diff.deleted.length ? diff.deleted : ['none']),
    ''
  ].join('\n');
}
