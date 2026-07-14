import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { assuranceSuccessGate, executionContractDigest } from './executionContract';
import { cleanupIsolatedWorkspace, IsolationMode, PreparedIsolation, prepareIsolatedWorkspace } from './isolation';
import { AgentHarnessLoop } from './loop';
import { CompositeOracleResult, VerificationOracles } from './oracles';
import { createConfiguredProvider, Provider } from './provider';
import { BackgroundBaseline, changedAgainstBaseline, workspaceBaseline } from './backgroundSessions';
import { HarnessState, RunBudget } from './types';

export interface BranchCompareOptions {
  sourceRoot?: string;
  goal: string;
  candidateModels: string[];
  reviewerModel: string;
  maxSteps?: number;
  runBudget?: Partial<RunBudget>;
  maxTotalCostUsd?: number;
  isolationMode?: IsolationMode;
  keepCandidates?: boolean;
  provenance?: 'live' | 'scripted';
}

export interface BranchCandidateResult {
  candidateId: string;
  modelId: string;
  reviewerModelId: string;
  isolatedRoot: string;
  tempParent: string;
  isolationMode: 'worktree' | 'copy';
  isolationFallbackReason: string | null;
  baseCommit: string | null;
  executionContractDigest: string;
  commonAuthorityDigest: string;
  statePath: string;
  stateStatus: HarnessState['status'];
  steps: number;
  changedFiles: string[];
  sourceMutated: boolean;
  assuranceReady: boolean;
  assuranceMissing: string[];
  greenOracle: boolean;
  greenEvidence: boolean;
  deterministicDiffReview: boolean;
  independentModelReview: boolean;
  actuallyModelDriven: boolean;
  modelDrivenProposals: number;
  fallbackProposals: number;
  fallbackActions: number;
  providerCalls: number;
  providerFailures: number;
  schemaAttempts: number;
  schemaSuccesses: number;
  costUsd: number;
  providerLatencyMs: number;
  wallClockMs: number;
  eligible: boolean;
  rejectionReasons: string[];
  candidateDigest: string;
  error?: string;
}

export interface BranchCompareReport {
  schemaVersion: 1;
  comparisonId: string;
  generatedAt: string;
  provenance: 'live' | 'scripted';
  goal: string;
  sourceRoot: string;
  sourceBaselineDigest: string;
  commonContractDigest: string;
  reviewerModel: string;
  candidateCount: number;
  requestedIsolationMode: IsolationMode;
  maxSteps: number;
  maxTotalCostUsd: number;
  totalCostUsd: number;
  candidates: BranchCandidateResult[];
  ranking: string[];
  recommendedCandidateId: string | null;
  sourceMutated: boolean;
  reportPath: string;
  archivePath: string;
  reportDigest: string;
}

export interface BranchCompareControl {
  schemaVersion: 1;
  reportDigest: string;
  candidateId: string;
  reviewDigest: string;
  openedAt: string;
  approvedAt?: string;
}

export interface BranchMergeResult {
  merged: boolean;
  rolledBack: boolean;
  candidateId: string;
  changedFiles: string[];
  oracle: CompositeOracleResult;
  evidencePath: string;
}

export interface BranchCandidateExecutionContext {
  candidateId: string;
  modelId: string;
  reviewerModel: string;
  isolatedRoot: string;
  goal: string;
  maxSteps: number;
  runBudget: Partial<RunBudget>;
}

export type BranchCandidateExecutor = (context: BranchCandidateExecutionContext, provider: Provider) => Promise<HarnessState>;
export type BranchProviderFactory = (candidateId: string, modelId: string) => Provider;
export type BranchOracleRunner = (sourceRoot: string) => Promise<CompositeOracleResult>;

const MAX_CANDIDATES = 3;
const MAX_CHANGED_FILES = 200;
const MAX_MERGE_BYTES = 20 * 1024 * 1024;

export class BranchCompareCoordinator {
  private readonly sourceRoot: string;

  constructor(
    sourceRootInput: string,
    private readonly providerFactory: BranchProviderFactory = () => createConfiguredProvider(),
    private readonly candidateExecutor: BranchCandidateExecutor = executeCandidate,
    private readonly sourceOracleRunner: BranchOracleRunner = sourceRoot => new VerificationOracles(sourceRoot).runAll()
  ) {
    this.sourceRoot = fs.realpathSync(sourceRootInput);
  }

