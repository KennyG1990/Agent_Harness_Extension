import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BranchCompareCoordinator, rankBranchCandidates } from '../out/harness/branchCompare.js';
import { executionContractDigest } from '../out/harness/executionContract.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-branch-compare-'));
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'value.js'), 'module.exports = 1;\n', 'utf8');
fs.writeFileSync(path.join(root, 'test.js'), "const assert=require('node:assert/strict'); assert.equal(require('./src/value'),2);\n", 'utf8');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'README.md'), 'frozen source\n', 'utf8');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const executor = async context => {
  await delay(250);
  const outcome = context.candidateId === 'candidate-1'
    ? { value: 2, green: true, modelDriven: true, modelProposals: 4, fallbackProposals: 0, fallbackActions: 0, cost: 0.02 }
    : context.candidateId === 'candidate-2'
      ? { value: 3, green: false, modelDriven: true, modelProposals: 4, fallbackProposals: 0, fallbackActions: 0, cost: 0.001 }
      : { value: 2, green: true, modelDriven: false, modelProposals: 0, fallbackProposals: 4, fallbackActions: 1, cost: 0.0001 };
  fs.writeFileSync(path.join(context.isolatedRoot, 'src', 'value.js'), `module.exports = ${outcome.value};\n`, 'utf8');
  const authority = {
    assurance: 'standard', objective: context.goal, constraints: ['same'], acceptanceCriteria: ['tests'], nonGoals: [],
    workspaceScopes: ['**'], allowedTools: ['read_file', 'apply_patch', 'run_tests', 'get_diff', 'record_evidence', 'declare_success'],
    expectedFiles: [], requiredOracles: ['test: npm test'], budget: { maxCostUsd: context.runBudget.maxCostUsd, maxWallClockMs: 60000, maxSteps: context.maxSteps },
    modelBindings: { code: context.modelId, review: context.reviewerModel }, approvalPolicy: 'ask',
    requirements: { explicitConfirmation: false, modelDrivenCompletion: false, fallbackFreeCompletion: false, independentReview: false, compositeOracle: true, signedAttestation: false, oracleCalibration: false, provenIsolation: false }
  };
  const state = {
    sessionId: context.candidateId,
    status: outcome.green ? 'success' : 'failed',
    currentStepIndex: 8,
    executionContract: { schemaVersion: 1, id: context.candidateId, sessionId: context.candidateId, revision: 1, digest: executionContractDigest(authority), status: 'confirmed', authority, availability: { available: true, missing: [] }, compiledAt: new Date().toISOString() },
    lastOraclePass: outcome.green,
    evidenceLedger: outcome.green ? [{ id: 'green', stepTitle: 'test', observation: 'green', testResult: { pass: true, summary: 'pass' }, confidence: 100, timestamp: new Date().toISOString() }] : [],
    diffReviews: [{ id: 'diff', reviewer: 'host', status: 'approved', summary: 'approved', diffExcerpt: 'diff', timestamp: new Date().toISOString() }],
    reviewerCritiques: [{ id: 'review', reviewer: 'independent', modelId: context.reviewerModel, source: 'model', status: 'approved', summary: 'approved', concerns: [], diffExcerpt: 'diff', timestamp: new Date().toISOString() }],
    runStats: { actuallyModelDriven: outcome.modelDriven, modelDrivenProposals: outcome.modelProposals, fallbackProposals: outcome.fallbackProposals, fallbackActions: outcome.fallbackActions, providerCalls: outcome.modelDriven ? 4 : 0, providerFailures: 0 },
    goalContract: { spent: outcome.cost },
    workerContexts: { Editor: { latencyMs: context.candidateId === 'candidate-1' ? 500 : 100 } }
  };
  fs.mkdirSync(path.join(context.isolatedRoot, '.forge'), { recursive: true });
  fs.writeFileSync(path.join(context.isolatedRoot, '.forge', 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  return state;
};

const unusedProvider = () => ({ capabilities: () => ({}), listModels: async () => [], generateChat: async () => { throw new Error('scripted executor does not call provider'); } });
const coordinator = new BranchCompareCoordinator(root, unusedProvider, executor);
const started = Date.now();
const report = await coordinator.run({
  goal: 'Repair value and prove tests.',
  candidateModels: ['weak/a', 'weak/b', 'weak/c'],
  reviewerModel: 'strong/reviewer',
  maxSteps: 12,
  maxTotalCostUsd: 0.09,
  isolationMode: 'copy',
  provenance: 'scripted'
});
const duration = Date.now() - started;
assert.ok(duration < 650, `three 250ms candidates should overlap, duration=${duration}`);
assert.equal(report.sourceMutated, false);
assert.equal(report.provenance, 'scripted');
assert.equal(report.maxTotalCostUsd, 0.09);
assert.equal(report.totalCostUsd, 0.0211);
assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'module.exports = 1;\n');
assert.equal(report.recommendedCandidateId, 'candidate-1');
assert.equal(report.candidates[0].eligible, true);
assert.equal(report.candidates[1].eligible, false);
assert.match(report.candidates[1].rejectionReasons.join(' '), /terminal status|green composite oracle/);
assert.equal(report.candidates[2].eligible, false);
assert.match(report.candidates[2].rejectionReasons.join(' '), /fallback-only/);
assert.ok(fs.existsSync(report.archivePath));
const eligibleExpensive = { ...report.candidates[0], candidateId: 'eligible-expensive', eligible: true, fallbackActions: 0, fallbackProposals: 0, costUsd: 0.02, wallClockMs: 100 };
const eligibleCheap = { ...eligibleExpensive, candidateId: 'eligible-cheap', costUsd: 0.01, wallClockMs: 900 };
const eligibleFast = { ...eligibleCheap, candidateId: 'eligible-fast', wallClockMs: 50 };
assert.deepEqual(rankBranchCandidates([eligibleExpensive, eligibleCheap]), ['eligible-cheap', 'eligible-expensive']);
assert.deepEqual(rankBranchCandidates([eligibleCheap, eligibleFast]), ['eligible-fast', 'eligible-cheap']);
assert.deepEqual(rankBranchCandidates([{ ...eligibleFast, candidateId: 'fallback', fallbackProposals: 1 }, eligibleExpensive]), ['eligible-expensive', 'fallback']);

await assert.rejects(() => new BranchCompareCoordinator(root).run({ goal: 'x', candidateModels: ['same', 'other'], reviewerModel: 'same' }), /reviewer model must differ/);

const latestBytes = fs.readFileSync(report.reportPath);
const tamperedReport = JSON.parse(latestBytes.toString('utf8'));
tamperedReport.recommendedCandidateId = 'candidate-2';
fs.writeFileSync(report.reportPath, JSON.stringify(tamperedReport, null, 2), 'utf8');
assert.throws(() => coordinator.loadLatest(), /digest is invalid/);
fs.writeFileSync(report.reportPath, latestBytes);

const winner = report.candidates[0];
const winnerFile = path.join(winner.isolatedRoot, 'src', 'value.js');
const winnerBytes = fs.readFileSync(winnerFile);
fs.writeFileSync(winnerFile, 'module.exports = 99;\n', 'utf8');
assert.throws(() => coordinator.reviewCopies('candidate-1'), /changed after ranking/);
fs.writeFileSync(winnerFile, winnerBytes);

const copies = coordinator.reviewCopies('candidate-1');
assert.equal(copies.length, 1);
coordinator.approveCandidate('candidate-1');
fs.writeFileSync(path.join(root, 'README.md'), 'concurrent edit\n', 'utf8');
await assert.rejects(() => coordinator.mergeCandidate('candidate-1'), /Source workspace changed/);
fs.writeFileSync(path.join(root, 'README.md'), 'frozen source\n', 'utf8');

const redOracle = async () => ({ pass: false, summary: 'injected red source oracle', checks: [] });
const rollbackCoordinator = new BranchCompareCoordinator(root, unusedProvider, executor, redOracle);
const rolledBack = await rollbackCoordinator.mergeCandidate('candidate-1');
assert.equal(rolledBack.merged, false);
assert.equal(rolledBack.rolledBack, true);
assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'module.exports = 1;\n');

const successfulCoordinator = new BranchCompareCoordinator(root);
const merged = await successfulCoordinator.mergeCandidate('candidate-1');
assert.equal(merged.merged, true);
assert.equal(execFileSync(process.execPath, ['test.js'], { cwd: root, encoding: 'utf8' }), '');
assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'module.exports = 2;\n');

console.log(`branch-compare smoke passed: winner=${report.recommendedCandidateId}, red=${report.candidates[1].eligible}, fallback=${report.candidates[2].eligible}, concurrent=${duration}ms, rollback=${rolledBack.rolledBack}`);
