import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { branchCompareReportDigest, BranchCompareReport } from './branchCompare';
import { ProductionBenchmarkReport } from './productionBenchmark';

export type EmpiricalProvenance = 'live' | 'scripted';
export type EmpiricalSourceKind = 'production-benchmark' | 'branch-compare' | 'scripted';
export type EmpiricalClaimLevel = 'measured' | 'provisional' | 'unmeasured';

export interface EmpiricalModelSampleV1 {
  schemaVersion: 1;
  sampleId: string;
  sourceKind: EmpiricalSourceKind;
  provenance: EmpiricalProvenance;
  sourcePath: string;
  sourceDigest: string;
  sourceRunId: string;
  modelId: string;
  cohortKey: string;
  taskId: string;
  lane: string;
  solved: boolean;
  verified: boolean;
  modelDriven: boolean;
  falseSuccess: boolean;
  schemaAttempts: number;
  schemaSuccesses: number;
  providerCalls: number;
  providerFailures: number;
  costUsd: number;
  fallbackDependent: boolean;
  evidenceRefs: string[];
}

export interface WilsonInterval {
  confidence: 0.95;
  low: number;
  high: number;
}

export interface EmpiricalModelProfileV1 {
  schemaVersion: 1;
  modelId: string;
  cohortKey: string;
  provenance: EmpiricalProvenance;
  claimLevel: EmpiricalClaimLevel;
  sampleCount: number;
  liveSampleCount: number;
  verifiedTaskCount: number;
  modelDrivenSolved: number;
  solveRate: number;
  solveRateConfidence: WilsonInterval;
  falseSuccessCount: number;
  falseSuccessRate: number;
  schemaSampleCount: number;
  schemaReliability: number | null;
  providerCalls: number;
  providerFailures: number;
  providerFailureRate: number;
  totalCostUsd: number;
  costPerVerifiedTaskUsd: number | null;
  fallbackDependentSamples: number;
  fallbackDependence: number;
  sampleIds: string[];
  evidenceRefs: string[];
}

export interface EmpiricalCohortRankingV1 {
  cohortKey: string;
  provenance: EmpiricalProvenance;
  claimLevel: 'measured' | 'provisional';
  comparableModelCount: number;
  rankedModelIds: string[];
}

export interface ModelIntelligenceReportV1 {
  schemaVersion: 1;
  reportId: string;
  generatedAt: string;
  workspaceRoot: string;
  acceptedSourceCount: number;
  unsupportedSources: Array<{ path: string; reason: string }>;
  samples: EmpiricalModelSampleV1[];
  profiles: EmpiricalModelProfileV1[];
  rankings: EmpiricalCohortRankingV1[];
  measuredProfileCount: number;
  provisionalProfileCount: number;
  reportPath: string;
  archivePath: string;
  reportDigest: string;
}

export interface ModelIntelligenceInput {
  productionReports?: Array<{ report: ProductionBenchmarkReport; sourcePath?: string }>;
  branchReports?: Array<{ report: BranchCompareReport; sourcePath?: string }>;
  scriptedSamples?: EmpiricalModelSampleV1[];
  discoverWorkspaceArtifacts?: boolean;
}

const MIN_MEASURED_LIVE_SAMPLES = 3;
const MAX_SOURCE_ARTIFACTS = 500;
const META_ROUTES = new Set(['openrouter/auto', 'openrouter/pareto-code']);

export class ModelIntelligenceService {
  private readonly workspaceRoot: string;

  constructor(workspaceRootInput: string) {
    this.workspaceRoot = fs.realpathSync(workspaceRootInput);
  }