  public async run(options: BranchCompareOptions): Promise<BranchCompareReport> {
    const goal = bounded(String(options.goal || ''), 20_000);
    const models = options.candidateModels.map(value => bounded(String(value || '').trim(), 200));
    const reviewerModel = bounded(String(options.reviewerModel || '').trim(), 200);
    if (!goal) throw new Error('Branch comparison requires a goal.');
    if (models.length < 2 || models.length > MAX_CANDIDATES || models.some(model => !model)) throw new Error('Branch comparison requires two or three candidate models.');
    if (!reviewerModel) throw new Error('Branch comparison requires an independent reviewer model.');
    if ([...models, reviewerModel].some(isMetaRoute)) throw new Error('Branch comparison requires exact concrete model slugs; auto and Pareto meta-routes are not comparable.');
    if (models.includes(reviewerModel)) throw new Error('The independent reviewer model must differ from every candidate model.');
    const maxSteps = clampInteger(options.maxSteps, 30, 1, 100);
    const maxTotalCostUsd = finiteNonNegative(options.maxTotalCostUsd, 2);
    const requestedPerCandidateCost = Number(options.runBudget?.maxCostUsd);
    const perCandidateCost = Math.min(Number.isFinite(requestedPerCandidateCost) && requestedPerCandidateCost >= 0 ? requestedPerCandidateCost : Number.POSITIVE_INFINITY, maxTotalCostUsd / models.length);
    const candidateBudget = { ...(options.runBudget || {}), maxCostUsd: perCandidateCost };
    const requestedIsolationMode = options.isolationMode || 'auto';
    const sourceBaseline = workspaceBaseline(this.sourceRoot);
    const sourceBaselineDigest = baselineDigest(sourceBaseline);
    const sourceBefore = sourceBaselineDigest;
    const prepared: PreparedIsolation[] = [];
    try {
      for (let index = 0; index < models.length; index += 1) {
        const isolation = prepareIsolatedWorkspace(this.sourceRoot, requestedIsolationMode);
        const candidateBaseline = workspaceBaseline(isolation.isolatedRoot);
        if (baselineDigest(candidateBaseline) !== sourceBaselineDigest) {
          cleanupIsolatedWorkspace(isolation);
          throw new Error(`Candidate ${index + 1} did not receive the frozen source baseline.`);
        }
        prepared.push(isolation);
      }
      const provisional = await Promise.all(prepared.map(async (isolation, index) => {
        const candidateId = `candidate-${index + 1}`;
        return this.runOne({
          candidateId,
          modelId: models[index],
          reviewerModel,
          isolatedRoot: isolation.isolatedRoot,
          goal,
          maxSteps,
          runBudget: candidateBudget
        }, isolation, sourceBaseline, sourceBefore);
      }));
      const authorityDigests = new Set(provisional.map(item => item.commonAuthorityDigest).filter(Boolean));
      const commonContractDigest = authorityDigests.size === 1 ? [...authorityDigests][0] : '';
      const candidates = provisional.map(item => {
        const reasons = [...item.rejectionReasons];
        if (!commonContractDigest || item.commonAuthorityDigest !== commonContractDigest) reasons.push('candidate authority differs from the frozen comparison contract');
        return { ...item, eligible: reasons.length === 0, rejectionReasons: [...new Set(reasons)] };
      });
      const ranking = rankBranchCandidates(candidates);
      const comparisonId = `branch-compare-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const root = this.artifactRoot();
      fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
      const reportPath = path.join(root, 'latest.json');
      const archivePath = path.join(root, 'runs', `${comparisonId}.json`);
      const report: BranchCompareReport = {
        schemaVersion: 1,
        comparisonId,
        generatedAt: new Date().toISOString(),
        provenance: options.provenance === 'live' ? 'live' : 'scripted',
        goal,
        sourceRoot: this.sourceRoot,
        sourceBaselineDigest,
        commonContractDigest,
        reviewerModel,
        candidateCount: candidates.length,
        requestedIsolationMode,
        maxSteps,
        maxTotalCostUsd,
        totalCostUsd: candidates.reduce((sum, candidate) => sum + candidate.costUsd, 0),
        candidates,
        ranking,
        recommendedCandidateId: ranking[0] || null,
        sourceMutated: baselineDigest(workspaceBaseline(this.sourceRoot)) !== sourceBefore || candidates.some(item => item.sourceMutated),
        reportPath,
        archivePath,
        reportDigest: ''
      };
      if (report.sourceMutated) throw new Error('Branch candidate execution changed the active source workspace.');
      report.reportDigest = branchCompareReportDigest(report);
      writeJsonAtomic(archivePath, report, true);
      writeJsonAtomic(reportPath, report, false);
      fs.writeFileSync(path.join(root, 'latest-summary.md'), renderSummary(report), 'utf8');
      fs.rmSync(path.join(root, 'control.json'), { force: true });
      return report;
    } catch (error) {
      for (const isolation of prepared) cleanupIsolatedWorkspace(isolation);
      throw error;
    }
  }

  public loadLatest(): BranchCompareReport {
    const report = JSON.parse(fs.readFileSync(path.join(this.artifactRoot(), 'latest.json'), 'utf8')) as BranchCompareReport;
    this.validateReport(report);
    return report;
  }

  public reviewCopies(candidateId: string): Array<{ path: string; sourcePath: string; candidatePath: string }> {
    const report = this.loadLatest();
    const candidate = this.requireEligibleCandidate(report, candidateId);
    this.validateCandidateCurrent(report, candidate);
    this.assertSourceCurrent(report);
    const reviewRoot = path.join(this.artifactRoot(), 'review', report.comparisonId, candidate.candidateId);
    fs.rmSync(reviewRoot, { recursive: true, force: true });
    const copies = candidate.changedFiles.map(relative => {
      const sourcePath = path.join(reviewRoot, 'source', relative);
      const candidatePath = path.join(reviewRoot, 'candidate', relative);
      copyOrPlaceholder(contained(this.sourceRoot, relative), sourcePath, 'File does not exist in the source workspace.');
      copyOrPlaceholder(contained(candidate.isolatedRoot, relative), candidatePath, 'File was deleted by this candidate.');
      return { path: relative, sourcePath, candidatePath };
    });
    if (!copies.length) throw new Error('The recommended candidate has no changed files to review.');
    const control: BranchCompareControl = {
      schemaVersion: 1,
      reportDigest: report.reportDigest,
      candidateId: candidate.candidateId,
      reviewDigest: this.reviewDigest(report, candidate),
      openedAt: new Date().toISOString()
    };
    writeJsonAtomic(path.join(this.artifactRoot(), 'control.json'), control, false);
    return copies;
  }

  public approveCandidate(candidateId: string): BranchCompareControl {
    const report = this.loadLatest();
    const candidate = this.requireEligibleCandidate(report, candidateId);
    this.validateCandidateCurrent(report, candidate);
    this.assertSourceCurrent(report);
    const control = this.loadControl();
    if (control.reportDigest !== report.reportDigest || control.candidateId !== candidate.candidateId || control.reviewDigest !== this.reviewDigest(report, candidate)) {
      throw new Error('Open the current candidate diff in the native editor before approval.');
    }
    const approved = { ...control, approvedAt: new Date().toISOString() };
    writeJsonAtomic(path.join(this.artifactRoot(), 'control.json'), approved, false);
    return approved;
  }

  public async mergeCandidate(candidateId: string): Promise<BranchMergeResult> {
    const report = this.loadLatest();
    const candidate = this.requireEligibleCandidate(report, candidateId);
    this.validateCandidateCurrent(report, candidate);
    this.assertSourceCurrent(report);
    const control = this.loadControl();
    if (!control.approvedAt || control.reportDigest !== report.reportDigest || control.candidateId !== candidate.candidateId || control.reviewDigest !== this.reviewDigest(report, candidate)) {
      throw new Error('Branch candidate merge requires a fresh host approval of the current native diff.');
    }
    const changedFiles = changedAgainstBaseline(candidate.isolatedRoot, workspaceBaseline(this.sourceRoot), MAX_CHANGED_FILES);
    if (canonicalJson(changedFiles) !== canonicalJson(candidate.changedFiles)) throw new Error('Candidate change set changed after ranking.');
    let mergedBytes = 0;
    for (const relative of changedFiles) {
      const staged = contained(candidate.isolatedRoot, relative);
      if (!fs.existsSync(staged)) continue;
      const stat = fs.lstatSync(staged);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe candidate merge path: ${relative}`);
      mergedBytes += stat.size;
      if (mergedBytes > MAX_MERGE_BYTES) throw new Error(`Candidate merge exceeds ${MAX_MERGE_BYTES} bytes.`);
    }
    const backups = new Map<string, Buffer | null>();
    for (const relative of changedFiles) {
      const target = contained(this.sourceRoot, relative);
      backups.set(relative, fs.existsSync(target) ? fs.readFileSync(target) : null);
    }
    let oracle: CompositeOracleResult;
    let rolledBack = false;
    try {
      for (const relative of changedFiles) copyCandidatePath(candidate.isolatedRoot, this.sourceRoot, relative);
      oracle = await this.sourceOracleRunner(this.sourceRoot);
      if (!oracle.pass) throw new BranchOracleFailure(oracle);
    } catch (error: any) {
      restoreBackups(this.sourceRoot, backups);
      rolledBack = true;
      oracle = error instanceof BranchOracleFailure ? error.oracle : await this.sourceOracleRunner(this.sourceRoot);
      const result = this.writeMergeEvidence(report, candidate, false, rolledBack, changedFiles, oracle, String(error?.message || error));
      return result;
    }
    return this.writeMergeEvidence(report, candidate, true, rolledBack, changedFiles, oracle);
  }

  private async runOne(context: BranchCandidateExecutionContext, isolation: PreparedIsolation, sourceBaseline: BackgroundBaseline[], sourceBefore: string): Promise<BranchCandidateResult> {
    const started = Date.now();
    let state: HarnessState | undefined;
    let error = '';
    try {
      state = await this.candidateExecutor(context, this.providerFactory(context.candidateId, context.modelId));
    } catch (caught: any) {
      error = bounded(String(caught?.message || caught), 2_000);
    }
    const statePath = path.join(context.isolatedRoot, '.forge', 'state.json');
    if (!state && fs.existsSync(statePath)) {
      try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as HarnessState; } catch { /* execution error remains authoritative */ }
    }
    const changedFiles = changedAgainstBaseline(context.isolatedRoot, sourceBaseline, MAX_CHANGED_FILES);
    const authorityDigest = state?.executionContract ? commonAuthorityDigest(state) : '';
    const facts = state ? candidateFacts(state, context.reviewerModel) : unavailableFacts(error || 'candidate state is missing');
    const candidateBase = {
      candidateId: context.candidateId,
      modelId: context.modelId,
      reviewerModelId: context.reviewerModel,
      isolatedRoot: context.isolatedRoot,
      tempParent: isolation.tempParent,
      isolationMode: isolation.mode,
      isolationFallbackReason: isolation.fallbackReason,
      baseCommit: isolation.baseCommit,
      executionContractDigest: state?.executionContract?.digest || '',
      commonAuthorityDigest: authorityDigest,
      statePath,
      stateStatus: state?.status || 'failed' as HarnessState['status'],
      steps: state?.currentStepIndex || 0,
      changedFiles,
      sourceMutated: baselineDigest(workspaceBaseline(this.sourceRoot)) !== sourceBefore,
      ...facts,
      wallClockMs: Math.max(0, Date.now() - started),
      error: error || undefined
    };
    const rejectionReasons = [...candidateBase.rejectionReasons];
    if (candidateBase.sourceMutated) rejectionReasons.push('candidate changed the active source workspace');
    const candidateDigest = currentCandidateDigest(candidateBase, context.isolatedRoot);
    return { ...candidateBase, rejectionReasons: [...new Set(rejectionReasons)], eligible: rejectionReasons.length === 0, candidateDigest };
  }

  private validateReport(report: BranchCompareReport): void {
    if (!report || report.schemaVersion !== 1 || report.candidateCount < 2 || report.candidateCount > MAX_CANDIDATES) throw new Error('Unsupported branch comparison report.');
    if (fs.realpathSync(report.sourceRoot) !== this.sourceRoot) throw new Error('Branch comparison report belongs to another workspace.');
    if (branchCompareReportDigest(report) !== report.reportDigest) throw new Error('Branch comparison report digest is invalid.');
    if (report.candidates.length !== report.candidateCount || new Set(report.candidates.map(item => item.candidateId)).size !== report.candidateCount) throw new Error('Branch comparison candidate identities are invalid.');
    if (report.candidates.some(item => item.reviewerModelId !== report.reviewerModel || item.commonAuthorityDigest !== report.commonContractDigest)) throw new Error('Branch comparison candidate contract binding is invalid.');
    if (canonicalJson(rankBranchCandidates(report.candidates)) !== canonicalJson(report.ranking)) throw new Error('Branch comparison ranking is invalid.');
    if ((report.ranking[0] || null) !== report.recommendedCandidateId) throw new Error('Branch comparison recommendation is invalid.');
  }

  private requireEligibleCandidate(report: BranchCompareReport, candidateId: string): BranchCandidateResult {
    const candidate = report.candidates.find(item => item.candidateId === String(candidateId || ''));
    if (!candidate) throw new Error('Unknown branch candidate.');
    if (!candidate.eligible || !report.ranking.includes(candidate.candidateId)) throw new Error('Only a deterministically eligible branch candidate can be approved or merged.');
    return candidate;
  }

  private validateCandidateCurrent(report: BranchCompareReport, candidate: BranchCandidateResult): void {
    if (!fs.existsSync(candidate.isolatedRoot) || !fs.existsSync(candidate.statePath)) throw new Error('Retained candidate workspace is missing.');
    if (fs.realpathSync(candidate.isolatedRoot) === this.sourceRoot || path.resolve(candidate.statePath) !== path.join(path.resolve(candidate.isolatedRoot), '.forge', 'state.json')) throw new Error('Candidate isolation identity is invalid.');
    const state = JSON.parse(fs.readFileSync(candidate.statePath, 'utf8')) as HarnessState;
    if (executionContractDigest(state.executionContract.authority) !== state.executionContract.digest || state.executionContract.digest !== candidate.executionContractDigest) throw new Error('Candidate execution contract digest is invalid.');
    if (state.executionContract.authority.modelBindings.code !== candidate.modelId || state.executionContract.authority.modelBindings.review !== report.reviewerModel) throw new Error('Candidate model bindings no longer match the comparison treatment.');
    const facts = candidateFacts(state, report.reviewerModel);
    if (!facts.eligible) throw new Error(`Candidate is no longer eligible: ${facts.rejectionReasons.join(', ')}.`);
    if (commonAuthorityDigest(state) !== report.commonContractDigest) throw new Error('Candidate authority no longer matches the comparison contract.');
    if (currentCandidateDigest(candidate, candidate.isolatedRoot) !== candidate.candidateDigest) throw new Error('Candidate state or files changed after ranking.');
  }

  private assertSourceCurrent(report: BranchCompareReport): void {
    if (baselineDigest(workspaceBaseline(this.sourceRoot)) !== report.sourceBaselineDigest) throw new Error('Source workspace changed after branch comparison; run a fresh comparison.');
  }

  private reviewDigest(report: BranchCompareReport, candidate: BranchCandidateResult): string {
    return digest({ reportDigest: report.reportDigest, candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest, sourceBaselineDigest: report.sourceBaselineDigest });
  }

  private loadControl(): BranchCompareControl {
    const control = JSON.parse(fs.readFileSync(path.join(this.artifactRoot(), 'control.json'), 'utf8')) as BranchCompareControl;
    if (!control || control.schemaVersion !== 1) throw new Error('Branch comparison review control is missing.');
    return control;
  }

  private writeMergeEvidence(report: BranchCompareReport, candidate: BranchCandidateResult, merged: boolean, rolledBack: boolean, changedFiles: string[], oracle: CompositeOracleResult, error?: string): BranchMergeResult {
    const evidencePath = path.join(this.artifactRoot(), 'merge-evidence.json');
    writeJsonAtomic(evidencePath, {
      schemaVersion: 1,
      comparisonId: report.comparisonId,
      reportDigest: report.reportDigest,
      candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest,
      merged,
      rolledBack,
      changedFiles,
      oracle,
      error: error ? bounded(error, 2_000) : undefined,
      completedAt: new Date().toISOString()
    }, false);
    return { merged, rolledBack, candidateId: candidate.candidateId, changedFiles, oracle, evidencePath };
  }

  private artifactRoot(): string { return path.join(this.sourceRoot, '.forge', 'branch-compare'); }
}

