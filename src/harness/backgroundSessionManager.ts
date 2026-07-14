import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { assuranceSuccessGate, executionContractDigest } from './executionContract';
import { cleanupIsolatedWorkspace, IsolationMode, prepareIsolatedWorkspace, PreparedIsolation } from './isolation';
import { VerificationOracles, CompositeOracleResult } from './oracles';
import { HarnessState } from './types';
import { BackgroundBaseline, BackgroundSessionStore, BackgroundSessionV1, changedAgainstBaseline, fileBaseline, workspaceBaseline } from './backgroundSessions';
import { discoverCustomizations, effectiveCustomizationDigest } from './customizationCompatibility';

export interface BackgroundLaunchRequest {
  manifestPath: string;
  logPath: string;
  sessionId: string;
}

export interface BackgroundMergeResult {
  merged: boolean;
  rolledBack: boolean;
  changedFiles: string[];
  oracle: CompositeOracleResult;
  evidencePath: string;
}

export type BackgroundLauncher = (request: BackgroundLaunchRequest) => Promise<{ pid: number }>;

const MAX_MERGE_FILES = 200;
const MAX_MERGE_BYTES = 20 * 1024 * 1024;

export class BackgroundSessionManager {
  public readonly store: BackgroundSessionStore;

  constructor(private readonly sourceRoot: string, private readonly launcher: BackgroundLauncher) {
    this.sourceRoot = fs.realpathSync(sourceRoot);
    this.store = new BackgroundSessionStore(this.sourceRoot);
  }

  public async start(state: HarnessState, isolationMode: IsolationMode = 'auto'): Promise<BackgroundSessionV1> {
    this.assertEligibleState(state);
    const sessionId = state.sessionId;
    this.store.acquireWorkspaceLease(sessionId);
    let prepared: PreparedIsolation | undefined;
    let created = false;
    try {
      prepared = prepareIsolatedWorkspace(this.sourceRoot, isolationMode);
      const baseline = workspaceBaseline(this.sourceRoot);
      this.writeIsolatedState(prepared.isolatedRoot, state);
      const now = new Date().toISOString();
      const sessionDir = path.join(this.store.root, sessionId);
      const manifest: BackgroundSessionV1 = {
        schemaVersion: 1,
        sessionId,
        workspaceId: this.store.workspaceId(),
        sourceRoot: this.sourceRoot,
        isolatedRoot: prepared.isolatedRoot,
        tempParent: prepared.tempParent,
        isolationMode: prepared.mode,
        isolationFallbackReason: prepared.fallbackReason,
        baseCommit: prepared.baseCommit,
        executionContract: {
          revision: state.executionContract.revision,
          digest: state.executionContract.digest,
          assurance: state.executionContract.authority.assurance
        },
        modelBindings: { ...state.executionContract.authority.modelBindings },
        budget: {
          maxSteps: state.executionContract.authority.budget.maxSteps,
          maxCostUsd: state.executionContract.authority.budget.maxCostUsd
        },
        status: 'preparing',
        startedAt: now,
        updatedAt: now,
        baseline,
        changedFiles: [],
        statePath: path.join(prepared.isolatedRoot, '.forge', 'state.json'),
        logPath: path.join(sessionDir, 'runner.log'),
        merge: { status: 'pending' }
      };
      this.store.create(manifest);
      created = true;
      const launched = await this.launcher({ manifestPath: this.store.manifestPath(sessionId), logPath: manifest.logPath, sessionId });
      return this.store.update(sessionId, current => ({ ...current, status: 'running', pid: launched.pid, heartbeatAt: new Date().toISOString() }));
    } catch (error) {
      this.store.releaseWorkspaceLease(sessionId);
      if (created) {
        try { this.store.update(sessionId, current => ({ ...current, status: 'failed', error: String((error as any)?.message || error).slice(0, 2_000), pid: undefined, exitCode: 1 })); } catch { /* original launch error remains authoritative */ }
      }
      if (prepared) cleanupIsolatedWorkspace(prepared);
      throw error;
    }
  }

