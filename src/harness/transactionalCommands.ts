import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolProposal } from './types';
import { ProcessWorkerExecutor, WorkerToolResult } from './workerExecutor';

const EXCLUDED_ROOTS = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', 'coverage', 'artifacts', '.vscode-test']);
const MAX_CHANGED_FILES = 200;
const MAX_MERGE_BYTES = 20 * 1024 * 1024;

interface FileState {
  hash: string;
  size: number;
}

interface TreeSnapshot {
  files: Map<string, FileState>;
  unsupported: string[];
}

export interface CommandTransaction {
  id: string;
  role: string;
  command: string;
  mode: 'git-worktree' | 'workspace-copy';
  baseCommit: string | null;
  changedFiles: string[];
  created: string[];
  modified: string[];
  deleted: string[];
  mergedFileCount: number;
  mergedBytes: number;
  committed: boolean;
  conflict: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  cleanupSucceeded: boolean;
  workerPid: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: string;
}

export interface TransactionalCommandResult extends WorkerToolResult {
  commandTransaction: CommandTransaction;
}

export interface CommandWorkerDispatcher {
  dispatch(workspaceRoot: string, role: string, proposal: ToolProposal, timeoutMs?: number): Promise<WorkerToolResult>;
}

export type CommandMergeFile = (stagedPath: string, targetPath: string, index: number) => void;

export class TransactionalCommandExecutor {
  constructor(
    private readonly worker: CommandWorkerDispatcher = new ProcessWorkerExecutor(),
    private readonly mergeFile: CommandMergeFile = (stagedPath, targetPath) => fs.copyFileSync(stagedPath, targetPath)
  ) {}