export function rankBranchCandidates(candidates: BranchCandidateResult[]): string[] {
  return candidates.filter(candidate => candidate.eligible).sort((left, right) => {
    const leftFallback = left.fallbackActions + left.fallbackProposals;
    const rightFallback = right.fallbackActions + right.fallbackProposals;
    return leftFallback - rightFallback
      || left.costUsd - right.costUsd
      || left.wallClockMs - right.wallClockMs
      || left.candidateId.localeCompare(right.candidateId);
  }).map(candidate => candidate.candidateId);
}

export function branchCompareReportDigest(report: BranchCompareReport): string {
  const { reportDigest: _digest, reportPath: _reportPath, archivePath: _archivePath, ...bound } = report;
  return digest(bound);
}

async function executeCandidate(context: BranchCandidateExecutionContext, provider: Provider): Promise<HarnessState> {
  const bindings = {
    code: context.modelId,
    plan: context.modelId,
    Architect: context.modelId,
    Editor: context.modelId,
    Explorer: context.modelId,
    Escalation: context.modelId,
    review: context.reviewerModel,
    Reviewer: context.reviewerModel
  };
  const exactRouteProvider: Provider = {
    capabilities: modelId => provider.capabilities(modelId),
    listModels: () => provider.listModels(),
    generateChat: options => provider.generateChat({ ...options, fallbackModels: [] })
  };
  const loop = new AgentHarnessLoop(exactRouteProvider, context.isolatedRoot);
  let state = await loop.initializeHarness(context.goal, bindings, context.runBudget);
  state.maxSteps = context.maxSteps;
  while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
    state = await loop.runStep(state, bindings);
  }
  return state;
}

