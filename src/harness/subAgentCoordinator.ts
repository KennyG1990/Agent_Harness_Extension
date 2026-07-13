import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChatUsage } from './provider';
import { CompositeOracleResult, VerificationOracles } from './oracles';
import { TaskItem, ToolName, ToolProposal } from './types';
import { ProcessWorkerExecutor, WorkerToolResult } from './workerExecutor';

export type SubAgentRole = 'Explorer' | 'Architect' | 'Editor' | 'Reviewer' | 'Escalation' | 'Orchestrator';
export type SubAgentStatus = 'idle' | 'running' | 'staged' | 'blocked' | 'merged' | 'completed' | 'failed' | 'abandoned';

export interface SubAgentLimits {
  maxWorkers: number;
  maxFanOut: number;
  maxDepth: number;
  maxRetries: number;
  maxLifetimeMs: number;
  maxChangedFiles: number;
  maxMergeBytes: number;
}

export interface SubAgentUsage {
  providerCalls: number;
  providerFailures: number;
  fallbackProposals: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
  solvedWork: number;
}

export interface SubAgentWorker {
  id: string;
  parentId: 'coordinator';
  depth: 1;
  role: SubAgentRole;
  taskId: string;
  taskTitle: string;
  sessionId: string;
  modelId: string;
  allowedTools: ToolName[];
  status: SubAgentStatus;
  retries: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  usage: SubAgentUsage;
  staging?: SubAgentStage;
}

export interface SubAgentHandoff {
  id: string;
  sourceWorkerId: string;
  targetWorkerId: string;
  sourceRole: SubAgentRole;
  targetRole: SubAgentRole;
  taskId: string;
  createdAt: string;
  brief: string;
  planExcerpt: string;
  focusFiles: string[];
  evidenceDigests: string[];
  rawTranscriptIncluded: false;
}

export interface SubAgentStage {
  id: string;
  mode: 'git-worktree' | 'workspace-copy';
  isolatedRoot: string;
  tempParent: string;
  baseCommit: string | null;
  targetPath: string;
  baselineHash: string | null;
  baselineSize: number;
  baselineBackupPath: string;
  baselines: Record<string, SubAgentFileBaseline>;
  changedFiles: string[];
  mergedBytes: number;
  stagedOracleGreen: boolean;
  stagedOracleSummary: string;
  stagedAt: string;
  reviewedAt?: string;
  reviewerWorkerId?: string;
  reviewerStatus?: 'approved' | 'blocked' | 'no_changes';
  mergedAt?: string;
  cleanupSucceeded?: boolean;
  abandonmentReason?: string;
}

export interface SubAgentFileBaseline {
  path: string;
  hash: string | null;
  size: number;
  existed: boolean;
  backupPath: string;
}

export interface SubAgentMergeRecord {
  id: string;
  workerId: string;
  reviewerWorkerId: string;
  stageId: string;
  status: 'merged' | 'blocked' | 'conflict' | 'failed';
  changedFiles: string[];
  mergedBytes: number;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  cleanupSucceeded: boolean;
  createdAt: string;
  error?: string;
}

export interface SubAgentTopology {
  schemaVersion: 1;
  runId: string;
  coordinatorId: string;
  status: 'active' | 'completed' | 'failed';
  limits: SubAgentLimits;
  workers: SubAgentWorker[];
  handoffs: SubAgentHandoff[];
  merges: SubAgentMergeRecord[];
  activeWorkerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StageMutationResult extends WorkerToolResult {
  staged: boolean;
  stage?: SubAgentStage;
  oracle?: CompositeOracleResult;
  diff: string;
}

const EXCLUDED_ROOTS = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', 'coverage', 'artifacts', '.vscode-test']);
export const DEFAULT_SUBAGENT_LIMITS: SubAgentLimits = {
  maxWorkers: 5,
  maxFanOut: 3,
  maxDepth: 1,
  maxRetries: 2,
  maxLifetimeMs: 10 * 60 * 1000,
  maxChangedFiles: 200,
  maxMergeBytes: 20 * 1024 * 1024
};

type MergeFile = (stagedPath: string, targetPath: string, index: number) => void;

export class PersistentSubAgentCoordinator {
  constructor(
    private readonly sourceRootInput: string,
    private readonly worker = new ProcessWorkerExecutor(),
    private readonly mergeFile: MergeFile = (stagedPath, targetPath) => fs.copyFileSync(stagedPath, targetPath)
  ) {}

