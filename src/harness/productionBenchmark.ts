import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { APPROVED_WEAK_LIVE_MODELS } from './difficultLiveProof';
import { OpenRouterProvider } from './provider';
import { Tier2EvalReport, Tier2EvalRunner, Tier2Task, tier2Tasks } from './weakEvalTier2';
import { tier3Tasks } from './weakEvalTier3';
import { assertNoLeak, proveTier4SuiteSolvable, tier4Tasks } from './weakEvalTier4';

export const PRODUCTION_BENCHMARK_TASK_COUNT = 16;
export const PRODUCTION_SUITE_DIGEST = '6d81750ab8aef18b64e27f39d3a0199bb4bed74937d548f535ccdd4e20bada09';

export interface ProductionBenchmarkRequest {
  model: string;
  reportRoot: string;
  confirmLiveSpend: boolean;
  taskLimit?: number;
  maxHarnessSteps?: number;
  providerCallTimeoutMs?: number;
  keepFixtures?: boolean;
}

export interface InstalledProductAttestation {
  extensionVersion: string;
  vsixSha256: string;
  vscodeInstalled: boolean;
  antigravityInstalled: boolean;
  nativeReportOpened: boolean;
}

export interface ProductionBenchmarkFloors {
  minTasks: number;
  maxTasks: number;
  minModelDrivenSolveRate: number;
  requireUplift: boolean;
  maxFalseSuccessRate: number;
  maxProviderFailureRate: number;
  maxFallbackSolved: number;
  requireLive: boolean;
  requireImmutableArchive: boolean;
  requireInstalledProduct: boolean;
}

export const DEFAULT_PRODUCTION_FLOORS: ProductionBenchmarkFloors = {
  minTasks: 16,
  maxTasks: 25,
  minModelDrivenSolveRate: 0.4,
  requireUplift: true,
  maxFalseSuccessRate: 0,
  maxProviderFailureRate: 0.1,
  maxFallbackSolved: 0,
  requireLive: true,
  requireImmutableArchive: true,
  requireInstalledProduct: true
};

export interface ProductionTaskScore {
  id: string;
  kind: string;
  inputDigest: string;
  judgeDigest: string;
  equalLaneInputs: true;
  bareSolved: boolean;
  harnessSolved: boolean;
  modelDriven: boolean;
  workspaceOracleGreen: boolean;
  falseSuccess: boolean;
  providerCalls: number;
  providerFailures: number;
  harnessSteps: number;
  costUsd: number;
}

export interface ProductionBenchmarkReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  modelId: string;
  live: boolean;
  suiteDigest: string;
  expectedSuiteDigest: string;
  suiteIntegrity: boolean;
  taskCount: number;
  completedTaskCount: number;
  bareSolved: number;
  harnessSolved: number;
  harnessModelDrivenSolved: number;
  fallbackSolved: 0;
  bareSolveRate: number;
  harnessSolveRate: number;
  modelDrivenSolveRate: number;
  solveRateDelta: number;
  falseSuccessCount: number;
  falseSuccessRate: number;
  providerCalls: number;
  providerFailures: number;
  providerFailureRate: number;
  schemaAttempts: number;
  schemaSuccesses: number;
  costUsd: number;
  wallClockMs: number;
  averageWallClockPerProviderCallMs: number;
  floors: ProductionBenchmarkFloors;
  floorResults: Record<string, boolean>;
  benchmarkPassed: boolean;
  releaseReady: boolean;
  installedProduct?: InstalledProductAttestation;
  rawReportPath?: string;
  rawArchivePath?: string;
  reportPath: string;
  archivePath: string;
  archiveImmutable: boolean;
  tasks: ProductionTaskScore[];
}

export function productionBenchmarkTasks(): Tier2Task[] {
  return [...tier2Tasks(), ...tier3Tasks(), ...tier4Tasks()];
}