  public rebuild(input: ModelIntelligenceInput = {}): ModelIntelligenceReportV1 {
    const productionReports = [...(input.productionReports || [])];
    const branchReports = [...(input.branchReports || [])];
    const unsupportedSources: ModelIntelligenceReportV1['unsupportedSources'] = [];
    if (input.discoverWorkspaceArtifacts !== false) this.discover(productionReports, branchReports, unsupportedSources);

    const normalizedProduction = uniqueReportSources(productionReports, source => source.report.runId, source => digest(source.report), 'production benchmark');
    const normalizedBranches = uniqueReportSources(branchReports, source => source.report.comparisonId, source => source.report.reportDigest, 'branch comparison');
    const samples: EmpiricalModelSampleV1[] = [];
    for (const source of normalizedProduction) samples.push(...productionSamples(source.report, source.sourcePath || '(in-memory)'));
    for (const source of normalizedBranches) samples.push(...branchSamples(source.report, source.sourcePath || '(in-memory)'));
    for (const sample of input.scriptedSamples || []) {
      if (sample.sourceKind !== 'scripted' || sample.provenance !== 'scripted') throw new Error('Explicit test samples must remain scripted provenance.');
      samples.push(validateExplicitSample(sample));
    }
    const uniqueSamples = deduplicateSamples(samples);
    const profiles = compileProfiles(uniqueSamples);
    const rankings = compileRankings(profiles);
    const reportId = `model-intelligence-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const root = path.join(this.workspaceRoot, '.forge', 'model-intelligence');
    const reportPath = path.join(root, 'latest.json');
    const archivePath = path.join(root, 'runs', `${reportId}.json`);
    const report: ModelIntelligenceReportV1 = {
      schemaVersion: 1,
      reportId,
      generatedAt: new Date().toISOString(),
      workspaceRoot: this.workspaceRoot,
      acceptedSourceCount: normalizedProduction.length + normalizedBranches.length + (input.scriptedSamples?.length ? 1 : 0),
      unsupportedSources: unsupportedSources.sort((a, b) => a.path.localeCompare(b.path)),
      samples: uniqueSamples,
      profiles,
      rankings,
      measuredProfileCount: profiles.filter(profile => profile.claimLevel === 'measured').length,
      provisionalProfileCount: profiles.filter(profile => profile.claimLevel === 'provisional').length,
      reportPath,
      archivePath,
      reportDigest: ''
    };
    report.reportDigest = modelIntelligenceReportDigest(report);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    writeJsonAtomic(archivePath, report, true);
    writeJsonAtomic(reportPath, report, false);
    fs.writeFileSync(path.join(root, 'latest-summary.md'), renderModelIntelligenceSummary(report), 'utf8');
    return report;
  }

  public loadLatest(): ModelIntelligenceReportV1 {
    const target = path.join(this.workspaceRoot, '.forge', 'model-intelligence', 'latest.json');
    const report = JSON.parse(fs.readFileSync(target, 'utf8')) as ModelIntelligenceReportV1;
    validateReport(report, this.workspaceRoot);
    return report;
  }

  private discover(
    productionReports: Array<{ report: ProductionBenchmarkReport; sourcePath?: string }>,
    branchReports: Array<{ report: BranchCompareReport; sourcePath?: string }>,
    unsupportedSources: ModelIntelligenceReportV1['unsupportedSources']
  ): void {
    const productionPath = path.join(this.workspaceRoot, '.forge', 'evals', 'latest-production-benchmark.json');
    const productionArchiveRoot = path.join(this.workspaceRoot, '.forge', 'evals', 'runs', 'production');
    const branchPath = path.join(this.workspaceRoot, '.forge', 'branch-compare', 'latest.json');
    const branchArchiveRoot = path.join(this.workspaceRoot, '.forge', 'branch-compare', 'runs');
    const legacyPath = path.join(this.workspaceRoot, '.forge', 'evals', 'latest-weak-model-eval.json');
    for (const archivePath of boundedJsonFiles(productionArchiveRoot)) productionReports.push({ report: readJson(archivePath), sourcePath: archivePath });
    if (fs.existsSync(productionPath)) productionReports.push({ report: readJson(productionPath), sourcePath: productionPath });
    for (const archivePath of boundedJsonFiles(branchArchiveRoot)) branchReports.push({ report: readJson(archivePath), sourcePath: archivePath });
    if (fs.existsSync(branchPath)) branchReports.push({ report: readJson(branchPath), sourcePath: branchPath });
    if (fs.existsSync(legacyPath)) unsupportedSources.push({ path: legacyPath, reason: 'legacy weak-eval report lacks stable per-task input and judge digests' });
  }
}

export function productionSamples(report: ProductionBenchmarkReport, sourcePath: string): EmpiricalModelSampleV1[] {
  if (report.schemaVersion !== 1 || report.live !== true || report.suiteIntegrity !== true || report.archiveImmutable !== true) throw new Error('Production benchmark source is not a complete live immutable suite-integrity report.');
  assertExactModel(report.modelId);
  if (!hex64(report.suiteDigest) || report.taskCount !== report.completedTaskCount || report.tasks.length !== report.taskCount) throw new Error('Production benchmark source is partial or has an invalid suite identity.');
  const sourceDigest = digest(report);
  return report.tasks.map((task, index) => {
    if (!hex64(task.inputDigest) || !hex64(task.judgeDigest) || task.equalLaneInputs !== true) throw new Error(`Production task ${task.id} lacks a comparable input/judge contract.`);
    const cohortKey = digest({ sourceKind: 'production-benchmark', suiteDigest: report.suiteDigest, inputDigest: task.inputDigest, judgeDigest: task.judgeDigest, lane: 'harness' });
    return finalizeSample({
      schemaVersion: 1,
      sampleId: '',
      sourceKind: 'production-benchmark',
      provenance: 'live',
      sourcePath,
      sourceDigest,
      sourceRunId: report.runId,
      modelId: report.modelId,
      cohortKey,
      taskId: task.id,
      lane: 'harness',
      solved: task.harnessSolved && task.modelDriven && task.workspaceOracleGreen,
      verified: task.workspaceOracleGreen,
      modelDriven: task.modelDriven,
      falseSuccess: task.falseSuccess,
      schemaAttempts: index === 0 ? finiteCount((report as any).schemaAttempts || 0) : 0,
      schemaSuccesses: index === 0 ? finiteCount((report as any).schemaSuccesses || 0) : 0,
      providerCalls: finiteCount(task.providerCalls),
      providerFailures: finiteCount(task.providerFailures),
      costUsd: finiteNonNegative(task.costUsd),
      fallbackDependent: false,
      evidenceRefs: [sourcePath, report.archivePath].filter(Boolean)
    });
  });
}

export function branchSamples(report: BranchCompareReport, sourcePath: string): EmpiricalModelSampleV1[] {
  if (report.schemaVersion !== 1 || report.sourceMutated || report.reportDigest !== branchCompareReportDigest(report)) throw new Error('Branch comparison source failed canonical report validation.');
  if (!hex64(report.commonContractDigest) || !hex64(report.sourceBaselineDigest) || report.candidates.length !== report.candidateCount) throw new Error('Branch comparison source lacks a stable common contract.');
  const provenance: EmpiricalProvenance = (report as any).provenance === 'live' ? 'live' : 'scripted';
  const sourceDigest = digest(report);
  const cohortKey = digest({ sourceKind: 'branch-compare', commonContractDigest: report.commonContractDigest, sourceBaselineDigest: report.sourceBaselineDigest, goalDigest: digest(report.goal), lane: 'candidate' });
  return report.candidates.map(candidate => {
    assertExactModel(candidate.modelId);
    return finalizeSample({
      schemaVersion: 1,
      sampleId: '',
      sourceKind: 'branch-compare',
      provenance,
      sourcePath,
      sourceDigest,
      sourceRunId: report.comparisonId,
      modelId: candidate.modelId,
      cohortKey,
      taskId: digest({ goal: report.goal, baseline: report.sourceBaselineDigest }).slice(0, 24),
      lane: 'candidate',
      solved: candidate.eligible && candidate.actuallyModelDriven && candidate.greenOracle && candidate.greenEvidence,
      verified: candidate.greenOracle && candidate.greenEvidence,
      modelDriven: candidate.actuallyModelDriven && candidate.modelDrivenProposals > 0,
      falseSuccess: candidate.stateStatus === 'success' && (!candidate.greenOracle || !candidate.greenEvidence),
      schemaAttempts: finiteCount((candidate as any).schemaAttempts || 0),
      schemaSuccesses: finiteCount((candidate as any).schemaSuccesses || 0),
      providerCalls: finiteCount(candidate.providerCalls),
      providerFailures: finiteCount(candidate.providerFailures),
      costUsd: finiteNonNegative(candidate.costUsd),
      fallbackDependent: candidate.fallbackProposals + candidate.fallbackActions > 0 || !candidate.actuallyModelDriven,
      evidenceRefs: [sourcePath, candidate.statePath, report.archivePath].filter(Boolean)
    });
  });
}

export function compileProfiles(samples: EmpiricalModelSampleV1[]): EmpiricalModelProfileV1[] {
  const groups = new Map<string, EmpiricalModelSampleV1[]>();
  for (const sample of samples) {
    const key = `${sample.modelId}\u0000${sample.cohortKey}\u0000${sample.provenance}`;
    groups.set(key, [...(groups.get(key) || []), sample]);
  }
  return [...groups.values()].map((group): EmpiricalModelProfileV1 => {
    const ordered = [...group].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
    const sampleCount = ordered.length;
    const liveSampleCount = ordered.filter(sample => sample.provenance === 'live').length;
    const liveVerifiedTaskCount = ordered.filter(sample => sample.provenance === 'live' && sample.verified).length;
    const verifiedTaskCount = ordered.filter(sample => sample.verified).length;
    const modelDrivenSolved = ordered.filter(sample => sample.solved && sample.modelDriven && !sample.fallbackDependent).length;
    const falseSuccessCount = ordered.filter(sample => sample.falseSuccess).length;
    const schemaSampleCount = sum(ordered, sample => sample.schemaAttempts);
    const schemaSuccesses = sum(ordered, sample => sample.schemaSuccesses);
    const providerCalls = sum(ordered, sample => sample.providerCalls);
    const providerFailures = sum(ordered, sample => sample.providerFailures);
    const totalCostUsd = sum(ordered, sample => sample.costUsd);
    const fallbackDependentSamples = ordered.filter(sample => sample.fallbackDependent).length;
    return {
      schemaVersion: 1,
      modelId: ordered[0].modelId,
      cohortKey: ordered[0].cohortKey,
      provenance: ordered[0].provenance,
      claimLevel: ordered[0].provenance === 'live' && liveVerifiedTaskCount >= MIN_MEASURED_LIVE_SAMPLES ? 'measured' : 'provisional',
      sampleCount,
      liveSampleCount,
      verifiedTaskCount,
      modelDrivenSolved,
      solveRate: sampleCount ? modelDrivenSolved / sampleCount : 0,
      solveRateConfidence: wilsonInterval(modelDrivenSolved, sampleCount),
      falseSuccessCount,
      falseSuccessRate: sampleCount ? falseSuccessCount / sampleCount : 0,
      schemaSampleCount,
      schemaReliability: schemaSampleCount ? schemaSuccesses / schemaSampleCount : null,
      providerCalls,
      providerFailures,
      providerFailureRate: providerCalls ? providerFailures / providerCalls : 0,
      totalCostUsd,
      costPerVerifiedTaskUsd: verifiedTaskCount ? totalCostUsd / verifiedTaskCount : null,
      fallbackDependentSamples,
      fallbackDependence: sampleCount ? fallbackDependentSamples / sampleCount : 0,
      sampleIds: ordered.map(sample => sample.sampleId),
      evidenceRefs: [...new Set(ordered.flatMap(sample => sample.evidenceRefs))].sort()
    };
  }).sort((a, b) => a.cohortKey.localeCompare(b.cohortKey) || a.modelId.localeCompare(b.modelId));
}

export function compileRankings(profiles: EmpiricalModelProfileV1[]): EmpiricalCohortRankingV1[] {
  const cohorts = new Map<string, EmpiricalModelProfileV1[]>();
  for (const profile of profiles) {
    const key = `${profile.cohortKey}\u0000${profile.provenance}`;
    cohorts.set(key, [...(cohorts.get(key) || []), profile]);
  }
  return [...cohorts.values()].filter(group => group.length >= 2).map((group): EmpiricalCohortRankingV1 => {
    const cohortKey = group[0].cohortKey;
    const measured = group.every(profile => profile.claimLevel === 'measured');
    const ranked = [...group].sort((a, b) => b.solveRateConfidence.low - a.solveRateConfidence.low
      || a.falseSuccessRate - b.falseSuccessRate
      || a.fallbackDependence - b.fallbackDependence
      || a.providerFailureRate - b.providerFailureRate
      || nullableCost(a.costPerVerifiedTaskUsd) - nullableCost(b.costPerVerifiedTaskUsd)
      || a.modelId.localeCompare(b.modelId));
    return { cohortKey, provenance: group[0].provenance, claimLevel: measured ? 'measured' : 'provisional', comparableModelCount: group.length, rankedModelIds: ranked.map(profile => profile.modelId) };
  }).sort((a, b) => a.cohortKey.localeCompare(b.cohortKey) || a.provenance.localeCompare(b.provenance));
}

export function wilsonInterval(successesInput: number, samplesInput: number): WilsonInterval {
  const n = finiteCount(samplesInput);
  const successes = Math.min(n, finiteCount(successesInput));
  if (!n) return { confidence: 0.95, low: 0, high: 1 };
  const z = 1.959963984540054;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denominator;
  return { confidence: 0.95, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function modelIntelligenceReportDigest(report: ModelIntelligenceReportV1): string {
  return digest({ ...report, reportDigest: '' });
}

export function renderModelIntelligenceSummary(report: ModelIntelligenceReportV1): string {
  const lines = ['# Forge Model Intelligence', '', `Generated: ${report.generatedAt}`, `Accepted sources: ${report.acceptedSourceCount}`, `Samples: ${report.samples.length}`, `Measured profiles: ${report.measuredProfileCount}`, `Provisional profiles: ${report.provisionalProfileCount}`, ''];
  if (!report.profiles.length) lines.push('No comparable empirical samples are available. Catalog guidance remains heuristic.');
  for (const profile of report.profiles) {
    const schema = profile.schemaReliability === null ? 'not observed' : `${percent(profile.schemaReliability)} (${profile.schemaSampleCount})`;
    lines.push(`## ${profile.modelId}`, '', `- Claim: ${profile.claimLevel} (${profile.provenance})`, `- Cohort: \`${profile.cohortKey}\``, `- Samples: ${profile.sampleCount} (${profile.liveSampleCount} live)`, `- Model-driven solve rate: ${percent(profile.solveRate)} (95% CI ${percent(profile.solveRateConfidence.low)}-${percent(profile.solveRateConfidence.high)})`, `- False-success rate: ${percent(profile.falseSuccessRate)}`, `- Schema reliability: ${schema}`, `- Provider failures: ${profile.providerFailures}/${profile.providerCalls}`, `- Cost per verified task: ${profile.costPerVerifiedTaskUsd === null ? 'not available' : `$${profile.costPerVerifiedTaskUsd.toFixed(6)}`}`, `- Fallback dependence: ${percent(profile.fallbackDependence)}`, '');
  }
  if (report.rankings.some(ranking => ranking.claimLevel === 'provisional')) lines.push('Provisional rankings are mechanics-only and are not measured superiority claims.', '');
  return `${lines.join('\n')}\n`;
}