  public initialize(runId: string): SubAgentTopology {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      runId,
      coordinatorId: `${runId}:coordinator`,
      status: 'active',
      limits: { ...DEFAULT_SUBAGENT_LIMITS },
      workers: [],
      handoffs: [],
      merges: [],
      createdAt: now,
      updatedAt: now
    };
  }

  public normalize(topology: SubAgentTopology | undefined, runId: string): SubAgentTopology {
    if (!topology || topology.schemaVersion !== 1 || topology.runId !== runId || !Array.isArray(topology.workers)) {
      return this.initialize(runId);
    }
    topology.limits = { ...DEFAULT_SUBAGENT_LIMITS, ...(topology.limits || {}) };
    topology.handoffs = Array.isArray(topology.handoffs) ? topology.handoffs : [];
    topology.merges = Array.isArray(topology.merges) ? topology.merges : [];
    for (const worker of topology.workers) {
      worker.usage = { ...emptyUsage(), ...(worker.usage || {}) };
      if (worker.staging && !worker.staging.baselines) {
        worker.staging.baselines = {
          [worker.staging.targetPath]: {
            path: worker.staging.targetPath,
            hash: worker.staging.baselineHash,
            size: worker.staging.baselineSize,
            existed: worker.staging.baselineHash !== null,
            backupPath: worker.staging.baselineBackupPath
          }
        };
      }
      if (worker.staging && !fs.existsSync(worker.staging.isolatedRoot) && !['merged', 'abandoned'].includes(worker.status)) {
        worker.status = 'abandoned';
        worker.staging.cleanupSucceeded = true;
        worker.staging.abandonmentReason = 'Retained staging root was missing during resume; no merge was attempted.';
      } else if (worker.staging && Date.now() > Date.parse(worker.expiresAt) && !['merged', 'abandoned'].includes(worker.status)) {
        this.abandonStage(worker, 'abandoned');
        worker.staging.abandonmentReason = `Worker lifetime ${topology.limits.maxLifetimeMs}ms expired before resume; no merge was attempted.`;
      }
    }
    return topology;
  }