function candidateFacts(state: HarnessState, reviewerModel: string) {
  const assurance = assuranceSuccessGate(state);
  const greenOracle = state.lastOraclePass === true;
  const greenEvidence = (state.evidenceLedger || []).some(item => item.testResult?.pass === true);
  const deterministicDiffReview = (state.diffReviews || []).some(item => item.status === 'approved');
  const independentModelReview = (state.reviewerCritiques || []).some(item => item.source === 'model' && item.status === 'approved' && item.modelId === reviewerModel);
  const actuallyModelDriven = state.runStats?.actuallyModelDriven === true;
  const modelDrivenProposals = Number(state.runStats?.modelDrivenProposals || 0);
  const rejectionReasons = [
    ...(state.status === 'success' ? [] : [`terminal status is ${state.status}`]),
    ...(assurance.ready ? [] : assurance.missing.map(item => `assurance missing: ${item}`)),
    ...(greenOracle ? [] : ['green composite oracle is missing']),
    ...(greenEvidence ? [] : ['same-run green evidence is missing']),
    ...(deterministicDiffReview ? [] : ['approved deterministic diff review is missing']),
    ...(independentModelReview ? [] : ['approved independent model review is missing']),
    ...(actuallyModelDriven && modelDrivenProposals > 0 ? [] : ['candidate is fallback-only or not model-driven'])
  ];
  const workers = Object.values(state.workerContexts || {});
  return {
    assuranceReady: assurance.ready,
    assuranceMissing: assurance.missing,
    greenOracle,
    greenEvidence,
    deterministicDiffReview,
    independentModelReview,
    actuallyModelDriven,
    modelDrivenProposals,
    fallbackProposals: Number(state.runStats?.fallbackProposals || 0),
    fallbackActions: Number(state.runStats?.fallbackActions || 0),
    providerCalls: Number(state.runStats?.providerCalls || 0),
    providerFailures: Number(state.runStats?.providerFailures || 0),
    schemaAttempts: Number(state.runStats?.modelDrivenProposals || 0) + Number(state.runStats?.schemaFailures || 0),
    schemaSuccesses: Number(state.runStats?.modelDrivenProposals || 0),
    costUsd: Number(state.goalContract?.spent || 0),
    providerLatencyMs: workers.reduce((sum, worker) => sum + Number(worker.latencyMs || 0), 0),
    eligible: rejectionReasons.length === 0,
    rejectionReasons
  };
}