function validateReport(report: ModelIntelligenceReportV1, workspaceRoot: string): void {
  if (report.schemaVersion !== 1 || path.resolve(report.workspaceRoot) !== path.resolve(workspaceRoot)) throw new Error('Model intelligence report workspace/schema identity is invalid.');
  if (report.reportDigest !== modelIntelligenceReportDigest(report)) throw new Error('Model intelligence report digest mismatch.');
  const samples = deduplicateSamples(report.samples.map(validateExplicitSample));
  for (const sample of samples) {
    if (!path.isAbsolute(sample.sourcePath)) continue;
    if (!fs.existsSync(sample.sourcePath) || digest(readJson(sample.sourcePath)) !== sample.sourceDigest) throw new Error(`Model intelligence source artifact is missing, stale, or tampered: ${sample.sourcePath}`);
  }
  const profiles = compileProfiles(samples);
  const rankings = compileRankings(profiles);
  if (canonicalJson(samples) !== canonicalJson(report.samples) || canonicalJson(profiles) !== canonicalJson(report.profiles) || canonicalJson(rankings) !== canonicalJson(report.rankings)) throw new Error('Model intelligence report contains non-canonical samples, profiles, or rankings.');
  if (report.measuredProfileCount !== profiles.filter(profile => profile.claimLevel === 'measured').length || report.provisionalProfileCount !== profiles.filter(profile => profile.claimLevel === 'provisional').length) throw new Error('Model intelligence claim counts do not match compiled profiles.');
}

