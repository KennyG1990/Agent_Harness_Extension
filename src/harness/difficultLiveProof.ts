import * as fs from 'fs';
import * as path from 'path';
import { OpenRouterProvider } from './provider';
import { Tier2EvalReport, Tier2EvalRunner } from './weakEvalTier2';
import { assertNoLeak, proveTier4SuiteSolvable, tier4Tasks } from './weakEvalTier4';

export const APPROVED_WEAK_LIVE_MODELS = ['qwen/qwen-2.5-7b-instruct'] as const;

export interface DifficultLiveProofRequest {
  model: string;
  taskLimit?: number;
  maxHarnessSteps?: number;
  providerCallTimeoutMs?: number;
  reportRoot: string;
  confirmLiveSpend: boolean;
  keepFixtures?: boolean;
}

export interface DifficultLiveProofReport {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  modelId: string;
  modelQualification: { parameterClass: '7B'; rationale: string; promptPricePerMillionUsd: number; completionPricePerMillionUsd: number };
  live: true;
  tier: 4;
  outcome: 'uplift_observed' | 'model_capability_without_uplift' | 'no_uplift_observed';
  capabilityGatePassed: boolean;
  taskCount: number;
  completedTaskCount: number;
  bareSolved: number;
  harnessSolved: number;
  harnessModelDrivenSolved: number;
  fallbackSolved: 0;
  providerCalls: number;
  providerFailures: number;
  costUsd: number;
  rawReportPath?: string;
  rawArchivePath?: string;
  reportPath: string;
  archivePath: string;
  tasks: Array<{ id: string; kind: string; bareSolved: boolean; harnessSolved: boolean; modelDriven: boolean; oracleGreen: boolean; providerCalls: number; providerFailures: number }>;
}

export function normalizeDifficultLiveProofRequest(input: DifficultLiveProofRequest): Required<DifficultLiveProofRequest> {
  const model = String(input.model || '').trim();
  if (!(APPROVED_WEAK_LIVE_MODELS as readonly string[]).includes(model)) throw new Error(`Model '${model || '(empty)'}' is not approved for the weak-model proof. Use ${APPROVED_WEAK_LIVE_MODELS[0]}.`);
  if (input.confirmLiveSpend !== true) throw new Error('Explicit provider-credit confirmation is required.');
  const taskLimit = Math.floor(Number(input.taskLimit ?? 4));
  if (taskLimit < 1 || taskLimit > 4) throw new Error('Difficult live proof task count must be between 1 and 4.');
  const maxHarnessSteps = Math.floor(Number(input.maxHarnessSteps ?? 10));
  if (maxHarnessSteps < 4 || maxHarnessSteps > 12) throw new Error('Difficult live proof max steps must be between 4 and 12.');
  const providerCallTimeoutMs = Math.floor(Number(input.providerCallTimeoutMs ?? 90_000));
  if (providerCallTimeoutMs < 15_000 || providerCallTimeoutMs > 120_000) throw new Error('Provider call timeout must be between 15 and 120 seconds.');
  return { model, taskLimit, maxHarnessSteps, providerCallTimeoutMs, reportRoot: path.resolve(input.reportRoot), confirmLiveSpend: true, keepFixtures: input.keepFixtures === true };
}

export async function runDifficultLiveProof(input: DifficultLiveProofRequest): Promise<DifficultLiveProofReport> {
  const options = normalizeDifficultLiveProofRequest(input);
  const tasks = tier4Tasks().slice(0, options.taskLimit);
  for (const task of tasks) assertNoLeak(task);
  proveTier4SuiteSolvable(tasks);

  const catalogProvider = new OpenRouterProvider();
  const descriptor = (await catalogProvider.listModels()).find(model => model.id === options.model);
  if (!descriptor) throw new Error(`Approved weak model is not present in the live OpenRouter catalog: ${options.model}`);
  const promptPrice = Number(descriptor.promptPrice);
  const completionPrice = Number(descriptor.completionPrice);
  if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice) || promptPrice > 0.0000002 || completionPrice > 0.0000005) {
    throw new Error('Weak-model price guard rejected the current catalog pricing; review the model before spending credits.');
  }

  const runner = new Tier2EvalRunner(() => new OpenRouterProvider());
  const raw: Tier2EvalReport = await runner.run({
    model: options.model,
    live: true,
    taskLimit: options.taskLimit,
    tasks,
    tier: 4,
    maxHarnessSteps: options.maxHarnessSteps,
    providerCallTimeoutMs: options.providerCallTimeoutMs,
    keepFixtures: options.keepFixtures,
    reportRoot: options.reportRoot
  });
  return persistDifficultProofReport(buildDifficultProofReport(raw, descriptor.name || options.model, promptPrice, completionPrice, options.reportRoot));
}

export function buildDifficultProofReport(raw: Tier2EvalReport, modelName: string, promptPrice: number, completionPrice: number, reportRoot: string): DifficultLiveProofReport {
  const tasks = raw.tasks.map(task => ({
    id: task.id,
    kind: task.kind,
    bareSolved: task.bare.solved,
    harnessSolved: task.harness?.solved === true,
    modelDriven: task.harness?.modelDriven === true,
    oracleGreen: task.harness?.workspaceOracleGreen === true,
    providerCalls: task.bare.providerCalls + (task.harness?.providerCalls || 0),
    providerFailures: task.bare.providerFailures + (task.harness?.providerFailures || 0)
  }));
  const harnessModelDrivenSolved = tasks.filter(task => task.harnessSolved && task.modelDriven && task.oracleGreen).length;
  const outcome = raw.harnessSolved > raw.bareSolved ? 'uplift_observed' : raw.harnessSolved > 0 ? 'model_capability_without_uplift' : 'no_uplift_observed';
  const reportPath = path.join(reportRoot, '.forge', 'evals', 'latest-difficult-live-proof.json');
  const archivePath = path.join(reportRoot, '.forge', 'evals', 'runs', 'difficult-live', `${raw.runId}.json`);
  return {
    schemaVersion: 1,
    runId: raw.runId,
    generatedAt: new Date().toISOString(),
    modelId: raw.modelId,
    modelQualification: {
      parameterClass: '7B',
      rationale: `${modelName} is the approved older inexpensive 7B baseline; routers, frontier models, and stronger architect substitutions are rejected.`,
      promptPricePerMillionUsd: promptPrice * 1_000_000,
      completionPricePerMillionUsd: completionPrice * 1_000_000
    },
    live: true,
    tier: 4,
    outcome,
    capabilityGatePassed: raw.taskCount >= 2 && harnessModelDrivenSolved >= 2 && raw.harnessSolved > raw.bareSolved,
    taskCount: raw.taskCount,
    completedTaskCount: raw.completedTaskCount || raw.tasks.length,
    bareSolved: raw.bareSolved,
    harnessSolved: raw.harnessSolved,
    harnessModelDrivenSolved,
    fallbackSolved: 0,
    providerCalls: raw.providerCalls,
    providerFailures: raw.providerFailures,
    costUsd: raw.cost,
    rawReportPath: raw.reportPath,
    rawArchivePath: raw.archivePath,
    reportPath,
    archivePath,
    tasks
  };
}

export function persistDifficultProofReport(report: DifficultLiveProofReport): DifficultLiveProofReport {
  const serialized = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.dirname(report.reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(report.archivePath), { recursive: true });
  if (fs.existsSync(report.archivePath)) throw new Error(`Difficult proof archive already exists: ${report.runId}`);
  fs.writeFileSync(report.archivePath, serialized, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(report.reportPath, serialized, 'utf8');
  return report;
}
