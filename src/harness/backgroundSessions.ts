import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type BackgroundSessionStatus = 'preparing' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'awaiting_review' | 'completed_no_changes' | 'failed' | 'gave_up' | 'cancelled';

export interface BackgroundBaseline {
  path: string;
  hash: string | null;
  size: number;
  existed: boolean;
}

export interface BackgroundSessionV1 {
  schemaVersion: 1;
  sessionId: string;
  workspaceId: string;
  sourceRoot: string;
  isolatedRoot: string;
  tempParent: string;
  isolationMode: 'worktree' | 'copy';
  isolationFallbackReason: string | null;
  baseCommit: string | null;
  executionContract: { revision: number; digest: string; assurance: string };
  modelBindings: Record<string, string>;
  budget: { maxSteps: number; maxCostUsd: number };
  status: BackgroundSessionStatus;
  pid?: number;
  startedAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  baseline: BackgroundBaseline[];
  changedFiles: string[];
  statePath: string;
  logPath: string;
  error?: string;
  exitCode?: number;
  steps?: number;
  costUsd?: number;
  notifiedStatus?: string;
  merge?: { status: 'pending' | 'merged' | 'blocked' | 'rolled_back'; reviewOpenedAt?: string; reviewOpenedDigest?: string; reviewedAt?: string; reviewDigest?: string; reviewerModelId?: string; mergedAt?: string; error?: string };
}

const SESSION_ID = /^forge-[a-z0-9][a-z0-9._:-]{3,119}$/;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export class BackgroundSessionStore {
  public readonly root: string;

  constructor(private readonly workspaceRoot: string) {
    this.workspaceRoot = fs.realpathSync(workspaceRoot);
    this.root = path.join(this.workspaceRoot, '.forge', 'background-sessions');
  }

  public workspaceId(): string {
    return crypto.createHash('sha256').update(normalizeCase(this.workspaceRoot)).digest('hex');
  }

  public create(value: BackgroundSessionV1): BackgroundSessionV1 {
    this.validate(value);
    const target = this.manifestPath(value.sessionId);
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.dirname(target));
    this.writeAtomic(target, value);
    return value;
  }

  public load(sessionId: string): BackgroundSessionV1 {
    const target = this.manifestPath(sessionId);
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('Background session manifest is missing or oversized.');
    const value = JSON.parse(fs.readFileSync(target, 'utf8')) as BackgroundSessionV1;
    this.validate(value);
    return value;
  }

  public update(sessionId: string, mutate: (current: BackgroundSessionV1) => BackgroundSessionV1): BackgroundSessionV1 {
    return this.withSessionLock(sessionId, () => {
      const latest = this.load(sessionId);
      const lockedNext = mutate(structuredClone(latest));
      lockedNext.updatedAt = new Date().toISOString();
      this.validate(lockedNext);
      this.writeAtomic(this.manifestPath(sessionId), lockedNext);
      return lockedNext;
    });
  }

  public list(): BackgroundSessionV1[] {
    if (!fs.existsSync(this.root)) return [];
    const result: BackgroundSessionV1[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try { result.push(this.load(entry.name)); } catch { /* corrupt manifests never gain authority */ }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public isStale(session: BackgroundSessionV1, now = Date.now(), thresholdMs = 15_000): boolean {
    if (session.status !== 'running') return false;
    const heartbeat = Date.parse(session.heartbeatAt || session.updatedAt);
    if (!Number.isFinite(heartbeat) || now - heartbeat > thresholdMs) return true;
    if (!session.pid) return true;
    try { process.kill(session.pid, 0); return false; } catch { return true; }
  }

  public markNotified(sessionId: string, status: string): BackgroundSessionV1 {
    return this.update(sessionId, current => ({ ...current, notifiedStatus: String(status).slice(0, 64) }));
  }

  public acquireWorkspaceLease(sessionId: string, replaceStaleSameSession = false): void {
    this.assertSessionId(sessionId);
    fs.mkdirSync(this.root, { recursive: true });
    const leasePath = path.join(this.root, 'workspace.lease');
    try {
      fs.writeFileSync(leasePath, JSON.stringify({ sessionId, workspaceId: this.workspaceId(), acquiredAt: new Date().toISOString(), pid: process.pid }), { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const lease = this.readLease();
    if (!replaceStaleSameSession || lease?.sessionId !== sessionId) throw new Error(`Background workspace is already leased by ${lease?.sessionId || 'an unknown session'}.`);
    const session = this.load(sessionId);
    if (session.status === 'running' && !this.isStale(session)) throw new Error('Background session is still live.');
    fs.rmSync(leasePath, { force: true });
    fs.writeFileSync(leasePath, JSON.stringify({ sessionId, workspaceId: this.workspaceId(), acquiredAt: new Date().toISOString(), pid: process.pid }), { encoding: 'utf8', flag: 'wx' });
  }

  public releaseWorkspaceLease(sessionId: string): void {
    const leasePath = path.join(this.root, 'workspace.lease');
    const lease = this.readLease();
    if (lease?.sessionId === sessionId) fs.rmSync(leasePath, { force: true });
  }

  public requestCancel(sessionId: string): void {
    this.load(sessionId);
    const target = path.join(this.root, sessionId, 'control.json');
    this.writeJsonAtomic(target, { cancel: true, requestedAt: new Date().toISOString() });
  }

  public cancellationRequested(sessionId: string): boolean {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(this.root, sessionId, 'control.json'), 'utf8'));
      return value?.cancel === true;
    } catch { return false; }
  }

  public manifestPath(sessionId: string): string {
    this.assertSessionId(sessionId);
    return path.join(this.root, sessionId, 'session.json');
  }

  private validate(value: BackgroundSessionV1): void {
    if (!value || value.schemaVersion !== 1) throw new Error('Unsupported background session schema.');
    this.assertSessionId(value.sessionId);
    if (value.workspaceId !== this.workspaceId()) throw new Error('Background session belongs to another workspace.');
    if (normalizeCase(fs.realpathSync(value.sourceRoot)) !== normalizeCase(this.workspaceRoot)) throw new Error('Background source root identity is invalid.');
    if (!value.executionContract?.digest || !/^[a-f0-9]{64}$/.test(value.executionContract.digest)) throw new Error('Background execution contract digest is invalid.');
    if (!path.isAbsolute(value.isolatedRoot) || normalizeCase(value.isolatedRoot) === normalizeCase(this.workspaceRoot)) throw new Error('Background isolated root is invalid.');
    if (!path.isAbsolute(value.tempParent) || !containedBy(value.tempParent, value.isolatedRoot)) throw new Error('Background isolation parent is invalid.');
    if (!['worktree', 'copy'].includes(value.isolationMode)) throw new Error('Background isolation mode is invalid.');
    if (!Number.isInteger(value.budget?.maxSteps) || value.budget.maxSteps < 1 || value.budget.maxSteps > 1_000 || !Number.isFinite(value.budget?.maxCostUsd) || value.budget.maxCostUsd < 0 || value.budget.maxCostUsd > 10_000) throw new Error('Background budget is invalid.');
    if (!Array.isArray(value.baseline) || value.baseline.length > 5_000 || !Array.isArray(value.changedFiles) || value.changedFiles.length > 200) throw new Error('Background file bounds are invalid.');
    if (value.steps !== undefined && (!Number.isInteger(value.steps) || value.steps < 0 || value.steps > 100_000)) throw new Error('Background step count is invalid.');
    if (value.costUsd !== undefined && (!Number.isFinite(value.costUsd) || value.costUsd < 0 || value.costUsd > 100_000)) throw new Error('Background cost is invalid.');
    for (const item of [...value.baseline.map(entry => entry.path), ...value.changedFiles]) assertRelative(item);
  }

  private assertSessionId(value: string): void {
    if (!SESSION_ID.test(String(value || ''))) throw new Error('Invalid background session ID.');
  }

  private readLease(): any {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, 'workspace.lease'), 'utf8')); } catch { return null; }
  }

  private withSessionLock<T>(sessionId: string, action: () => T): T {
    const lock = path.join(this.root, sessionId, 'session.lock');
    let fd: number | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { fd = fs.openSync(lock, 'wx'); break; } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 15_000) fs.rmSync(lock, { force: true });
        } catch { /* another writer released it */ }
        if (attempt === 19) throw new Error('Background session manifest is busy.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try { return action(); } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }

  private writeAtomic(target: string, value: BackgroundSessionV1): void {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    this.replaceWithRetry(temp, target);
  }

  private writeJsonAtomic(target: string, value: unknown): void {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    this.replaceWithRetry(temp, target);
  }

  private replaceWithRetry(temp: string, target: string): void {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.renameSync(temp, target);
        return;
      } catch (error: any) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(error?.code)) || attempt === 19) {
          try { fs.rmSync(temp, { force: true }); } catch { /* preserve the original error */ }
          throw error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  }
}