function validateExplicitSample(sample: EmpiricalModelSampleV1): EmpiricalModelSampleV1 {
  if (sample.schemaVersion !== 1) throw new Error('Empirical sample schema version is unsupported.');
  assertExactModel(sample.modelId);
  if (!hex64(sample.sourceDigest) || !hex64(sample.cohortKey) || !sample.sourceRunId || !sample.taskId || !sample.lane) throw new Error('Empirical sample identity is incomplete.');
  if (!['live', 'scripted'].includes(sample.provenance) || !['production-benchmark', 'branch-compare', 'scripted'].includes(sample.sourceKind)) throw new Error('Empirical sample provenance/source kind is invalid.');
  if (sample.schemaSuccesses > sample.schemaAttempts || sample.providerFailures > sample.providerCalls) throw new Error('Empirical sample counters are inconsistent.');
  return finalizeSample({ ...sample, sampleId: '' });
}

function finalizeSample(sample: EmpiricalModelSampleV1): EmpiricalModelSampleV1 {
  const bound = {
    ...sample,
    sourcePath: String(sample.sourcePath || '(in-memory)'),
    schemaAttempts: finiteCount(sample.schemaAttempts),
    schemaSuccesses: finiteCount(sample.schemaSuccesses),
    providerCalls: finiteCount(sample.providerCalls),
    providerFailures: finiteCount(sample.providerFailures),
    costUsd: finiteNonNegative(sample.costUsd),
    evidenceRefs: [...new Set((sample.evidenceRefs || []).map(String))].sort(),
    sampleId: ''
  };
  if (bound.schemaSuccesses > bound.schemaAttempts || bound.providerFailures > bound.providerCalls) throw new Error('Empirical sample counters are inconsistent.');
  return { ...bound, sampleId: digest(bound) };
}

