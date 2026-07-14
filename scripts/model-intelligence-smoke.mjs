import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BranchCompareCoordinator } from '../out/harness/branchCompare.js';
import { executionContractDigest } from '../out/harness/executionContract.js';
import { ModelIntelligenceService, compileProfiles, compileRankings, productionSamples, wilsonInterval } from '../out/harness/modelIntelligence.js';

const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-model-intelligence-'));
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'value.js'), 'module.exports = 1;\n');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));

const production = {
  schemaVersion: 1,
  runId: 'production-live-1',
  generatedAt: new Date().toISOString(),
  modelId: 'weak/exact-9b',
  live: true,
  suiteDigest: hash('suite'),
  expectedSuiteDigest: hash('suite'),
  suiteIntegrity: true,
  taskCount: 3,
  completedTaskCount: 3,
  bareSolved: 0,
  harnessSolved: 2,
  harnessModelDrivenSolved: 2,
  fallbackSolved: 0,
  bareSolveRate: 0,
  harnessSolveRate: 2 / 3,
  modelDrivenSolveRate: 2 / 3,
  solveRateDelta: 2 / 3,
  falseSuccessCount: 1,
  falseSuccessRate: 1 / 3,
  providerCalls: 6,
  providerFailures: 1,
  providerFailureRate: 1 / 6,
  schemaAttempts: 1,
  schemaSuccesses: 1,
  costUsd: 0.03,
  wallClockMs: 1000,
  averageWallClockPerProviderCallMs: 1000 / 6,
  floors: {}, floorResults: {}, benchmarkPassed: false, releaseReady: false,
  reportPath: 'latest.json', archivePath: 'archive.json', archiveImmutable: true,
  tasks: [0, 1, 2].map(index => ({
    id: `task-${index + 1}`, kind: 'fixture', inputDigest: hash(`input-${index}`), judgeDigest: hash(`judge-${index}`), equalLaneInputs: true,
    bareSolved: false, harnessSolved: index < 2, modelDriven: index < 2, workspaceOracleGreen: index < 2, falseSuccess: index === 2,
    providerCalls: 2, providerFailures: index === 2 ? 1 : 0, harnessSteps: 2, costUsd: 0.01
  }))
};
const productionResult = productionSamples(production, 'production.json');
assert.equal(productionResult.length, 3);
assert.equal(productionResult.filter(sample => sample.solved).length, 2);
assert.equal(productionResult.filter(sample => sample.falseSuccess).length, 1);
assert.equal(productionResult.reduce((sum, sample) => sum + sample.schemaAttempts, 0), 1);

