import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { normalizeDifficultLiveProofRequest, APPROVED_WEAK_LIVE_MODELS, buildDifficultProofReport, persistDifficultProofReport } = await import(pathToFileURL(path.resolve('out/harness/difficultLiveProof.js')).href);
const base = { model: APPROVED_WEAK_LIVE_MODELS[0], reportRoot: process.cwd(), confirmLiveSpend: true };
const normalized = normalizeDifficultLiveProofRequest(base);
assert.equal(normalized.taskLimit, 4);
assert.equal(normalized.maxHarnessSteps, 10);
assert.equal(normalized.providerCallTimeoutMs, 90000);
assert.throws(() => normalizeDifficultLiveProofRequest({ ...base, model: 'anthropic/claude-opus-latest' }), /not approved/);
assert.throws(() => normalizeDifficultLiveProofRequest({ ...base, confirmLiveSpend: false }), /confirmation/);
assert.throws(() => normalizeDifficultLiveProofRequest({ ...base, taskLimit: 5 }), /between 1 and 4/);
assert.throws(() => normalizeDifficultLiveProofRequest({ ...base, maxHarnessSteps: 30 }), /between 4 and 12/);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-difficult-proof-'));
const lane = solved => ({ solved, modelDriven: solved, workspaceOracleGreen: solved, authoredTest: false, providerCalls: 2, providerFailures: 0, steps: 2, cost: 0.001, fixtureRoot: 'fixture' });
const raw = {
  runId: 'tier4-live-test', startedAt: new Date().toISOString(), passed: true, status: 'uplift_observed', partial: false, completedTaskCount: 2, tier: 4, generatedAt: new Date().toISOString(), modelId: normalized.model, live: true,
  taskCount: 2, bareSolved: 0, harnessSolved: 2, solveRateDelta: 1, byKind: {}, providerCalls: 8, providerFailures: 0, cost: 0.004,
  tasks: [1, 2].map(index => ({ id: `t4-${index}`, title: 'Symptom only', kind: 'causal-chain', bare: lane(false), harness: lane(true) }))
};
const report = buildDifficultProofReport(raw, 'Qwen 2.5 7B', 0.00000004, 0.0000001, root);
assert.equal(report.capabilityGatePassed, true);
assert.equal(report.harnessModelDrivenSolved, 2);
assert.equal(report.fallbackSolved, 0);
assert.equal(report.outcome, 'uplift_observed');
persistDifficultProofReport(report);
assert.ok(fs.existsSync(report.reportPath) && fs.existsSync(report.archivePath));
assert.throws(() => persistDifficultProofReport(report), /already exists/, 'immutable difficult-proof archives must reject overwrite.');
console.log(JSON.stringify({ passed: true, approvedModel: normalized.model, tasks: normalized.taskLimit, maxSteps: normalized.maxHarnessSteps, timeoutMs: normalized.providerCallTimeoutMs, classification: report.outcome, immutableArchive: true }, null, 2));
fs.rmSync(root, { recursive: true, force: true });