  public async resume(sessionId: string): Promise<BackgroundSessionV1> {
    const session = this.store.load(sessionId);
    if (!['failed', 'gave_up', 'awaiting_input', 'awaiting_approval', 'cancelled'].includes(session.status) && !this.store.isStale(session)) {
      throw new Error(`Background session cannot resume from ${session.status}.`);
    }
    this.assertRetainedSession(session);
    const state = readState(session.statePath);
    if (session.status === 'failed' || (session.status === 'gave_up' && !state.runBudget?.haltReason)) throw new Error(`Terminal background state ${session.status} cannot be resurrected.`);
    if ((session.status === 'awaiting_input' || session.status === 'awaiting_approval') && (state.status === 'awaiting_input' || state.status === 'awaiting_approval')) throw new Error('Resolve the background ask gate before resuming.');
    this.store.acquireWorkspaceLease(sessionId, true);
    try {
      const launched = await this.launcher({ manifestPath: this.store.manifestPath(sessionId), logPath: session.logPath, sessionId });
      return this.store.update(sessionId, current => ({ ...current, status: 'running', pid: launched.pid, heartbeatAt: new Date().toISOString(), error: undefined, exitCode: undefined }));
    } catch (error) {
      this.store.releaseWorkspaceLease(sessionId);
      throw error;
    }
  }

  public async cancel(sessionId: string, graceMs = 3_000): Promise<BackgroundSessionV1> {
    const session = this.store.load(sessionId);
    if (session.status === 'running' && session.pid && !this.store.isStale(session)) {
      this.store.requestCancel(sessionId);
      const deadline = Date.now() + Math.max(100, Math.min(graceMs, 10_000));
      while (Date.now() < deadline) {
        await delay(100);
        const current = this.store.load(sessionId);
        if (current.status !== 'running') return current;
      }
      try { process.kill(session.pid); } catch { /* process already exited */ }
    }
    this.store.releaseWorkspaceLease(sessionId);
    return this.store.update(sessionId, current => ({ ...current, status: 'cancelled', pid: undefined, exitCode: 0 }));
  }

  public list(): Array<BackgroundSessionV1 & { stale: boolean }> {
    return this.store.list().map(session => ({ ...session, stale: this.store.isStale(session) }));
  }

  public reviewCopies(sessionId: string): Array<{ path: string; sourcePath: string; isolatedPath: string }> {
    const session = this.store.load(sessionId);
    this.assertRetainedSession(session);
    const changed = changedAgainstBaseline(session.isolatedRoot, session.baseline);
    const reviewRoot = path.join(this.store.root, sessionId, 'review');
    fs.rmSync(reviewRoot, { recursive: true, force: true });
    const copies = changed.map(relative => {
      const sourceCopy = path.join(reviewRoot, 'source', relative);
      const isolatedCopy = path.join(reviewRoot, 'isolated', relative);
      copyOrPlaceholder(contained(this.sourceRoot, relative), sourceCopy, 'File does not exist in the source workspace.');
      copyOrPlaceholder(contained(session.isolatedRoot, relative), isolatedCopy, 'File was deleted by the background session.');
      return { path: relative, sourcePath: sourceCopy, isolatedPath: isolatedCopy };
    });
    const digest = this.currentReviewDigest(session);
    this.store.update(sessionId, current => ({ ...current, merge: { ...current.merge!, status: 'pending', reviewOpenedAt: new Date().toISOString(), reviewOpenedDigest: digest } }));
    return copies;
  }

  public approveReview(sessionId: string): BackgroundSessionV1 {
    const session = this.store.load(sessionId);
    if (session.status !== 'awaiting_review' || session.merge?.status === 'merged') throw new Error('Background session is not awaiting review.');
    this.assertRetainedSession(session);
    const state = readState(session.statePath);
    this.assertStateIdentity(session, state);
    const modelReview = [...(state.reviewerCritiques || [])].reverse().find(item => item.source === 'model' && item.status === 'approved');
    const diffReview = [...(state.diffReviews || [])].reverse().find(item => item.status === 'approved');
    if (!modelReview || !diffReview) throw new Error('Independent model and deterministic diff reviews are not approved.');
    const digest = this.currentReviewDigest(session);
    if (session.merge?.reviewOpenedDigest !== digest) throw new Error('Open the current background diff in the native review editor before approving it.');
    return this.store.update(sessionId, current => ({
      ...current,
      merge: { ...current.merge!, status: 'pending', reviewedAt: new Date().toISOString(), reviewDigest: digest, reviewerModelId: modelReview.modelId }
    }));
  }