const executor = async context => {
  const winner = context.candidateId === 'candidate-1';
  if (winner) fs.writeFileSync(path.join(context.isolatedRoot, 'src', 'value.js'), 'module.exports = 2;\n');
  const authority = {
    assurance: 'standard', objective: context.goal, constraints: [], acceptanceCriteria: ['green'], nonGoals: [], workspaceScopes: ['**'],
    allowedTools: ['read_file', 'apply_patch', 'run_tests', 'get_diff', 'record_evidence', 'declare_success'], expectedFiles: [], requiredOracles: ['test'],
    budget: { maxCostUsd: context.runBudget.maxCostUsd, maxWallClockMs: 60000, maxSteps: context.maxSteps },
    modelBindings: { code: context.modelId, review: context.reviewerModel }, approvalPolicy: 'ask',
    requirements: { explicitConfirmation: false, modelDrivenCompletion: false, fallbackFreeCompletion: false, independentReview: false, compositeOracle: true, signedAttestation: false, oracleCalibration: false, provenIsolation: false }
  };
  const state = {
    sessionId: context.candidateId, status: winner ? 'success' : 'failed', currentStepIndex: 2,
    executionContract: { schemaVersion: 1, id: context.candidateId, sessionId: context.candidateId, revision: 1, digest: executionContractDigest(authority), status: 'confirmed', authority, availability: { available: true, missing: [] }, compiledAt: new Date().toISOString() },
    lastOraclePass: winner,
    evidenceLedger: winner ? [{ id: 'green', stepTitle: 'test', observation: 'green', testResult: { pass: true, summary: 'green' }, confidence: 100, timestamp: new Date().toISOString() }] : [],
    diffReviews: [{ id: 'diff', reviewer: 'host', status: 'approved', summary: 'approved', diffExcerpt: 'diff', timestamp: new Date().toISOString() }],
    reviewerCritiques: [{ id: 'review', reviewer: 'review', modelId: context.reviewerModel, source: 'model', status: 'approved', summary: 'approved', concerns: [], diffExcerpt: 'diff', timestamp: new Date().toISOString() }],
    runStats: winner
      ? { actuallyModelDriven: true, modelDrivenProposals: 2, fallbackProposals: 0, fallbackActions: 0, providerCalls: 3, providerFailures: 0, schemaFailures: 1 }
      : { actuallyModelDriven: false, modelDrivenProposals: 0, fallbackProposals: 1, fallbackActions: 1, providerCalls: 1, providerFailures: 1, schemaFailures: 1 },
    goalContract: { spent: winner ? 0.02 : 0.001 }, workerContexts: { Editor: { latencyMs: 10 } }
  };
  fs.mkdirSync(path.join(context.isolatedRoot, '.forge'), { recursive: true });
  fs.writeFileSync(path.join(context.isolatedRoot, '.forge', 'state.json'), JSON.stringify(state, null, 2));
  return state;
};
const unusedProvider = () => ({ capabilities: () => ({}), listModels: async () => [], generateChat: async () => { throw new Error('provider must not run'); } });
const branch = await new BranchCompareCoordinator(root, unusedProvider, executor).run({
  goal: 'Change value with verified evidence.', candidateModels: ['weak/a', 'weak/b'], reviewerModel: 'review/exact', isolationMode: 'copy', provenance: 'scripted'
});
assert.equal(branch.provenance, 'scripted');

fs.mkdirSync(path.join(root, '.forge', 'evals'), { recursive: true });
fs.writeFileSync(path.join(root, '.forge', 'evals', 'latest-weak-model-eval.json'), '{}');
fs.writeFileSync(path.join(root, '.forge', 'evals', 'latest-production-benchmark.json'), JSON.stringify(production, null, 2));
fs.mkdirSync(path.join(root, '.forge', 'evals', 'runs', 'production'), { recursive: true });
fs.writeFileSync(path.join(root, '.forge', 'evals', 'runs', 'production', `${production.runId}.json`), JSON.stringify(production, null, 2));
const service = new ModelIntelligenceService(root);
const discovered = service.rebuild();
assert.equal(discovered.acceptedSourceCount, 2, 'latest/archive aliases must deduplicate to one production and one branch run');
assert.equal(discovered.samples.length, 5);
assert.equal(discovered.unsupportedSources.length, 1);
const productionArchive = path.join(root, '.forge', 'evals', 'runs', 'production', `${production.runId}.json`);
const productionArchiveBytes = fs.readFileSync(productionArchive);
fs.writeFileSync(productionArchive, JSON.stringify({ ...production, costUsd: 99 }, null, 2));
assert.throws(() => service.loadLatest(), /source artifact is missing, stale, or tampered/);
fs.writeFileSync(productionArchive, productionArchiveBytes);
const report = service.rebuild({ productionReports: [{ report: production, sourcePath: 'production.json' }], branchReports: [{ report: branch, sourcePath: branch.reportPath }], discoverWorkspaceArtifacts: false });
assert.equal(report.samples.length, 5);
assert.equal(report.measuredProfileCount, 0, 'unrepeated task cohorts must remain provisional');