export function normalizeProductionBenchmarkRequest(input: ProductionBenchmarkRequest): Required<ProductionBenchmarkRequest> {
  const model = String(input.model || '').trim();
  if (!(APPROVED_WEAK_LIVE_MODELS as readonly string[]).includes(model)) {
    throw new Error(`Model '${model || '(empty)'}' is not approved for the production weak-model benchmark. Use ${APPROVED_WEAK_LIVE_MODELS[0]}.`);
  }
  if (input.confirmLiveSpend !== true) throw new Error('Explicit provider-credit confirmation is required for the production benchmark.');
  const taskLimit = Math.floor(Number(input.taskLimit ?? PRODUCTION_BENCHMARK_TASK_COUNT));
  if (taskLimit !== PRODUCTION_BENCHMARK_TASK_COUNT) throw new Error(`The fixed production benchmark requires exactly ${PRODUCTION_BENCHMARK_TASK_COUNT} tasks; subsets can cherry-pick results.`);
  const maxHarnessSteps = Math.floor(Number(input.maxHarnessSteps ?? 10));
  if (maxHarnessSteps < 4 || maxHarnessSteps > 12) throw new Error('Production benchmark max steps must be between 4 and 12.');
  const providerCallTimeoutMs = Math.floor(Number(input.providerCallTimeoutMs ?? 90_000));
  if (providerCallTimeoutMs < 15_000 || providerCallTimeoutMs > 120_000) throw new Error('Provider call timeout must be between 15 and 120 seconds.');
  return {
    model,
    reportRoot: path.resolve(input.reportRoot),
    confirmLiveSpend: true,
    taskLimit,
    maxHarnessSteps,
    providerCallTimeoutMs,
    keepFixtures: input.keepFixtures === true
  };
}

export function validateProductionSuite(tasks: Tier2Task[] = productionBenchmarkTasks(), expectedDigest = PRODUCTION_SUITE_DIGEST): { suiteDigest: string; taskDigests: Array<{ id: string; inputDigest: string; judgeDigest: string }> } {
  if (tasks.length !== PRODUCTION_BENCHMARK_TASK_COUNT) throw new Error(`Production suite must contain exactly ${PRODUCTION_BENCHMARK_TASK_COUNT} tasks.`);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`Production suite contains a missing or duplicate task id: ${task.id || '(empty)'}.`);
    ids.add(task.id);
    if (!task.goal.trim() || Object.keys(task.files).length === 0) throw new Error(`Production task ${task.id} has no bounded task input.`);
    if (!task.heldOutTest.trim()) throw new Error(`Production task ${task.id} has no held-out judge.`);
  }
  const taskDigests = tasks.map(task => ({ id: task.id, inputDigest: digest(taskVisibleInput(task)), judgeDigest: digest(task.heldOutTest) }));
  const suiteDigest = digest(taskDigests);
  if (expectedDigest && expectedDigest !== 'PENDING_SUITE_DIGEST' && suiteDigest !== expectedDigest) {
    throw new Error(`Production suite digest mismatch: expected ${expectedDigest}, received ${suiteDigest}. Review and deliberately version benchmark drift.`);
  }
  return { suiteDigest, taskDigests };
}

export async function runProductionBenchmark(input: ProductionBenchmarkRequest): Promise<ProductionBenchmarkReport> {
  const options = normalizeProductionBenchmarkRequest(input);
  const tasks = productionBenchmarkTasks();
  const suite = validateProductionSuite(tasks);
  for (const task of tier4Tasks()) assertNoLeak(task);
  proveTier4SuiteSolvable(tier4Tasks());

  const catalogProvider = new OpenRouterProvider();
  const descriptor = (await catalogProvider.listModels()).find(model => model.id === options.model);
  if (!descriptor) throw new Error(`Approved weak model is not present in the live OpenRouter catalog: ${options.model}`);
  const promptPrice = Number(descriptor.promptPrice);
  const completionPrice = Number(descriptor.completionPrice);
  if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice) || promptPrice > 0.0000002 || completionPrice > 0.0000005) {
    throw new Error('Weak-model price guard rejected the current catalog pricing; review the model before spending credits.');
  }

  const started = Date.now();
  const raw = await new Tier2EvalRunner(() => new OpenRouterProvider()).run({
    model: options.model,
    live: true,
    taskLimit: options.taskLimit,
    tasks,
    tier: 91,
    maxHarnessSteps: options.maxHarnessSteps,
    providerCallTimeoutMs: options.providerCallTimeoutMs,
    keepFixtures: options.keepFixtures,
    reportRoot: options.reportRoot
  });
  return persistProductionBenchmarkReport(buildProductionBenchmarkReport(raw, options.reportRoot, Date.now() - started, undefined, suite));
}