function deduplicateSamples(samples: EmpiricalModelSampleV1[]): EmpiricalModelSampleV1[] {
  const byIdentity = new Map<string, EmpiricalModelSampleV1>();
  for (const sample of samples.map(validateExplicitSample)) {
    const identity = `${sample.sourceKind}\u0000${sample.sourceRunId}\u0000${sample.taskId}\u0000${sample.lane}\u0000${sample.modelId}`;
    const existing = byIdentity.get(identity);
    if (existing && existing.sampleId !== sample.sampleId) throw new Error(`Empirical sample identity collision or source tampering: ${sample.sourceRunId}/${sample.taskId}/${sample.modelId}.`);
    byIdentity.set(identity, sample);
  }
  return [...byIdentity.values()].sort((a, b) => a.cohortKey.localeCompare(b.cohortKey) || a.modelId.localeCompare(b.modelId) || a.sampleId.localeCompare(b.sampleId));
}

function assertExactModel(modelId: string): void {
  const value = String(modelId || '').trim();
  if (!value || META_ROUTES.has(value) || !value.includes('/')) throw new Error(`Empirical profiles require an exact concrete model slug, received '${value || '(empty)'}'.`);
}

function readJson(target: string): any { return JSON.parse(fs.readFileSync(target, 'utf8')); }
function boundedJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map(entry => path.join(root, entry.name))
    .sort()
    .slice(-MAX_SOURCE_ARTIFACTS);
}
function uniqueReportSources<T>(sources: T[], identity: (source: T) => string, contentDigest: (source: T) => string, label: string): T[] {
  const unique = new Map<string, { source: T; digest: string }>();
  for (const source of sources) {
    const id = String(identity(source) || '').trim();
    if (!id) throw new Error(`${label} source has no run identity.`);
    const currentDigest = contentDigest(source);
    const existing = unique.get(id);
    if (existing && existing.digest !== currentDigest) throw new Error(`${label} run identity collision or source tampering: ${id}.`);
    if (!existing) unique.set(id, { source, digest: currentDigest });
  }
  return [...unique.values()].map(value => value.source);
}
function hex64(value: unknown): boolean { return /^[a-f0-9]{64}$/i.test(String(value || '')); }
function finiteCount(value: unknown): number { const number = Math.floor(Number(value)); return Number.isFinite(number) && number >= 0 ? number : 0; }
function finiteNonNegative(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function nullableCost(value: number | null): number { return value === null ? Number.POSITIVE_INFINITY : value; }
function sum<T>(items: T[], selector: (item: T) => number): number { return items.reduce((total, item) => total + selector(item), 0); }
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function digest(value: unknown): string { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
function writeJsonAtomic(target: string, value: unknown, exclusive: boolean): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) { fs.writeFileSync(target, body, { encoding: 'utf8', flag: 'wx' }); return; }
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, body, 'utf8');
  fs.renameSync(temp, target);
}