export function fileBaseline(root: string, relativePaths: string[]): BackgroundBaseline[] {
  return [...new Set(relativePaths.map(normalizeRel).filter(Boolean))].sort().map(relative => {
    const target = contained(root, relative);
    if (!fs.existsSync(target)) return { path: relative, hash: null, size: 0, existed: false };
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe background baseline path: ${relative}`);
    const bytes = fs.readFileSync(target);
    return { path: relative, hash: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, existed: true };
  });
}

export function workspaceBaseline(root: string, limit = 5_000): BackgroundBaseline[] {
  const excluded = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', 'coverage', 'artifacts', '.vscode-test']);
  const paths: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name.endsWith('.vsix') || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        paths.push(path.relative(root, full).replace(/\\/g, '/'));
        if (paths.length > limit) throw new Error(`Background workspace exceeds ${limit} baseline files.`);
      }
    }
  };
  visit(root);
  return fileBaseline(root, paths);
}

export function changedAgainstBaseline(root: string, baseline: BackgroundBaseline[], limit = 200): string[] {
  const before = new Map(baseline.map(item => [item.path, item]));
  const current = workspaceBaseline(root, 5_000);
  const after = new Map(current.map(item => [item.path, item]));
  const changed = new Set<string>();
  for (const [relative, item] of after) if (!before.has(relative) || before.get(relative)?.hash !== item.hash) changed.add(relative);
  for (const relative of before.keys()) if (!after.has(relative)) changed.add(relative);
  if (changed.size > limit) throw new Error(`Background change set exceeds ${limit} files.`);
  return [...changed].sort();
}

function contained(root: string, relative: string): string {
  assertRelative(relative);
  const resolved = path.resolve(root, relative);
  const prefix = path.resolve(root) + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error(`Background path escapes workspace: ${relative}`);
  return resolved;
}

function assertRelative(value: string): void {
  const normalized = normalizeRel(value);
  if (!normalized || path.isAbsolute(value) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`Invalid background relative path: ${value}`);
}

function normalizeRel(value: string): string { return String(value || '').replace(/\\/g, '/').replace(/^\.\//, ''); }
function normalizeCase(value: string): string { return process.platform === 'win32' ? value.toLowerCase() : value; }
function containedBy(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + path.sep);
}