function unavailableFacts(reason: string) {
  return {
    assuranceReady: false,
    assuranceMissing: ['candidate state'],
    greenOracle: false,
    greenEvidence: false,
    deterministicDiffReview: false,
    independentModelReview: false,
    actuallyModelDriven: false,
    modelDrivenProposals: 0,
    fallbackProposals: 0,
    fallbackActions: 0,
    providerCalls: 0,
    providerFailures: 1,
    schemaAttempts: 0,
    schemaSuccesses: 0,
    costUsd: 0,
    providerLatencyMs: 0,
    eligible: false,
    rejectionReasons: [reason]
  };
}

function commonAuthorityDigest(state: HarnessState): string {
  const { modelBindings: _models, ...authority } = state.executionContract.authority;
  return digest(authority);
}

function currentCandidateDigest(candidate: Partial<BranchCandidateResult>, isolatedRoot: string): string {
  const statePath = String(candidate.statePath || path.join(isolatedRoot, '.forge', 'state.json'));
  const stateDigest = fs.existsSync(statePath) ? fileDigest(statePath) : '';
  const files = (candidate.changedFiles || []).map(relative => {
    const target = contained(isolatedRoot, relative);
    return { path: relative, hash: fs.existsSync(target) ? fileDigest(target) : null };
  });
  return digest({ stateDigest, files });
}