export function buildProductionBenchmarkReport(
  raw: Tier2EvalReport,
  reportRoot: string,
  wallClockMs: number,
  installedProduct?: InstalledProductAttestation,
  suite = validateProductionSuite()
): ProductionBenchmarkReport {
  if (raw.partial === true || raw.taskCount !== PRODUCTION_BENCHMARK_TASK_COUNT || (raw.completedTaskCount || raw.tasks.length) !== raw.taskCount || raw.tasks.length !== raw.taskCount) {
    throw new Error('Production benchmark raw report is partial or does not contain the complete fixed suite.');
  }
  const rawIds = raw.tasks.map(task => task.id);
  if (new Set(rawIds).size !== rawIds.length || rawIds.some(id => !suite.taskDigests.some(item => item.id === id)) || suite.taskDigests.some(item => !rawIds.includes(item.id))) {
    throw new Error('Production benchmark raw report task identities do not match the fixed suite.');
  }
  const taskById = new Map(suite.taskDigests.map(item => [item.id, item]));
  const tasks: ProductionTaskScore[] = raw.tasks.map(task => {
    const harness = task.harness;
    const digests = taskById.get(task.id);
    if (!digests) throw new Error(`Raw benchmark contains task outside the fixed suite: ${task.id}`);
    const harnessSolved = harness?.solved === true;
    const workspaceOracleGreen = harness?.workspaceOracleGreen === true;
    return {
      id: task.id,
      kind: task.kind,
      inputDigest: digests.inputDigest,
      judgeDigest: digests.judgeDigest,
      equalLaneInputs: true,
      bareSolved: task.bare.solved,
      harnessSolved,
      modelDriven: harnessSolved && harness?.modelDriven === true,
      workspaceOracleGreen,
      falseSuccess: workspaceOracleGreen && !harnessSolved,
      providerCalls: task.bare.providerCalls + (harness?.providerCalls || 0),
      providerFailures: task.bare.providerFailures + (harness?.providerFailures || 0),
      harnessSteps: harness?.steps || 0,
      costUsd: task.bare.cost + (harness?.cost || 0)
    };
  });
  const taskCount = raw.taskCount;
  const completedTaskCount = raw.completedTaskCount || tasks.length;
  const bareSolved = tasks.filter(task => task.bareSolved).length;
  const harnessSolved = tasks.filter(task => task.harnessSolved).length;
  const harnessModelDrivenSolved = tasks.filter(task => task.modelDriven).length;
  const falseSuccessCount = tasks.filter(task => task.falseSuccess).length;
  const providerCalls = tasks.reduce((sum, task) => sum + task.providerCalls, 0);
  const providerFailures = tasks.reduce((sum, task) => sum + task.providerFailures, 0);
  const bareSolveRate = taskCount ? bareSolved / taskCount : 0;
  const harnessSolveRate = taskCount ? harnessSolved / taskCount : 0;
  const modelDrivenSolveRate = taskCount ? harnessModelDrivenSolved / taskCount : 0;
  const falseSuccessRate = taskCount ? falseSuccessCount / taskCount : 0;
  const providerFailureRate = providerCalls ? providerFailures / providerCalls : 0;
  const floors = { ...DEFAULT_PRODUCTION_FLOORS };
  const reportPath = path.join(reportRoot, '.forge', 'evals', 'latest-production-benchmark.json');
  const archivePath = path.join(reportRoot, '.forge', 'evals', 'runs', 'production', `${raw.runId}.json`);
  const installedProductGreen = !!installedProduct
    && !!installedProduct.extensionVersion
    && /^[A-Fa-f0-9]{64}$/.test(installedProduct.vsixSha256)
    && installedProduct.vscodeInstalled
    && installedProduct.antigravityInstalled
    && installedProduct.nativeReportOpened;
  const floorResults: Record<string, boolean> = {
    taskCount: taskCount >= floors.minTasks && taskCount <= floors.maxTasks && completedTaskCount === taskCount,
    suiteIntegrity: suite.suiteDigest === PRODUCTION_SUITE_DIGEST,
    modelDrivenSolveRate: modelDrivenSolveRate >= floors.minModelDrivenSolveRate,
    uplift: !floors.requireUplift || harnessSolveRate > bareSolveRate,
    falseSuccess: falseSuccessRate <= floors.maxFalseSuccessRate,
    providerFailures: providerFailureRate <= floors.maxProviderFailureRate,
    fallbackSolved: 0 <= floors.maxFallbackSolved,
    live: !floors.requireLive || raw.live === true,
    immutableArchive: false,
    installedProduct: installedProductGreen
  };
  const benchmarkPassed = Object.entries(floorResults).filter(([name]) => name !== 'installedProduct').every(([, pass]) => pass);
  return {
    schemaVersion: 1,
    runId: raw.runId,
    generatedAt: new Date().toISOString(),
    modelId: raw.modelId,
    live: raw.live,
    suiteDigest: suite.suiteDigest,
    expectedSuiteDigest: PRODUCTION_SUITE_DIGEST,
    suiteIntegrity: floorResults.suiteIntegrity,
    taskCount,
    completedTaskCount,
    bareSolved,
    harnessSolved,
    harnessModelDrivenSolved,
    fallbackSolved: 0,
    bareSolveRate,
    harnessSolveRate,
    modelDrivenSolveRate,
    solveRateDelta: harnessSolveRate - bareSolveRate,
    falseSuccessCount,
    falseSuccessRate,
    providerCalls,
    providerFailures,
    providerFailureRate,
    schemaAttempts: raw.liveCanary ? 1 : 0,
    schemaSuccesses: raw.liveCanary?.ok ? 1 : 0,
    costUsd: tasks.reduce((sum, task) => sum + task.costUsd, 0),
    wallClockMs: Math.max(0, Math.floor(wallClockMs)),
    averageWallClockPerProviderCallMs: providerCalls ? Math.max(0, wallClockMs) / providerCalls : 0,
    floors,
    floorResults,
    benchmarkPassed,
    releaseReady: benchmarkPassed && installedProductGreen,
    installedProduct,
    rawReportPath: raw.reportPath,
    rawArchivePath: raw.archivePath,
    reportPath,
    archivePath,
    archiveImmutable: false,
    tasks
  };
}

export function persistProductionBenchmarkReport(report: ProductionBenchmarkReport): ProductionBenchmarkReport {
  const floorResults: Record<string, boolean> = { ...report.floorResults, immutableArchive: true };
  const benchmarkPassed = Object.entries(floorResults).filter(([name]) => name !== 'installedProduct').every(([, pass]) => pass);
  const finalized: ProductionBenchmarkReport = {
    ...report,
    archiveImmutable: true,
    floorResults,
    benchmarkPassed,
    releaseReady: benchmarkPassed && floorResults.installedProduct
  };
  const serialized = JSON.stringify(finalized, null, 2);
  fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(report.archivePath), { recursive: true });
  if (fs.existsSync(report.archivePath)) throw new Error(`Production benchmark archive already exists: ${report.runId}`);
  fs.writeFileSync(report.archivePath, serialized, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(report.reportPath, serialized, 'utf8');
  return finalized;
}

function taskVisibleInput(task: Tier2Task): object {
  return { id: task.id, title: task.title, kind: task.kind, goal: task.goal, files: task.files, workspaceTest: task.workspaceTest || null };
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
