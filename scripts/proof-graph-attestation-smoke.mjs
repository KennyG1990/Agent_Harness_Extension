import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';
import { AttestationService, verifyAttestation } from '../out/harness/attestation.js';
import { buildProofGraph, proofGraphDigest, verifyProofGraph } from '../out/harness/proofGraph.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-attestation-'));
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }));
fs.writeFileSync(path.join(root, 'test.js'), 'console.log("green")\n');
const provider = { id: 'unused', modelId: 'weak-model', generateChat: async () => { throw new Error('provider must not run'); } };
const loop = new AgentHarnessLoop(provider, root);
const secretCanary = 'API_KEY_SECRET_X_DO_NOT_DISCLOSE';
const pathCanary = 'C:\\private\\customer\\source.ts';
let state = await loop.initializeHarness(`Prove ${secretCanary} without exposing ${pathCanary}.`);
state.status = 'success';
state.haltReason = 'All acceptance criteria verified.';
state.lastOraclePass = true;
state.oracleStatuses.tests = 'pass';
state.runStats.actuallyModelDriven = true;
state.runStats.fallbackActions = 0;
state.taskGraph.tasks.forEach(task => { task.status = 'completed'; });
const timestamp = new Date().toISOString();
state.progressEvents.push(
  { id: 'proposal-final', sequence: state.progressEvents.length + 1, sessionId: state.sessionId, stepIndex: 1, kind: 'proposal', status: 'pass', summary: 'Structured patch proposed.', role: 'Editor', taskId: state.taskGraph.tasks[0]?.id, phase: 'PROPOSE', toolName: 'apply_patch', timestamp },
  { id: 'validation-final', sequence: state.progressEvents.length + 2, sessionId: state.sessionId, stepIndex: 1, kind: 'validation', status: 'pass', summary: 'Patch validated.', role: 'Editor', taskId: state.taskGraph.tasks[0]?.id, phase: 'VALIDATE', toolName: 'apply_patch', timestamp },
  { id: 'change-final', sequence: state.progressEvents.length + 3, sessionId: state.sessionId, stepIndex: 1, kind: 'tool_finished', status: 'pass', summary: 'Patch committed.', role: 'Editor', taskId: state.taskGraph.tasks[0]?.id, phase: 'COMMIT', toolName: 'apply_patch', timestamp }
);
state.progressEvents.push({
  id: 'oracle-final', sequence: state.progressEvents.length + 1, sessionId: state.sessionId,
  stepIndex: 1, kind: 'oracle', status: 'pass', summary: `Tests passed for ${pathCanary}`,
  detail: secretCanary, role: 'Reviewer', phase: 'NARRATE', toolName: 'run_tests', timestamp
});
state.evidenceLedger.push({ id: 'evidence-final', stepTitle: 'Final verification', command: `test ${pathCanary}`, observation: secretCanary, testResult: { pass: true, summary: 'All tests passed.' }, confidence: 100, timestamp });
state.diffReviews.push({ id: 'diff-final', reviewer: 'Reviewer', status: 'approved', summary: 'Bounded diff approved.', diffExcerpt: `diff --git a/${pathCanary} b/${pathCanary}`, timestamp });
state.reviewerCritiques.push({ id: 'review-final', reviewer: 'Reviewer', modelId: 'weak-reviewer', source: 'model', status: 'approved', summary: 'No blocking findings.', concerns: [], diffExcerpt: secretCanary, timestamp });

const graph = buildProofGraph(state);
assert.equal(verifyProofGraph(graph).valid, true);
assert.equal(graph.completeness.complete, true);
assert.equal(graph.completeness.claimsSuccess, true);
assert.equal(hasKindPath(graph, ['requirement', 'task', 'proposal', 'validation', 'change', 'oracle', 'diff', 'review', 'evidence', 'terminal']), true, 'proof graph must link requirements through governed work, review, evidence, and terminal truth');
assert.equal(proofGraphDigest(JSON.parse(JSON.stringify(graph))), graph.digest, 'graph digest must survive a JSON round trip');
const graphText = JSON.stringify(graph);
assert.equal(graphText.includes(secretCanary), false, 'proof graph must not expose source/prompt content');
assert.equal(graphText.includes(pathCanary), false, 'proof graph must not expose private paths');