  public async merge(sessionId: string): Promise<BackgroundMergeResult> {
    let session = this.store.load(sessionId);
    if (session.status !== 'awaiting_review' || session.merge?.status === 'merged') throw new Error('Background session is not awaiting reviewed merge.');
    if (session.pid || this.store.isStale(session)) throw new Error('Background runner must be stopped before merge.');
    this.assertRetainedSession(session);
    const state = readState(session.statePath);
    this.assertStateIdentity(session, state);
    const assurance = assuranceSuccessGate(state);
    if (state.status !== 'success' || !assurance.ready) throw new Error(`Isolated success gate is not green: ${assurance.missing.join(', ') || state.status}.`);
    const modelReview = (state.reviewerCritiques || []).some(item => item.source === 'model' && item.status === 'approved');
    const diffReview = (state.diffReviews || []).some(item => item.status === 'approved');
    if (!modelReview || !diffReview) throw new Error('Background merge requires an approved independent model review and deterministic diff review.');
    if (!session.merge?.reviewDigest || session.merge.reviewDigest !== this.currentReviewDigest(session)) throw new Error('Background diff changed after host review; review it again before merge.');

    const changedFiles = changedAgainstBaseline(session.isolatedRoot, session.baseline, MAX_MERGE_FILES);
    if (!changedFiles.length) throw new Error('Background merge has no changed files.');
    this.assertSourceBaselines(session.baseline, changedFiles);
    let mergedBytes = 0;
    for (const relative of changedFiles) {
      const staged = contained(session.isolatedRoot, relative);
      if (!fs.existsSync(staged)) continue;
      const stat = fs.lstatSync(staged);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe staged merge path: ${relative}`);
      mergedBytes += stat.size;
      if (mergedBytes > MAX_MERGE_BYTES) throw new Error(`Background merge exceeds ${MAX_MERGE_BYTES} bytes.`);
    }

    const backups = new Map<string, Buffer | null>();
    for (const relative of changedFiles) {
      const target = contained(this.sourceRoot, relative);
      backups.set(relative, fs.existsSync(target) ? fs.readFileSync(target) : null);
    }
    session = this.store.update(sessionId, current => ({ ...current, merge: { ...current.merge!, status: 'pending' } }));
    let oracle: CompositeOracleResult;
    let rolledBack = false;
    try {
      for (const relative of changedFiles) {
        const staged = contained(session.isolatedRoot, relative);
        const target = contained(this.sourceRoot, relative);
        if (!fs.existsSync(staged)) fs.rmSync(target, { force: true });
        else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const temp = `${target}.forge-merge-${process.pid}-${Date.now()}`;
          fs.copyFileSync(staged, temp);
          fs.renameSync(temp, target);
        }
      }
      oracle = await this.sourceOracles();
      if (!oracle.pass) throw new OracleFailure(oracle);
    } catch (error: any) {
      let rollbackError: any;
      try {
        restoreBackups(this.sourceRoot, backups);
        rolledBack = true;
      } catch (restoreError: any) {
        rollbackError = restoreError;
      }
      oracle = error instanceof OracleFailure ? error.oracle : await this.sourceOracles();
      const combinedError = rollbackError
        ? `${String(error?.message || error)}; ROLLBACK FAILED: ${String(rollbackError?.message || rollbackError)}`
        : String(error?.message || error);
      this.store.update(sessionId, current => ({ ...current, merge: { ...current.merge!, status: rollbackError ? 'blocked' : 'rolled_back', error: combinedError.slice(0, 2_000) } }));
      const evidencePath = this.writeMergeEvidence(sessionId, { merged: false, rolledBack, changedFiles, oracle, error: combinedError });
      if (rollbackError) throw new Error(combinedError);
      return { merged: false, rolledBack, changedFiles, oracle, evidencePath };
    }
    this.store.update(sessionId, current => ({ ...current, merge: { ...current.merge!, status: 'merged', mergedAt: new Date().toISOString() } }));
    const evidencePath = this.writeMergeEvidence(sessionId, { merged: true, rolledBack: false, changedFiles, oracle });
    return { merged: true, rolledBack: false, changedFiles, oracle, evidencePath };
  }

  private assertEligibleState(state: HarnessState): void {
    if (!state || !state.sessionId || !state.executionContract) throw new Error('A persisted Forge run is required.');
    this.assertStateIdentityContract(state);
    this.assertSourceCustomization(state.executionContract.authority.customizationDigest || '');
    if (state.executionContract.status !== 'confirmed' || !state.executionContract.availability.available) throw new Error('Background execution requires a confirmed and available execution contract.');
    if (['success', 'failed', 'gave_up', 'awaiting_input', 'awaiting_approval'].includes(state.status)) throw new Error(`Run status ${state.status} is not eligible for background execution.`);
    if (state.pendingHumanApproval?.status === 'pending' || (state.clarifications || []).some(item => item.status === 'pending')) throw new Error('Resolve pending approval or clarification before starting a background session.');
  }

  private assertRetainedSession(session: BackgroundSessionV1): void {
    if (!fs.existsSync(session.isolatedRoot) || !fs.statSync(session.isolatedRoot).isDirectory()) throw new Error('Retained background workspace is missing.');
    const state = readState(session.statePath);
    this.assertStateIdentity(session, state);
    this.assertSourceCustomization(state.executionContract.authority.customizationDigest || '');
  }

  private assertSourceCustomization(expectedDigest: string): void {
    const actualDigest = effectiveCustomizationDigest(discoverCustomizations(this.sourceRoot));
    if (actualDigest !== expectedDigest) throw new Error('Workspace customizations changed after background authority was confirmed; return to the foreground and confirm a new execution contract.');
  }

  private assertStateIdentity(session: BackgroundSessionV1, state: HarnessState): void {
    this.assertStateIdentityContract(state);
    if (state.sessionId !== session.sessionId || state.executionContract.digest !== session.executionContract.digest || state.executionContract.revision !== session.executionContract.revision) {
      throw new Error('Background run state does not match its manifest contract.');
    }
  }

  private assertStateIdentityContract(state: HarnessState): void {
    if (state.executionContract.sessionId !== state.sessionId || executionContractDigest(state.executionContract.authority) !== state.executionContract.digest) throw new Error('Execution contract identity or digest is invalid.');
  }

  private writeIsolatedState(isolatedRoot: string, state: HarnessState): void {
    const forge = path.join(isolatedRoot, '.forge');
    fs.mkdirSync(forge, { recursive: true });
    fs.writeFileSync(path.join(forge, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  }

  private assertSourceBaselines(baseline: BackgroundBaseline[], changedFiles: string[]): void {
    const before = new Map(baseline.map(item => [item.path, item]));
    for (const relative of changedFiles) {
      const expected = before.get(relative) || { path: relative, hash: null, size: 0, existed: false };
      const current = fileBaseline(this.sourceRoot, [relative])[0];
      if (expected.existed !== current.existed || expected.hash !== current.hash) throw new Error(`Source changed since background launch: ${relative}`);
    }
  }

  private sourceOracles(): Promise<CompositeOracleResult> {
    const modules = path.join(this.sourceRoot, 'node_modules');
    const environment = fs.existsSync(modules) ? { PATH: `${path.join(modules, '.bin')}${path.delimiter}${process.env.PATH || ''}`, NODE_PATH: modules } : undefined;
    return new VerificationOracles(this.sourceRoot, environment).runAll();
  }

  private currentReviewDigest(session: BackgroundSessionV1): string {
    const changed = changedAgainstBaseline(session.isolatedRoot, session.baseline, MAX_MERGE_FILES);
    const parts = changed.map(relative => {
      const target = contained(session.isolatedRoot, relative);
      return fs.existsSync(target)
        ? `${relative}:${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`
        : `${relative}:deleted`;
    });
    return crypto.createHash('sha256').update(JSON.stringify({ contract: session.executionContract, parts })).digest('hex');
  }

  private writeMergeEvidence(sessionId: string, value: unknown): string {
    const target = path.join(this.store.root, sessionId, 'merge-evidence.json');
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ generatedAt: new Date().toISOString(), ...value as any }, null, 2), 'utf8');
    fs.renameSync(temp, target);
    return target;
  }
}

class OracleFailure extends Error {
  constructor(public readonly oracle: CompositeOracleResult) { super(`Fresh source verification failed: ${oracle.summary}`); }
}

function readState(target: string): HarnessState {
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Background run state is missing or oversized.');
  return JSON.parse(fs.readFileSync(target, 'utf8')) as HarnessState;
}

function contained(root: string, relative: string): string {
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized || path.isAbsolute(relative) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`Invalid background merge path: ${relative}`);
  const target = path.resolve(root, normalized);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Background merge path escapes root: ${relative}`);
  return target;
}

function copyOrPlaceholder(source: string, target: string, placeholder: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(source) && fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink()) fs.copyFileSync(source, target);
  else fs.writeFileSync(target, placeholder, 'utf8');
}

function restoreBackups(root: string, backups: Map<string, Buffer | null>): void {
  for (const [relative, bytes] of backups) {
    const target = contained(root, relative);
    if (bytes === null) fs.rmSync(target, { force: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
  }
}

function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