  public async dispatch(sourceRootInput: string, role: string, proposal: ToolProposal): Promise<TransactionalCommandResult> {
    if (proposal.name !== 'run_command') {
      throw new Error(`TransactionalCommandExecutor only accepts run_command, received ${proposal.name}.`);
    }
    const sourceRoot = fs.realpathSync(sourceRootInput);
    const command = String(proposal.arguments.command || '');
    const id = `command-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const started = Date.now();
    const startedAt = new Date().toISOString();
    const git = detectGit(sourceRoot);
    const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), git.ok ? 'forge-command-worktree-' : 'forge-command-copy-'));
    const isolatedRoot = path.join(tempParent, git.ok ? 'worktree' : 'workspace');
    const sourceBefore = snapshotTree(sourceRoot);
    let result: WorkerToolResult | undefined;
    let transaction: CommandTransaction | undefined;

    try {
      if (referencesSourceRoot(command, sourceRoot)) {
        throw new Error('Command transaction rejected an explicit reference to the active workspace root.');
      }
      if (sourceBefore.unsupported.length) {
        throw new Error(`Command transaction source contains unsupported symbolic links: ${sourceBefore.unsupported.slice(0, 10).join(', ')}`);
      }
      if (git.ok) {
        runGit(sourceRoot, ['worktree', 'add', '--detach', isolatedRoot, 'HEAD']);
        overlayWorkspace(sourceRoot, isolatedRoot);
        applySourceDeletions(sourceRoot, isolatedRoot);
      } else {
        fs.mkdirSync(isolatedRoot, { recursive: true });
        overlayWorkspace(sourceRoot, isolatedRoot);
      }
      const isolatedBefore = snapshotTree(isolatedRoot);
      result = await this.worker.dispatch(isolatedRoot, role, proposal);
      const isolatedAfter = snapshotTree(isolatedRoot);
      const change = compareTrees(isolatedBefore.files, isolatedAfter.files);
      const mergedBytes = change.created.concat(change.modified)
        .reduce((total, rel) => total + (isolatedAfter.files.get(rel)?.size || 0), 0);
      let committed = false;
      let conflict = false;
      let rollbackAttempted = false;
      let rollbackSucceeded = false;
      let error = result.success ? undefined : result.output.slice(0, 1200);

      if (result.success && isolatedAfter.unsupported.length) {
        error = `Command transaction produced unsupported symbolic links: ${isolatedAfter.unsupported.slice(0, 10).join(', ')}`;
        result = { ...result, success: false, output: error };
      } else if (result.success && change.changed.length > MAX_CHANGED_FILES) {
        error = `Command transaction changed ${change.changed.length} files; limit is ${MAX_CHANGED_FILES}.`;
        result = { ...result, success: false, output: error };
      } else if (result.success && mergedBytes > MAX_MERGE_BYTES) {
        error = `Command transaction produced ${mergedBytes} bytes; merge limit is ${MAX_MERGE_BYTES}.`;
        result = { ...result, success: false, output: error };
      } else if (result.success) {
        const sourceAtMerge = snapshotTree(sourceRoot);
        const typeConflicts = change.changed.filter(rel => {
          const target = containedPath(sourceRoot, rel);
          return isolatedAfter.files.has(rel) && fs.existsSync(target) && !fs.statSync(target).isFile();
        });
        const unsupportedConflicts = change.changed.filter(rel => sourceAtMerge.unsupported.includes(rel));
        const conflicts = Array.from(new Set([
          ...change.changed.filter(rel => !sameState(sourceBefore.files.get(rel), sourceAtMerge.files.get(rel))),
          ...typeConflicts,
          ...unsupportedConflicts
        ])).sort();
        if (conflicts.length) {
          conflict = true;
          error = `Command transaction conflict: active workspace changed after staging (${conflicts.slice(0, 20).join(', ')}).`;
          result = { ...result, success: false, output: error };
        } else {
          const merge = mergeChanges(sourceRoot, isolatedRoot, change.changed, isolatedAfter.files, this.mergeFile);
          committed = merge.success;
          rollbackAttempted = merge.rollbackAttempted;
          rollbackSucceeded = merge.rollbackSucceeded;
          if (!merge.success) {
            error = merge.error;
            result = { ...result, success: false, output: merge.error || 'Command transaction merge failed.' };
          }
        }
      }

      transaction = {
        id,
        role,
        command,
        mode: git.ok ? 'git-worktree' : 'workspace-copy',
        baseCommit: git.head,
        changedFiles: change.changed,
        created: change.created,
        modified: change.modified,
        deleted: change.deleted,
        mergedFileCount: committed ? change.changed.length : 0,
        mergedBytes: committed ? mergedBytes : 0,
        committed,
        conflict,
        rollbackAttempted,
        rollbackSucceeded,
        cleanupSucceeded: false,
        workerPid: result.worker.pid,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error
      };
    } catch (error: any) {
      const worker = result?.worker || {
        role,
        pid: 0,
        durationMs: Date.now() - started,
        sanitizedEnv: true,
        inheritedEnvKeyCount: Object.keys(process.env).length,
        allowedEnvKeys: [],
        blockedEnvKeys: []
      };
      const message = `Command transaction failed: ${error.message}`;
      result = { success: false, output: message, worker };
      transaction = {
        id, role, command, mode: git.ok ? 'git-worktree' : 'workspace-copy', baseCommit: git.head,
        changedFiles: [], created: [], modified: [], deleted: [], mergedFileCount: 0, mergedBytes: 0,
        committed: false, conflict: false, rollbackAttempted: false, rollbackSucceeded: false,
        cleanupSucceeded: false, workerPid: worker.pid, startedAt, completedAt: new Date().toISOString(),
        durationMs: Date.now() - started, error: message.slice(0, 1200)
      };
    } finally {
      const cleaned = cleanup(sourceRoot, isolatedRoot, tempParent, git.ok);
      if (transaction) transaction.cleanupSucceeded = cleaned;
    }

    return { ...result!, commandTransaction: transaction! };
  }
}

function referencesSourceRoot(command: string, sourceRoot: string): boolean {
  const normalizedCommand = command.replace(/\\/g, '/').toLowerCase();
  const normalizedRoot = sourceRoot.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return normalizedCommand.includes(normalizedRoot);
}

function mergeChanges(sourceRoot: string, isolatedRoot: string, changed: string[], after: Map<string, FileState>, mergeFile: CommandMergeFile): {
  success: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  error?: string;
} {
  const backup = new Map<string, Buffer | null>();
  for (const rel of changed) {
    const target = containedPath(sourceRoot, rel);
    backup.set(rel, fs.existsSync(target) ? fs.readFileSync(target) : null);
  }
  try {
    for (let index = 0; index < changed.length; index += 1) {
      const rel = changed[index];
      const target = containedPath(sourceRoot, rel);
      if (!after.has(rel)) {
        fs.rmSync(target, { force: true });
        continue;
      }
      const staged = containedPath(isolatedRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      mergeFile(staged, target, index);
    }
    return { success: true, rollbackAttempted: false, rollbackSucceeded: false };
  } catch (error: any) {
    let rollbackSucceeded = true;
    for (const [rel, bytes] of backup) {
      try {
        const target = containedPath(sourceRoot, rel);
        if (bytes === null) {
          fs.rmSync(target, { force: true });
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bytes);
        }
      } catch {
        rollbackSucceeded = false;
      }
    }
    return { success: false, rollbackAttempted: true, rollbackSucceeded, error: `Command transaction merge failed: ${error.message}` };
  }
}

function compareTrees(before: Map<string, FileState>, after: Map<string, FileState>): { changed: string[]; created: string[]; modified: string[]; deleted: string[] } {
  const created = Array.from(after.keys()).filter(rel => !before.has(rel)).sort();
  const deleted = Array.from(before.keys()).filter(rel => !after.has(rel)).sort();
  const modified = Array.from(after.keys()).filter(rel => before.has(rel) && !sameState(before.get(rel), after.get(rel))).sort();
  return { changed: Array.from(new Set([...created, ...modified, ...deleted])).sort(), created, modified, deleted };
}

function sameState(left: FileState | undefined, right: FileState | undefined): boolean {
  return left?.hash === right?.hash && left?.size === right?.size;
}

function snapshotTree(root: string): TreeSnapshot {
  const files = new Map<string, FileState>();
  const unsupported: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_ROOTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (rel.endsWith('.vsix')) continue;
      if (entry.isSymbolicLink()) {
        unsupported.push(rel);
      } else if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        files.set(rel, { hash: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
      }
    }
  };
  visit(root);
  return { files, unsupported: unsupported.sort() };
}

function overlayWorkspace(sourceRoot: string, targetRoot: string): void {
  const visit = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (EXCLUDED_ROOTS.has(entry.name)) continue;
      if (entry.isSymbolicLink() || entry.name.endsWith('.vsix')) continue;
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) visit(source, target);
      else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
  };
  visit(sourceRoot, targetRoot);
}

function applySourceDeletions(sourceRoot: string, worktreeRoot: string): void {
  const raw = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  for (const token of raw.split('\0').filter(Boolean)) {
    if (token.length < 4 || !token.slice(0, 2).includes('D')) continue;
    const rel = token.slice(3).replace(/\\/g, '/');
    if (!isExcluded(rel)) fs.rmSync(containedPath(worktreeRoot, rel), { recursive: true, force: true });
  }
}

function isExcluded(rel: string): boolean {
  return EXCLUDED_ROOTS.has(rel.replace(/\\/g, '/').split('/')[0]) || rel.endsWith('.vsix');
}

function containedPath(root: string, rel: string): string {
  if (!rel || path.isAbsolute(rel)) throw new Error(`Transaction path must be workspace-relative: ${rel}`);
  const resolvedRoot = fs.realpathSync(root);
  const resolved = path.resolve(resolvedRoot, rel);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error(`Transaction path escapes workspace: ${rel}`);
  return resolved;
}

function detectGit(root: string): { ok: boolean; head: string | null } {
  try {
    if (runGit(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { ok: false, head: null };
    return { ok: true, head: runGit(root, ['rev-parse', '--verify', 'HEAD']) };
  } catch {
    return { ok: false, head: null };
  }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cleanup(sourceRoot: string, isolatedRoot: string, tempParent: string, worktree: boolean): boolean {
  try {
    if (worktree) {
      try { runGit(sourceRoot, ['worktree', 'remove', '--force', isolatedRoot]); } catch { /* filesystem cleanup below */ }
      try { runGit(sourceRoot, ['worktree', 'prune']); } catch { /* best effort */ }
    }
    fs.rmSync(tempParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return !fs.existsSync(tempParent);
  } catch {
    return false;
  }
}
