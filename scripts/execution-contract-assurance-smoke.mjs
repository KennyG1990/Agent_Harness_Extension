import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';
import { assuranceSuccessGate, executionContractDigest, isAuthorityWidening } from '../out/harness/executionContract.js';

function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2));
  fs.writeFileSync(path.join(root, 'test.js'), 'console.log("green");\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = true;\n');
  return root;
}

function provider(counter) {
  return {
    id: 'contract-scripted',
    modelId: 'weak-scripted',
    generateChat: async () => {
      counter.calls += 1;
      return { text: JSON.stringify({ explanation: 'Inspect the fixture.', confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name: 'repo_search', arguments: { query: 'app' } } }) };
    }
  };
}

const verifiedRoot = workspace('forge-contract-verified-');
const verifiedCalls = { calls: 0 };
const verifiedLoop = new AgentHarnessLoop(provider(verifiedCalls), verifiedRoot);
let verified = await verifiedLoop.initializeHarness('Verify the fixture.', { Editor: 'weak-scripted', Reviewer: 'review-scripted' }, {}, { assuranceLevel: 'verified', humanApprovalPolicy: 'auto' });
assert.equal(verified.executionContract.status, 'pending');
assert.equal(verified.status, 'awaiting_approval');
assert.equal(executionContractDigest(verified.executionContract.authority), verified.executionContract.digest);
verified = await verifiedLoop.runStep(verified, { Editor: 'weak-scripted', Reviewer: 'review-scripted' });
assert.equal(verifiedCalls.calls, 0, 'Verified must stop before the first provider call.');
await assert.rejects(() => verifiedLoop.decideExecutionContract('confirm', '0'.repeat(64)), /digest does not match/);
assert.equal(verifiedCalls.calls, 0);
const verifiedDigest = verified.executionContract.digest;
verified = await verifiedLoop.decideExecutionContract('confirm', verifiedDigest);
assert.equal(verified.executionContract.status, 'confirmed');
assert.equal(verified.status, 'idle');
await assert.rejects(() => verifiedLoop.decideExecutionContract('confirm', verifiedDigest), /not awaiting/);
assert.ok(fs.existsSync(path.join(verifiedRoot, '.forge', 'execution-contract.json')));
assert.ok(fs.existsSync(path.join(verifiedRoot, '.forge', 'execution-contracts.json')));

const previousAuthority = verified.executionContract.authority;
const widenedAuthority = { ...previousAuthority, budget: { ...previousAuthority.budget, maxCostUsd: previousAuthority.budget.maxCostUsd + 1 } };
assert.equal(isAuthorityWidening(previousAuthority, widenedAuthority), true);
fs.writeFileSync(path.join(verifiedRoot, '.forge', 'control.json'), JSON.stringify({ paused: false, editedGoal: { budgetUsd: previousAuthority.budget.maxCostUsd + 1 }, requestedAt: new Date().toISOString() }, null, 2));
verified = await verifiedLoop.runStep(verified, { Editor: 'weak-scripted', Reviewer: 'review-scripted' });
assert.equal(verified.executionContract.status, 'pending', 'budget widening must invalidate confirmation');
assert.equal(verified.executionContract.revision, 2);
assert.equal(verifiedCalls.calls, 0, 'widening must stop before another provider call');

const rejectRoot = workspace('forge-contract-reject-');
const rejectCalls = { calls: 0 };
const rejectLoop = new AgentHarnessLoop(provider(rejectCalls), rejectRoot);
let rejected = await rejectLoop.initializeHarness('Reject this verified run.', {}, {}, { assuranceLevel: 'verified' });
rejected = await rejectLoop.decideExecutionContract('reject', rejected.executionContract.digest);
assert.equal(rejected.status, 'gave_up');
assert.equal(rejected.executionContract.status, 'rejected');
assert.equal(rejectCalls.calls, 0);

const auditedRoot = workspace('forge-contract-audited-');
const auditedLoop = new AgentHarnessLoop(provider({ calls: 0 }), auditedRoot);
const audited = await auditedLoop.initializeHarness('Run audited verification.', {}, {}, { assuranceLevel: 'audited' });
assert.equal(audited.executionContract.availability.available, false);
assert.deepEqual(audited.executionContract.availability.missing.sort(), ['oracle calibration', 'proven OS/container isolation', 'signed attestation'].sort());
await assert.rejects(() => auditedLoop.decideExecutionContract('confirm', audited.executionContract.digest), /assurance is unavailable/);

const standardRoot = workspace('forge-contract-standard-');
const standardLoop = new AgentHarnessLoop(provider({ calls: 0 }), standardRoot);
let standard = await standardLoop.initializeHarness('Standard compatibility run.');
assert.equal(standard.executionContract.status, 'confirmed');
assert.equal(standard.executionContract.authority.assurance, 'standard');
delete standard.executionContract;
delete standard.executionContractHistory;
fs.writeFileSync(path.join(standardRoot, '.forge', 'control.json'), JSON.stringify({ cancelRequested: true }, null, 2));
standard = await standardLoop.runStep(standard);
assert.equal(standard.executionContract.authority.assurance, 'standard');
assert.equal(standard.executionContract.status, 'confirmed');

verified.lastOraclePass = true;
verified.runStats.actuallyModelDriven = true;
verified.runStats.fallbackActions = 0;
verified.executionContract = { ...verified.executionContract, status: 'confirmed', availability: { available: true, missing: [] } };
let gate = assuranceSuccessGate(verified);
assert.equal(gate.ready, true, `expected ready gate, got ${gate.missing.join(', ')}`);
verified.runStats.fallbackActions = 1;
gate = assuranceSuccessGate(verified);
assert.equal(gate.ready, false);
assert.ok(gate.missing.includes('zero fallback actions'));

console.log(JSON.stringify({
  passed: true,
  canonicalDigest: true,
  providerCallsBeforeConfirmation: verifiedCalls.calls,
  staleReplayRejected: true,
  wideningReconfirmed: true,
  rejectionNonMutating: true,
  auditedStrictUnavailable: true,
  legacyStandardNormalized: true,
  fallbackSuccessBlocked: true
}, null, 2));