  public ensureWorker(
    topology: SubAgentTopology,
    task: TaskItem,
    modelId: string,
    allowedTools: ToolName[],
    requestedBy: 'coordinator' = 'coordinator'
  ): SubAgentWorker {
    if (requestedBy !== 'coordinator') throw new Error('Sub-agents cannot spawn sub-agents.');
    const role = normalizeRole(task.owner);
    const id = stableWorkerId(topology.runId, role, task.id);
    let worker = topology.workers.find(item => item.id === id);
    if (worker) {
      if (worker.parentId !== 'coordinator' || worker.depth !== 1 || worker.role !== role || (role !== 'Reviewer' && worker.taskId !== task.id)) {
        throw new Error('Persisted sub-agent identity failed host validation.');
      }
      if (role === 'Reviewer') {
        worker.taskId = task.id;
        worker.taskTitle = task.title;
      }
      if (worker.modelId && modelId && worker.modelId !== modelId && worker.usage.providerCalls > 0) {
        throw new Error(`Worker ${worker.id} cannot change model routing after its first provider call.`);
      }
      if (!sameTools(worker.allowedTools, allowedTools)) throw new Error(`Worker ${worker.id} cannot widen or alter its tool ceiling.`);
      if (Date.now() > Date.parse(worker.expiresAt)) {
        this.abandonStage(worker, 'abandoned');
        if (worker.staging) worker.staging.abandonmentReason = `Worker lifetime ${topology.limits.maxLifetimeMs}ms expired before another action.`;
        throw new Error(`Worker ${worker.id} exceeded its ${topology.limits.maxLifetimeMs}ms lifetime.`);
      }
      if (worker.status === 'completed' || worker.status === 'idle') worker.status = 'idle';
    } else {
      if (topology.workers.length >= topology.limits.maxWorkers) throw new Error(`Sub-agent worker cap ${topology.limits.maxWorkers} exceeded.`);
      const active = topology.workers.filter(item => ['idle', 'running', 'staged', 'blocked'].includes(item.status));
      if (active.length >= topology.limits.maxFanOut) throw new Error(`Sub-agent fan-out cap ${topology.limits.maxFanOut} exceeded.`);
      const now = Date.now();
      worker = {
        id,
        parentId: 'coordinator',
        depth: 1,
        role,
        taskId: task.id,
        taskTitle: task.title,
        sessionId: `${topology.runId}:subagent:${role.toLowerCase()}:${task.id.replace(/[^a-z0-9_-]/gi, '-')}`,
        modelId,
        allowedTools: [...allowedTools],
        status: 'idle',
        retries: 0,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + topology.limits.maxLifetimeMs).toISOString(),
        usage: emptyUsage()
      };
      topology.workers.push(worker);
    }
    const previousWorkerId = topology.activeWorkerId || '';
    if (previousWorkerId && previousWorkerId !== worker.id) {
      const source = topology.workers.find(item => item.id === previousWorkerId);
      if (source) {
        if (source.status === 'idle' || source.status === 'running') source.status = 'completed';
        this.addHandoff(topology, source, worker, task, '', [], []);
      }
    }
    topology.activeWorkerId = worker.id;
    topology.updatedAt = new Date().toISOString();
    return worker;
  }

  public addHandoff(
    topology: SubAgentTopology,
    source: SubAgentWorker,
    target: SubAgentWorker,
    task: TaskItem,
    planExcerpt: string,
    focusFiles: string[],
    evidenceDigests: string[]
  ): SubAgentHandoff {
    if (source.id === target.id) throw new Error('A worker cannot hand off to itself.');
    const handoff: SubAgentHandoff = {
      id: `handoff-${crypto.randomUUID()}`,
      sourceWorkerId: source.id,
      targetWorkerId: target.id,
      sourceRole: source.role,
      targetRole: target.role,
      taskId: task.id,
      createdAt: new Date().toISOString(),
      brief: `${target.role} owns ${task.title}`.slice(0, 500),
      planExcerpt: String(planExcerpt || '').slice(0, 16_000),
      focusFiles: Array.from(new Set(focusFiles.map(normalizeRel).filter(Boolean))).slice(0, 12),
      evidenceDigests: evidenceDigests.slice(-8).map(item => String(item).slice(0, 128)),
      rawTranscriptIncluded: false
    };
    topology.handoffs.push(handoff);
    topology.handoffs = topology.handoffs.slice(-100);
    topology.updatedAt = handoff.createdAt;
    return handoff;
  }

  public recordProvider(worker: SubAgentWorker, modelId: string, usage: ChatUsage | undefined, latencyMs: number, failed = false): void {
    if (worker.modelId && worker.modelId !== modelId && worker.usage.providerCalls > 0) throw new Error('Worker model routing is immutable after first use.');
    worker.modelId = modelId;
    worker.usage.providerCalls += 1;
    worker.usage.providerFailures += failed ? 1 : 0;
    worker.usage.promptTokens += usage?.promptTokens || 0;
    worker.usage.completionTokens += usage?.completionTokens || 0;
    worker.usage.costUsd += usage?.totalCost || 0;
    worker.usage.latencyMs += Math.max(0, latencyMs);
    worker.updatedAt = new Date().toISOString();
  }

  public recordFallback(worker: SubAgentWorker): void {
    worker.usage.fallbackProposals += 1;
    worker.updatedAt = new Date().toISOString();
  }

  public stagedContext(worker: SubAgentWorker): { changedFiles: string[]; oracleSummary: string; diff: string } | undefined {
    const stage = worker.staging;
    if (!stage || !fs.existsSync(stage.isolatedRoot)) return undefined;
    const diff = stage.changedFiles
      .map(rel => renderDiff(rel, readBaseline(stage.baselines[rel]), readOptional(containedPath(stage.isolatedRoot, rel))))
      .join('\n\n')
      .slice(0, 16_000) || 'No changes.';
    return { changedFiles: [...stage.changedFiles], oracleSummary: stage.stagedOracleSummary, diff };
  }

  public stagingRoot(worker: SubAgentWorker): string | undefined {
    const root = worker.staging?.isolatedRoot;
    return root && fs.existsSync(root) ? root : undefined;
  }

  public transferStage(topology: SubAgentTopology, source: SubAgentWorker, target: SubAgentWorker): void {
    if (source.role !== 'Editor' || target.role !== 'Escalation' || source.taskId !== target.taskId) {
      throw new Error('Only the host coordinator may transfer an Editor stage to its task-matched Escalation worker.');
    }
    if (!source.staging || target.staging) return;
    if (!fs.existsSync(source.staging.isolatedRoot)) throw new Error('Cannot transfer a missing retained staging root.');
    target.staging = source.staging;
    source.staging = undefined;
    source.status = 'completed';
    target.status = 'blocked';
    const now = new Date().toISOString();
    source.updatedAt = now;
    target.updatedAt = now;
    topology.updatedAt = now;
  }

  public async stageNativeMutation(topology: SubAgentTopology, worker: SubAgentWorker, proposal: ToolProposal): Promise<StageMutationResult> {
    if (!['Editor', 'Escalation'].includes(worker.role)) throw new Error(`${worker.role} cannot own a mutating staging workspace.`);
    if (!worker.allowedTools.includes(proposal.name)) throw new Error(`${worker.role} cannot stage ${proposal.name}.`);
    if (!['apply_patch', 'write_file'].includes(proposal.name)) throw new Error(`Persistent staging accepts native file mutations only, received ${proposal.name}.`);
    if (worker.retries > topology.limits.maxRetries) throw new Error(`Worker ${worker.id} retry cap exceeded.`);
    worker.status = 'running';
    const stage = worker.staging && fs.existsSync(worker.staging.isolatedRoot)
      ? worker.staging
      : this.createStage(worker, proposal);
    worker.staging = stage;
    stage.targetPath = normalizeRel(String(proposal.arguments.path || ''));
    this.captureBaseline(stage, stage.targetPath);
    const result = await this.worker.dispatch(stage.isolatedRoot, worker.role, proposal);
    worker.usage.toolCalls += 1;
    worker.usage.toolFailures += result.success ? 0 : 1;
    if (!result.success) {
      worker.retries += 1;
      worker.status = 'blocked';
      return { ...result, staged: true, stage, diff: '' };
    }
    stage.changedFiles = Object.values(stage.baselines)
      .filter(baseline => !sameBytes(readBaseline(baseline), readOptional(containedPath(stage.isolatedRoot, baseline.path))))
      .map(baseline => baseline.path)
      .sort((a, b) => a.localeCompare(b));
    stage.mergedBytes = stage.changedFiles.reduce((total, rel) => total + (readOptional(containedPath(stage.isolatedRoot, rel))?.length || 0), 0);
    if (stage.changedFiles.length > topology.limits.maxChangedFiles || stage.mergedBytes > topology.limits.maxMergeBytes) {
      worker.status = 'blocked';
      worker.retries += 1;
      worker.usage.toolFailures += 1;
      return { ...result, success: false, output: `Staged change exceeded coordinator bounds: files=${stage.changedFiles.length}, bytes=${stage.mergedBytes}.`, staged: true, stage, diff: '' };
    }
    const oracle = await this.runStagedOracles(stage);
    stage.stagedOracleGreen = oracle.pass;
    stage.stagedOracleSummary = oracle.summary;
    if (!oracle.pass) worker.retries += 1;
    worker.status = oracle.pass ? 'staged' : 'blocked';
    worker.updatedAt = new Date().toISOString();
    topology.updatedAt = worker.updatedAt;
    const diff = stage.changedFiles
      .map(rel => renderDiff(rel, readBaseline(stage.baselines[rel]), readOptional(containedPath(stage.isolatedRoot, rel))))
      .join('\n\n')
      .slice(0, 16_000) || 'No changes.';
    return {
      ...result,
      success: result.success && oracle.pass,
      output: oracle.pass ? `${result.output}\nStaged composite oracle green: ${oracle.summary}` : `${result.output}\nStaged composite oracle red: ${oracle.summary}`,
      staged: true,
      stage,
      oracle,
      diff
    };
  }

  public mergeApproved(topology: SubAgentTopology, worker: SubAgentWorker, reviewer: SubAgentWorker, status: 'approved' | 'blocked' | 'no_changes'): SubAgentMergeRecord {
    const stage = worker.staging;
    if (!stage) throw new Error(`Worker ${worker.id} has no staged workspace.`);
    stage.reviewedAt = new Date().toISOString();
    stage.reviewerWorkerId = reviewer.id;
    stage.reviewerStatus = status;
    const record: SubAgentMergeRecord = {
      id: `merge-${crypto.randomUUID()}`,
      workerId: worker.id,
      reviewerWorkerId: reviewer.id,
      stageId: stage.id,
      status: 'failed',
      changedFiles: [...stage.changedFiles],
      mergedBytes: 0,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      cleanupSucceeded: false,
      createdAt: new Date().toISOString()
    };
    if (status === 'blocked' || (status === 'no_changes' && stage.changedFiles.length > 0) || !stage.stagedOracleGreen) {
      record.status = 'blocked';
      record.error = status === 'blocked' ? 'Independent Reviewer blocked the staged diff.' : !stage.stagedOracleGreen ? 'Staged composite oracle is red.' : 'Reviewer reported no changes for a non-empty staged diff.';
      worker.status = 'blocked';
      topology.merges.push(record);
      return record;
    }
    for (const rel of stage.changedFiles) {
      const baseline = stage.baselines[rel];
      const current = fileState(containedPath(this.sourceRoot(), rel));
      if (!baseline || current.hash !== baseline.hash || current.size !== baseline.size) {
        record.status = 'conflict';
        record.error = `Active workspace changed after worker staging: ${rel}.`;
        worker.status = 'blocked';
        topology.merges.push(record);
        return record;
      }
    }
    const backups = new Map(stage.changedFiles.map(rel => [rel, readBaseline(stage.baselines[rel])]));
    try {
      for (const [index, rel] of stage.changedFiles.entries()) {
        const source = containedPath(this.sourceRoot(), rel);
        const staged = containedPath(stage.isolatedRoot, rel);
        if (!fs.existsSync(staged)) fs.rmSync(source, { force: true });
        else {
          fs.mkdirSync(path.dirname(source), { recursive: true });
          this.mergeFile(staged, source, index);
        }
      }
      record.status = 'merged';
      record.mergedBytes = stage.mergedBytes;
      worker.status = 'merged';
      worker.usage.solvedWork += 1;
      stage.mergedAt = new Date().toISOString();
    } catch (error: any) {
      record.status = 'failed';
      record.rollbackAttempted = true;
      try {
        for (const rel of stage.changedFiles) {
          const source = containedPath(this.sourceRoot(), rel);
          const backup = backups.get(rel) ?? null;
          if (backup === null) fs.rmSync(source, { force: true });
          else {
            fs.mkdirSync(path.dirname(source), { recursive: true });
            fs.writeFileSync(source, backup);
          }
        }
        record.rollbackSucceeded = true;
      } catch {
        record.rollbackSucceeded = false;
      }
      record.error = `Sub-agent merge failed: ${error.message}`;
      worker.status = 'failed';
    } finally {
      record.cleanupSucceeded = this.cleanupStage(stage);
      stage.cleanupSucceeded = record.cleanupSucceeded;
    }
    topology.merges.push(record);
    topology.updatedAt = new Date().toISOString();
    return record;
  }

  public abandonStage(worker: SubAgentWorker, status: 'blocked' | 'failed' | 'abandoned' = 'blocked'): boolean {
    if (!worker.staging) {
      worker.status = status;
      return true;
    }
    const cleaned = this.cleanupStage(worker.staging);
    worker.staging.cleanupSucceeded = cleaned;
    worker.staging.abandonmentReason = `Stage abandoned with worker status ${status}; no merge was attempted.`;
    worker.status = status;
    worker.retries += 1;
    worker.updatedAt = new Date().toISOString();
    return cleaned;
  }

  public persist(topology: SubAgentTopology): void {
    const root = path.join(this.sourceRoot(), '.forge');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'subagent-topology.json'), JSON.stringify(topology, null, 2), 'utf8');
    fs.writeFileSync(path.join(root, 'subagent-handoffs.json'), JSON.stringify(topology.handoffs, null, 2), 'utf8');
    fs.writeFileSync(path.join(root, 'subagent-merges.json'), JSON.stringify(topology.merges, null, 2), 'utf8');
    const metrics = topology.workers.map(worker => ({ workerId: worker.id, role: worker.role, taskId: worker.taskId, modelId: worker.modelId, status: worker.status, ...worker.usage }));
    fs.writeFileSync(path.join(root, 'subagent-metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
  }

  private createStage(worker: SubAgentWorker, proposal: ToolProposal): SubAgentStage {
    const sourceRoot = this.sourceRoot();
    const targetPath = normalizeRel(String(proposal.arguments.path || ''));
    const git = detectGit(sourceRoot);
    const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), git.ok ? 'forge-subagent-wt-' : 'forge-subagent-copy-'));
    const isolatedRoot = path.join(tempParent, git.ok ? 'worktree' : 'workspace');
    if (git.ok) {
      runGit(sourceRoot, ['worktree', 'add', '--detach', isolatedRoot, 'HEAD']);
      overlayWorkspace(sourceRoot, isolatedRoot);
    } else {
      fs.mkdirSync(isolatedRoot, { recursive: true });
      overlayWorkspace(sourceRoot, isolatedRoot);
    }
    const stage: SubAgentStage = {
      id: `stage-${crypto.randomUUID()}`,
      mode: git.ok ? 'git-worktree' : 'workspace-copy',
      isolatedRoot,
      tempParent,
      baseCommit: git.head,
      targetPath,
      baselineHash: null,
      baselineSize: 0,
      baselineBackupPath: path.join(tempParent, 'baselines', 'initial.bin'),
      baselines: {},
      changedFiles: [],
      mergedBytes: 0,
      stagedOracleGreen: false,
      stagedOracleSummary: 'not run',
      stagedAt: new Date().toISOString()
    };
    this.captureBaseline(stage, targetPath);
    const initial = stage.baselines[targetPath];
    stage.baselineHash = initial.hash;
    stage.baselineSize = initial.size;
    stage.baselineBackupPath = initial.backupPath;
    return stage;
  }

  private captureBaseline(stage: SubAgentStage, rel: string): void {
    if (stage.baselines[rel]) return;
    const source = containedPath(this.sourceRoot(), rel);
    const state = fileState(source);
    const backupPath = path.join(stage.tempParent, 'baselines', `${crypto.createHash('sha256').update(rel).digest('hex')}.bin`);
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(source, backupPath);
    }
    stage.baselines[rel] = { path: rel, hash: state.hash, size: state.size, existed: fs.existsSync(source), backupPath };
  }

  private async runStagedOracles(stage: SubAgentStage): Promise<CompositeOracleResult> {
    const sourceBin = path.join(this.sourceRoot(), 'node_modules', '.bin');
    const sourceModules = path.join(this.sourceRoot(), 'node_modules');
    const env = fs.existsSync(sourceModules) ? { PATH: `${sourceBin}${path.delimiter}${process.env.PATH || ''}`, NODE_PATH: sourceModules } : undefined;
    return new VerificationOracles(stage.isolatedRoot, env).runAll();
  }

  private cleanupStage(stage: SubAgentStage): boolean {
    try {
      if (stage.mode === 'git-worktree') {
        try { runGit(this.sourceRoot(), ['worktree', 'remove', '--force', stage.isolatedRoot]); } catch { /* filesystem cleanup below */ }
        try { runGit(this.sourceRoot(), ['worktree', 'prune']); } catch { /* best effort */ }
      }
      fs.rmSync(stage.tempParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return !fs.existsSync(stage.tempParent);
    } catch {
      return false;
    }
  }

  private sourceRoot(): string { return fs.realpathSync(this.sourceRootInput); }
}