function baselineDigest(entries: BackgroundBaseline[]): string {
  return digest(entries.map(item => ({ path: item.path, hash: item.hash, size: item.size, existed: item.existed })));
}

function renderSummary(report: BranchCompareReport): string {
  const lines = [
    '# Forge Branch Comparison',
    '',
    `Comparison: ${report.comparisonId}`,
    `Candidates: ${report.candidateCount}`,
    `Cost: $${report.totalCostUsd.toFixed(6)} / $${report.maxTotalCostUsd.toFixed(6)}`,
    `Recommended: ${report.recommendedCandidateId || 'none'}`,
    `Source changed during execution: ${report.sourceMutated}`,
    ''
  ];
  for (const candidate of report.candidates) {
    lines.push(`## ${candidate.candidateId} - ${candidate.modelId}`);
    lines.push(`Eligible: ${candidate.eligible}`);
    lines.push(`Status: ${candidate.stateStatus}`);
    lines.push(`Model-driven: ${candidate.actuallyModelDriven}; fallback proposals/actions: ${candidate.fallbackProposals}/${candidate.fallbackActions}`);
    lines.push(`Cost: $${candidate.costUsd.toFixed(6)}; latency: ${candidate.wallClockMs}ms`);
    lines.push(`Changed files: ${candidate.changedFiles.join(', ') || 'none'}`);
    lines.push(`Rejections: ${candidate.rejectionReasons.join('; ') || 'none'}`, '');
  }
  return `${lines.join('\n')}\n`;
}