// Build a true repeated-task cohort to prove measured thresholds without pooling unlike tasks.
const cohort = hash('repeated-contract');
const sourceDigest = hash('source');
const repeated = [1, 2, 3].map(index => ({
  schemaVersion: 1, sampleId: '', sourceKind: 'production-benchmark', provenance: 'live', sourcePath: `run-${index}.json`, sourceDigest,
  sourceRunId: `run-${index}`, modelId: 'weak/repeated-9b', cohortKey: cohort, taskId: `repeat-${index}`, lane: 'harness',
  solved: index < 3, verified: true, modelDriven: true, falseSuccess: false, schemaAttempts: 1, schemaSuccesses: index < 3 ? 1 : 0,
  providerCalls: 2, providerFailures: 0, costUsd: 0.01, fallbackDependent: index === 3, evidenceRefs: [`evidence-${index}.json`]
}));
const measuredProfile = compileProfiles(repeated)[0];
assert.equal(measuredProfile.claimLevel, 'measured');
assert.equal(measuredProfile.modelDrivenSolved, 2);
assert.equal(measuredProfile.fallbackDependence, 1 / 3);
assert.equal(measuredProfile.schemaReliability, 2 / 3);
assert.equal(measuredProfile.costPerVerifiedTaskUsd, 0.01);

const scripted = repeated.map(sample => ({ ...sample, sourceKind: 'scripted', provenance: 'scripted' }));
const scriptedReport = service.rebuild({ scriptedSamples: scripted, discoverWorkspaceArtifacts: false });
assert.equal(scriptedReport.profiles[0].claimLevel, 'provisional', 'scripted evidence must never become measured');
const mixedProfiles = compileProfiles([
  ...repeated.map(sample => ({ ...sample, verified: false, solved: false })),
  ...scripted.map((sample, index) => ({ ...sample, sourceRunId: `scripted-${index}`, taskId: `scripted-${index}` }))
]);
assert.equal(mixedProfiles.length, 2, 'live and scripted provenance must never pool into one profile');
assert.ok(mixedProfiles.every(profile => profile.claimLevel === 'provisional'), 'unverified live evidence plus scripted green evidence must not become measured');

const duplicateReport = service.rebuild({ scriptedSamples: [scripted[0], scripted[0]], discoverWorkspaceArtifacts: false });
assert.equal(duplicateReport.samples.length, 1);
const collision = { ...scripted[0], solved: false };
assert.throws(() => service.rebuild({ scriptedSamples: [scripted[0], collision], discoverWorkspaceArtifacts: false }), /collision or source tampering/);

const unlikeProfiles = compileProfiles([
  ...repeated.slice(0, 1),
  { ...repeated[1], cohortKey: hash('different-contract'), modelId: 'other/exact' }
]);
assert.equal(compileRankings(unlikeProfiles).length, 0, 'unlike cohorts must not rank head-to-head');
const interval = wilsonInterval(2, 3);
assert.ok(interval.low > 0 && interval.high < 1 && interval.low < 2 / 3 && interval.high > 2 / 3);

const latest = service.loadLatest();
assert.equal(latest.samples.length, 1);
const latestPath = path.join(root, '.forge', 'model-intelligence', 'latest.json');
const bytes = fs.readFileSync(latestPath);
const tampered = JSON.parse(bytes);
tampered.profiles[0].solveRate = 0.123456;
fs.writeFileSync(latestPath, JSON.stringify(tampered, null, 2));
assert.throws(() => service.loadLatest(), /digest mismatch/);
fs.writeFileSync(latestPath, bytes);

assert.throws(() => service.rebuild({ scriptedSamples: [{ ...scripted[0], modelId: 'openrouter/auto' }], discoverWorkspaceArtifacts: false }), /exact concrete model/);
assert.throws(() => service.rebuild({ scriptedSamples: [repeated[0]], discoverWorkspaceArtifacts: false }), /must remain scripted/);
console.log(`model-intelligence smoke passed: production=${productionResult.length}, branch=${branch.candidates.length}, measured=${measuredProfile.claimLevel}, scripted=${scriptedReport.profiles[0].claimLevel}, duplicate=${duplicateReport.samples.length}`);