function emptyUsage(): SubAgentUsage {
  return { providerCalls: 0, providerFailures: 0, fallbackProposals: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0, toolCalls: 0, toolFailures: 0, solvedWork: 0 };
}

function normalizeRole(value: string): SubAgentRole {
  return ['Explorer', 'Architect', 'Editor', 'Reviewer', 'Escalation'].includes(value) ? value as SubAgentRole : 'Orchestrator';
}

function stableWorkerId(runId: string, role: string, taskId: string): string {
  const key = role === 'Reviewer' ? 'review' : taskId.replace(/[^a-z0-9_-]/gi, '-');
  return `${runId}:worker:${role.toLowerCase()}:${key}`;
}

function sameTools(left: ToolName[], right: ToolName[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|');
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function containedPath(root: string, rel: string): string {
  if (!rel || path.isAbsolute(rel)) throw new Error(`Sub-agent path must be workspace-relative: ${rel}`);
  const realRoot = fs.realpathSync(root);
  const resolved = path.resolve(realRoot, rel);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`Sub-agent path escapes workspace: ${rel}`);
  return resolved;
}

function fileState(filePath: string): { hash: string | null; size: number } {
  if (!fs.existsSync(filePath)) return { hash: null, size: 0 };
  const bytes = fs.readFileSync(filePath);
  return { hash: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

function readOptional(filePath: string): Buffer | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function readBaseline(baseline: SubAgentFileBaseline): Buffer | null {
  return baseline.existed && fs.existsSync(baseline.backupPath) ? fs.readFileSync(baseline.backupPath) : null;
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function renderDiff(rel: string, before: Buffer | null, after: Buffer | null): string {
  if (sameBytes(before, after)) return 'No changes.';
  const beforeText = before ? before.toString('utf8') : '';
  const afterText = after ? after.toString('utf8') : '';
  return [`--- a/${rel}`, `+++ b/${rel}`, '@@ staged worker change @@', ...beforeText.split(/\r?\n/).slice(0, 120).map(line => `-${line}`), ...afterText.split(/\r?\n/).slice(0, 120).map(line => `+${line}`)].join('\n').slice(0, 16_000);
}

function detectGit(root: string): { ok: boolean; head: string | null } {
  try {
    if (runGit(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { ok: false, head: null };
    return { ok: true, head: runGit(root, ['rev-parse', '--verify', 'HEAD']) };
  } catch { return { ok: false, head: null }; }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function overlayWorkspace(sourceRoot: string, targetRoot: string): void {
  const visit = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (EXCLUDED_ROOTS.has(entry.name) || entry.name.endsWith('.vsix') || entry.isSymbolicLink()) continue;
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