function copyOrPlaceholder(source: string, target: string, placeholder: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
  else fs.writeFileSync(target, `${placeholder}\n`, 'utf8');
}

function copyCandidatePath(candidateRoot: string, sourceRoot: string, relative: string): void {
  const staged = contained(candidateRoot, relative);
  const target = contained(sourceRoot, relative);
  if (!fs.existsSync(staged)) fs.rmSync(target, { force: true });
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.forge-branch-${process.pid}-${Date.now()}`;
    fs.copyFileSync(staged, temp);
    replaceWithRetry(temp, target);
  }
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

function contained(root: string, relative: string): string {
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized || path.isAbsolute(relative) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`Invalid branch comparison path: ${relative}`);
  const resolvedRoot = fs.realpathSync(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (!resolved.startsWith(resolvedRoot + path.sep)) throw new Error(`Branch comparison path escapes workspace: ${relative}`);
  return resolved;
}

function writeJsonAtomic(target: string, value: unknown, exclusive: boolean): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
  if (exclusive && fs.existsSync(target)) {
    fs.rmSync(temp, { force: true });
    throw new Error(`Immutable branch comparison artifact already exists: ${target}`);
  }
  replaceWithRetry(temp, target);
}

function replaceWithRetry(temp: string, target: string): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.renameSync(temp, target); return; } catch (error: any) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(error?.code)) || attempt === 19) {
        fs.rmSync(temp, { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function fileDigest(target: string): string { return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); }
function digest(value: unknown): string { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
function bounded(value: string, limit: number): string { return value.length > limit ? value.slice(0, limit) : value; }
function isMetaRoute(modelId: string): boolean { return /^openrouter\/(?:auto|pareto-code)$/i.test(modelId); }
function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function finiteNonNegative(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

class BranchOracleFailure extends Error {
  constructor(public readonly oracle: CompositeOracleResult) { super(`Fresh source oracle failed: ${oracle.summary}`); }
}