class MemorySecrets {
  values = new Map();
  get(key) { return Promise.resolve(this.values.get(key)); }
  store(key, value) { this.values.set(key, value); return Promise.resolve(); }
  delete(key) { this.values.delete(key); return Promise.resolve(); }
}
const secrets = new MemorySecrets();
const service = new AttestationService(secrets, root, '0.96.0-test');
const attestation = await service.attest(state, graph);
assert.equal(verifyAttestation(attestation, graph).valid, true);
assert.equal(attestation.statement.claimsSuccess, true);
const persistedText = fs.readFileSync(path.join(root, '.forge', 'latest-attestation.json'), 'utf8');
assert.equal(persistedText.includes('PRIVATE KEY'), false, 'private signing key must not enter workspace artifacts');
assert.equal([...secrets.values.values()].some(value => value.includes('PRIVATE KEY')), true, 'private key must be held by SecretStorage');

for (const mutate of [
  value => { value.nodes[0].summary = 'tampered'; },
  value => { value.nodes[0].payloadDigest = '0'.repeat(64); },
  value => { value.terminalStatus = 'failed'; }
]) {
  const altered = structuredClone(graph);
  mutate(altered);
  assert.equal(verifyProofGraph(altered).valid, false, 'graph tampering must fail verification');
  assert.equal(verifyAttestation(attestation, altered).valid, false, 'attestation must reject a tampered graph');
}
for (const mutate of [
  value => { value.statement.terminalStatus = 'failed'; },
  value => { value.signatureBase64 = Buffer.from('tampered').toString('base64'); },
  value => { value.publicKeyPem = value.publicKeyPem.replace('A', 'B'); }
]) {
  const altered = structuredClone(attestation);
  mutate(altered);
  assert.equal(verifyAttestation(altered, graph).valid, false, 'attestation tampering must fail verification');
}

const firstKey = attestation.statement.keyId;
const rotated = await service.rotateKey();
assert.notEqual(rotated.keyId, firstKey);
assert.equal(verifyAttestation(attestation, graph).valid, true, 'embedded public key keeps old attestations verifiable');
const newAttestation = await service.attest(state, graph);
assert.equal(newAttestation.statement.keyId, rotated.keyId);

const redState = structuredClone(state);
redState.status = 'failed';
redState.lastOraclePass = false;
redState.evidenceLedger = [];
redState.progressEvents = redState.progressEvents.filter(event => event.kind !== 'oracle');
const redGraph = buildProofGraph(redState);
const redAttestation = await service.attest(redState, redGraph);
assert.equal(redGraph.completeness.complete, false);
assert.equal(redAttestation.statement.claimsSuccess, false, 'red or missing evidence must never be signed as success');
await assert.rejects(() => service.attest({ ...state, status: 'running' }, graph), /Only terminal/);
await assert.rejects(() => service.attest({ ...state, sessionId: 'stale-session' }, graph), /does not match/);
const forgedButSelfConsistent = structuredClone(graph);
forgedButSelfConsistent.completeness = { complete: false, missing: ['invented'], claimsSuccess: false };
forgedButSelfConsistent.digest = proofGraphDigest(forgedButSelfConsistent);
assert.equal(verifyProofGraph(forgedButSelfConsistent).valid, true, 'fixture must be internally self-consistent before signer provenance check');
await assert.rejects(() => service.attest(state, forgedButSelfConsistent), /not derived/, 'signer must rebuild the graph from terminal state before signing');

const auditedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-attestation-capability-'));
fs.writeFileSync(path.join(auditedRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
const auditedLoop = new AgentHarnessLoop(provider, auditedRoot, undefined, undefined, [], { signedAttestationAvailable: true });
const audited = await auditedLoop.initializeHarness('Compile audited authority without provider work.', {}, {}, { assuranceLevel: 'audited' });
assert.equal(audited.executionContract.availability.missing.includes('signed attestation'), false, 'extension-host signing capability must be advertised truthfully');
assert.equal(audited.executionContract.availability.available, false, 'calibration and proven isolation remain independent audited gates');

console.log(JSON.stringify({
  passed: true,
  graphNodes: graph.nodes.length,
  graphEdges: graph.edges.length,
  privacyCanariesAbsent: true,
  tamperCases: 6,
  privateKeyWorkspaceExposure: false,
  keyRotationVerified: true,
  falseSuccessBlocked: true,
  auditedStillFailsClosed: true
}, null, 2));

function hasKindPath(graph, kinds) {
  const kindById = new Map(graph.nodes.map(node => [node.id, node.kind]));
  const outgoing = new Map();
  for (const edge of graph.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
  const visit = (id, index, seen) => {
    if (kindById.get(id) !== kinds[index]) return false;
    if (index === kinds.length - 1) return true;
    return (outgoing.get(id) || []).some(next => !seen.has(next) && visit(next, index + 1, new Set([...seen, next])));
  };
  return graph.nodes.filter(node => node.kind === kinds[0]).some(node => visit(node.id, 0, new Set([node.id])));
}
