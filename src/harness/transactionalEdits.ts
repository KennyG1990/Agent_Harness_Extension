import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolProposal } from './types';
import { ProcessWorkerExecutor, WorkerToolResult } from './workerExecutor';

export interface EditTransaction {
  id: string;
  role: string;
  proposalName: 'apply_patch' | 'write_file';
  targetPath: string;
  mode: 'git-worktree' | 'sparse-copy';
  sourceHashBefore: string;
  sourceHashAtMerge: string;
  stagedHash: string;
  baseCommit: string | null;
  committed: boolean;
  conflict: boolean;
  cleanupSucceeded: boolean;
  workerPid: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: string;
}

export interface TransactionalEditResult extends WorkerToolResult {
  transaction: EditTransaction;
}

export interface WorkerDispatcher {
  dispatch(workspaceRoot: string, role: string, proposal: ToolProposal, timeoutMs?: number): Promise<WorkerToolResult>;
}

export class TransactionalEditExecutor {
  constructor(private readonly worker: WorkerDispatcher = new ProcessWorkerExecutor()) {}

  public async dispatch(sourceRoot: string, role: string, proposal: ToolProposal): Promise<TransactionalEditResult> {
    if (proposal.name !== 'apply_patch' && proposal.name !== 'write_file') {
      throw new Error(`TransactionalEditExecutor only accepts file edit proposals, received ${proposal.name}.`);
    }
    const id = `edit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const started = Date.now();
    const startedAt = new Date().toISOString();
    const targetPath = String(proposal.arguments.path || '').replace(/\\/g, '/');
    const sourceFullPath = resolveContainedPath(sourceRoot, targetPath);
    const sourceHashBefore = hashPath(sourceFullPath);
    const git = detectGit(sourceRoot);
    const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), git.ok ? 'forge-role-worktree-' : 'forge-role-staging-'));
    const isolatedRoot = git.ok ? path.join(tempParent, 'worktree') : path.join(tempParent, 'staging');
    let cleanupSucceeded = false;
    let result: WorkerToolResult | undefined;
    let transaction: EditTransaction | undefined;

    try {
      if (git.ok) {
        runGit(sourceRoot, ['worktree', 'add', '--detach', isolatedRoot, 'HEAD']);
      } else {
        fs.mkdirSync(isolatedRoot, { recursive: true });
      }
      const stagedFullPath = resolveContainedPath(isolatedRoot, targetPath);
      if (fs.existsSync(sourceFullPath)) {
        fs.mkdirSync(path.dirname(stagedFullPath), { recursive: true });
        fs.copyFileSync(sourceFullPath, stagedFullPath);
      }

      result = await this.worker.dispatch(isolatedRoot, role, proposal);
      const sourceHashAtMerge = hashPath(sourceFullPath);
      const stagedHash = hashPath(stagedFullPath);
      const conflict = sourceHashAtMerge !== sourceHashBefore;
      let committed = false;
      let error = result.success ? undefined : result.output.slice(0, 1200);
      if (result.success && conflict) {
        error = `Edit transaction conflict: source ${targetPath} changed after validation (${sourceHashBefore} -> ${sourceHashAtMerge}).`;
        result = { ...result, success: false, output: error };
      } else if (result.success && stagedHash === 'missing') {
        error = `Edit transaction failed: staged target ${targetPath} was not produced.`;
        result = { ...result, success: false, output: error };
      } else if (result.success) {
        fs.mkdirSync(path.dirname(sourceFullPath), { recursive: true });
        fs.copyFileSync(stagedFullPath, sourceFullPath);
        committed = true;
      }

      transaction = {
        id,
        role,
        proposalName: proposal.name,
        targetPath,
        mode: git.ok ? 'git-worktree' : 'sparse-copy',
        sourceHashBefore,
        sourceHashAtMerge,
        stagedHash,
        baseCommit: git.head,
        committed,
        conflict,
        cleanupSucceeded: false,
        workerPid: result.worker.pid,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error
      };
    } catch (error: any) {
      const fallbackWorker = result?.worker || {
        role,
        pid: 0,
        durationMs: Date.now() - started,
        sanitizedEnv: true,
        inheritedEnvKeyCount: Object.keys(process.env).length,
        allowedEnvKeys: [],
        blockedEnvKeys: []
      };
      result = { success: false, output: `Edit transaction failed: ${error.message}`, worker: fallbackWorker };
      transaction = {
        id,
        role,
        proposalName: proposal.name,
        targetPath,
        mode: git.ok ? 'git-worktree' : 'sparse-copy',
        sourceHashBefore,
        sourceHashAtMerge: hashPath(sourceFullPath),
        stagedHash: 'missing',
        baseCommit: git.head,
        committed: false,
        conflict: false,
        cleanupSucceeded: false,
        workerPid: fallbackWorker.pid,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: String(error.message).slice(0, 1200)
      };
    } finally {
      cleanupSucceeded = cleanup(sourceRoot, isolatedRoot, tempParent, git.ok);
      if (transaction) transaction.cleanupSucceeded = cleanupSucceeded;
    }

    return { ...result!, transaction: transaction! };
  }
}

function detectGit(root: string): { ok: boolean; head: string | null } {
  try {
    if (runGit(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { ok: false, head: null };
    return { ok: true, head: runGit(root, ['rev-parse', 'HEAD']) };
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
      try { runGit(sourceRoot, ['worktree', 'remove', '--force', isolatedRoot]); } catch { /* fallback removal below */ }
      try { runGit(sourceRoot, ['worktree', 'prune']); } catch { /* best effort */ }
    }
    fs.rmSync(tempParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return !fs.existsSync(tempParent);
  } catch {
    return false;
  }
}

function resolveContainedPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Edit target must be workspace-relative: ${relativePath}`);
  const resolvedRoot = fs.realpathSync(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new Error(`Edit target escapes transaction root: ${relativePath}`);
  return resolved;
}

function hashPath(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'missing';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
