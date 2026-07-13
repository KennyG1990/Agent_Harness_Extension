import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';
import { PersistentSubAgentCoordinator } from '../out/harness/subAgentCoordinator.js';

const roots = [];
const fixture = (passing = false) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-subagent-smoke-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'value.js'), `export const value = ${passing ? 2 : 1};\n`);
  fs.writeFileSync(path.join(root, 'test.mjs'), `import assert from 'node:assert/strict';\nimport { value } from './src/value.js';\nassert.equal(value, 2);\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node test.mjs' } }, null, 2));
  return root;
};

const editorTask = { id: 'edit-1', title: 'Change value to two', owner: 'Editor', status: 'running', dependencies: [], blockers: [] };
const reviewerTask = { id: 'review-1', title: 'Review staged value change', owner: 'Reviewer', status: 'running', dependencies: ['edit-1'], blockers: [] };
const editorTools = ['repo_search', 'read_file', 'apply_patch', 'write_file', 'run_tests', 'ask_user'];
const reviewerTools = ['run_tests', 'get_diff', 'record_evidence', 'declare_success', 'ask_user'];
const patchProposal = { name: 'apply_patch', arguments: { path: 'src/value.js', patchContent: '<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = 2;\n>>>>>>> REPLACE' } };

async function directCoordinatorProof() {
  const root = fixture();
  const coordinator = new PersistentSubAgentCoordinator(root);
  const topology = coordinator.initialize('direct-run');
  const editor = coordinator.ensureWorker(topology, editorTask, 'weak-editor', editorTools);
  coordinator.recordProvider(editor, 'weak-editor', { promptTokens: 10, completionTokens: 2, totalCost: 0.00001 }, 5);
  assert.throws(() => coordinator.ensureWorker(topology, editorTask, 'different-model', editorTools), /change model routing/);
  assert.throws(() => coordinator.ensureWorker(topology, editorTask, 'weak-editor', [...editorTools, 'run_command']), /tool ceiling/);
  assert.throws(() => coordinator.ensureWorker(topology, editorTask, 'weak-editor', editorTools, /** @type {any} */ ('worker')), /cannot spawn/);
  const before = fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8');
  const staged = await coordinator.stageNativeMutation(topology, editor, patchProposal);
  assert.equal(staged.success, true, staged.output);
  assert.equal(staged.stage?.stagedOracleGreen, true);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), before, 'active workspace changed before review');
  assert.match(staged.diff, /value = 2/);
  const reviewer = coordinator.ensureWorker(topology, reviewerTask, 'reviewer-model', reviewerTools);
  const blocked = coordinator.mergeApproved(topology, editor, reviewer, 'blocked');
  assert.equal(blocked.status, 'blocked');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), before);
  coordinator.abandonStage(editor, 'blocked');

  const retry = await coordinator.stageNativeMutation(topology, editor, patchProposal);
  assert.equal(retry.success, true, retry.output);
  const merged = coordinator.mergeApproved(topology, editor, reviewer, 'approved');
  assert.equal(merged.status, 'merged', merged.error);
  assert.match(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), /value = 2/);
  assert.equal(merged.cleanupSucceeded, true);
  coordinator.persist(topology);
  assert.ok(fs.existsSync(path.join(root, '.forge', 'subagent-topology.json')));
  return { topology, merged };
}

async function redOracleAndConflictProof() {
  const redRoot = fixture();
  const redCoordinator = new PersistentSubAgentCoordinator(redRoot);
  const redTopology = redCoordinator.initialize('red-run');
  const redWorker = redCoordinator.ensureWorker(redTopology, editorTask, 'weak-editor', editorTools);
  const redProposal = { name: 'write_file', arguments: { path: 'src/value.js', content: 'export const value = 3;\n' } };
  const red = await redCoordinator.stageNativeMutation(redTopology, redWorker, redProposal);
  assert.equal(red.success, false);
  assert.equal(red.stage?.stagedOracleGreen, false);
  assert.match(fs.readFileSync(path.join(redRoot, 'src', 'value.js'), 'utf8'), /value = 1/);
  await redCoordinator.stageNativeMutation(redTopology, redWorker, redProposal);
  await redCoordinator.stageNativeMutation(redTopology, redWorker, redProposal);
  await assert.rejects(() => redCoordinator.stageNativeMutation(redTopology, redWorker, redProposal), /retry cap exceeded/);
  redCoordinator.abandonStage(redWorker, 'blocked');

  const conflictRoot = fixture();
  const conflictCoordinator = new PersistentSubAgentCoordinator(conflictRoot);
  const conflictTopology = conflictCoordinator.initialize('conflict-run');
  const conflictWorker = conflictCoordinator.ensureWorker(conflictTopology, editorTask, 'weak-editor', editorTools);
  const staged = await conflictCoordinator.stageNativeMutation(conflictTopology, conflictWorker, patchProposal);
  assert.equal(staged.success, true, staged.output);
  fs.writeFileSync(path.join(conflictRoot, 'src', 'value.js'), 'export const value = 99;\n');
  const reviewer = conflictCoordinator.ensureWorker(conflictTopology, reviewerTask, 'reviewer-model', reviewerTools);
  const conflict = conflictCoordinator.mergeApproved(conflictTopology, conflictWorker, reviewer, 'approved');
  assert.equal(conflict.status, 'conflict');
  assert.match(fs.readFileSync(path.join(conflictRoot, 'src', 'value.js'), 'utf8'), /99/);
  conflictCoordinator.abandonStage(conflictWorker, 'blocked');
  return { red, conflict };
}

async function cumulativeMultiFileProof() {
  const createRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-subagent-multifile-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'b.js'), 'export const b = 1;\n');
    fs.writeFileSync(path.join(root, 'test.mjs'), "import assert from 'node:assert/strict';\nimport { a } from './src/a.js';\nimport { b } from './src/b.js';\nassert.equal(a + b, 4);\n");
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node test.mjs' } }, null, 2));
    return root;
  };
  const first = { name: 'write_file', arguments: { path: 'src/a.js', content: 'export const a = 2;\n' } };
  const second = { name: 'write_file', arguments: { path: 'src/b.js', content: 'export const b = 2;\n' } };

  const root = createRoot();
  const coordinator = new PersistentSubAgentCoordinator(root);
  const topology = coordinator.initialize('multifile-run');
  const editor = coordinator.ensureWorker(topology, { ...editorTask, id: 'edit-multifile' }, 'weak-editor', editorTools);
  const red = await coordinator.stageNativeMutation(topology, editor, first);
  assert.equal(red.success, false, 'first half of the repair must remain staged while tests are red');
  const retainedRoot = red.stage?.isolatedRoot;
  assert.ok(retainedRoot && fs.existsSync(retainedRoot), 'red intermediate staging root must be retained');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), 'export const a = 1;\n');
  const escalation = coordinator.ensureWorker(topology, { ...editorTask, id: 'edit-multifile', owner: 'Escalation', title: 'Escalate cumulative multi-file repair' }, 'strong-escalation', editorTools);
  coordinator.transferStage(topology, editor, escalation);
  assert.equal(editor.staging, undefined, 'Editor must relinquish staging ownership after escalation');
  const green = await coordinator.stageNativeMutation(topology, escalation, second);
  assert.equal(green.success, true, green.output);
  assert.equal(green.stage?.isolatedRoot, retainedRoot, 'later repairs must reuse the same staging root');
  assert.deepEqual(green.stage?.changedFiles, ['src/a.js', 'src/b.js']);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'b.js'), 'utf8'), 'export const b = 1;\n');
  const reviewer = coordinator.ensureWorker(topology, { ...reviewerTask, id: 'review-multifile' }, 'reviewer-model', reviewerTools);
  const merged = coordinator.mergeApproved(topology, escalation, reviewer, 'approved');
  assert.equal(merged.status, 'merged', merged.error);
  assert.equal(merged.changedFiles.length, 2);

  const rollbackRoot = createRoot();
  const rollbackCoordinator = new PersistentSubAgentCoordinator(rollbackRoot, undefined, (stagedPath, targetPath, index) => {
    if (index === 1) throw new Error('injected second-file merge failure');
    fs.copyFileSync(stagedPath, targetPath);
  });
  const rollbackTopology = rollbackCoordinator.initialize('multifile-rollback-run');
  const rollbackEditor = rollbackCoordinator.ensureWorker(rollbackTopology, { ...editorTask, id: 'edit-multifile-rollback' }, 'weak-editor', editorTools);
  await rollbackCoordinator.stageNativeMutation(rollbackTopology, rollbackEditor, first);
  const rollbackGreen = await rollbackCoordinator.stageNativeMutation(rollbackTopology, rollbackEditor, second);
  assert.equal(rollbackGreen.success, true, rollbackGreen.output);
  const rollbackReviewer = rollbackCoordinator.ensureWorker(rollbackTopology, { ...reviewerTask, id: 'review-multifile-rollback' }, 'reviewer-model', reviewerTools);
  const failed = rollbackCoordinator.mergeApproved(rollbackTopology, rollbackEditor, rollbackReviewer, 'approved');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rollbackSucceeded, true);
  assert.equal(fs.readFileSync(path.join(rollbackRoot, 'src', 'a.js'), 'utf8'), 'export const a = 1;\n');
  assert.equal(fs.readFileSync(path.join(rollbackRoot, 'src', 'b.js'), 'utf8'), 'export const b = 1;\n');
  return { retained: green.stage?.isolatedRoot === retainedRoot, changedFiles: merged.changedFiles.length, rollback: failed.rollbackSucceeded };
}

async function rollbackAndResumeProof() {
  const root = fixture();
  const coordinator = new PersistentSubAgentCoordinator(root, undefined, () => { throw new Error('injected merge failure'); });
  const topology = coordinator.initialize('rollback-run');
  const worker = coordinator.ensureWorker(topology, editorTask, 'weak-editor', editorTools);
  const staged = await coordinator.stageNativeMutation(topology, worker, patchProposal);
  assert.equal(staged.success, true, staged.output);
  const reviewer = coordinator.ensureWorker(topology, reviewerTask, 'reviewer-model', reviewerTools);
  const merge = coordinator.mergeApproved(topology, worker, reviewer, 'approved');
  assert.equal(merge.status, 'failed');
  assert.equal(merge.rollbackAttempted, true);
  assert.equal(merge.rollbackSucceeded, true);
  assert.match(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), /value = 1/);

  const missingRoot = fixture();
  const missingCoordinator = new PersistentSubAgentCoordinator(missingRoot);
  const missingTopology = missingCoordinator.initialize('resume-run');
  const missingWorker = missingCoordinator.ensureWorker(missingTopology, editorTask, 'weak-editor', editorTools);
  const pending = await missingCoordinator.stageNativeMutation(missingTopology, missingWorker, patchProposal);
  assert.equal(pending.success, true);
  fs.rmSync(pending.stage.tempParent, { recursive: true, force: true });
  const normalized = missingCoordinator.normalize(missingTopology, 'resume-run');
  assert.equal(normalized.workers[0].status, 'abandoned');

  const expiredRoot = fixture();
  const expiredCoordinator = new PersistentSubAgentCoordinator(expiredRoot);
  const expiredTopology = expiredCoordinator.initialize('expired-run');
  const expiredWorker = expiredCoordinator.ensureWorker(expiredTopology, editorTask, 'weak-editor', editorTools);
  const expiring = await expiredCoordinator.stageNativeMutation(expiredTopology, expiredWorker, patchProposal);
  expiredWorker.expiresAt = new Date(0).toISOString();
  expiredCoordinator.normalize(expiredTopology, 'expired-run');
  assert.equal(expiredWorker.status, 'abandoned');
  assert.equal(fs.existsSync(expiring.stage.tempParent), false, 'expired staging roots must be cleaned deterministically');
  return { merge, resumedStatus: normalized.workers[0].status, expiredStatus: expiredWorker.status };
}

class ScriptedProvider {
  calls = [];
  activeBytesDuringReview = '';
  constructor(root) { this.root = root; }
  capabilities() { return { structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }; }
  async listModels() { return []; }
  async generateChat(options) {
    this.calls.push({ sessionId: options.sessionId, modelId: options.modelId, messages: options.messages });
    const system = options.messages[0]?.content || '';
    const usage = { promptTokens: 100, completionTokens: 20, totalCost: options.modelId === 'strong-architect' ? 0.002 : 0.0001 };
    if (/Pre-Commit Reviewer/.test(system)) return { text: JSON.stringify({ status: 'approved', summary: 'Proposal is scoped.', concerns: [] }), usage };
    if (/staged-diff Reviewer/.test(system)) {
      this.activeBytesDuringReview = fs.readFileSync(path.join(this.root, 'src', 'value.js'), 'utf8');
      return { text: JSON.stringify({ status: 'approved', summary: 'Staged diff is correct and staged tests are green.', concerns: [] }), usage };
    }
    if (options.sessionId.includes(':subagent:explorer:')) return { text: envelope('repo_search', { query: 'value' }), usage };
    if (options.sessionId.includes(':subagent:architect:')) return { text: envelope('update_plan', { planMd: '# PLAN.md\n\n## Premise Checks\n- test expects two\n\n## Focus Files\n- src/value.js\n\n## Ordered Steps\n- Change value from one to two.\n' }), usage };
    if (options.sessionId.includes(':subagent:editor:')) return { text: envelope('apply_patch', patchProposal.arguments), usage };
    return { text: envelope('run_tests', {}), usage };
  }
}

const envelope = (name, args) => JSON.stringify({ explanation: `propose ${name}`, confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name, arguments: args } });

async function realLoopProof() {
  const root = fixture();
  const provider = new ScriptedProvider(root);
  const loop = new AgentHarnessLoop(provider, root, undefined);
  const bindings = { Explorer: 'weak-reader', Architect: 'strong-architect', Editor: 'weak-editor', Reviewer: 'reviewer-model' };
  let state = await loop.initializeHarness('Fix src/value.js so all tests pass.', bindings, {}, { humanApprovalPolicy: 'auto' });
  state.scratchpadMd += '\nRAW_SCRATCHPAD_SENTINEL_DO_NOT_LEAK\n';
  state.logs.push({ id: 'leak', type: 'warning', message: 'RAW_COORDINATOR_LOG_SENTINEL_DO_NOT_LEAK', subAgent: 'Orchestrator', timestamp: new Date().toISOString() });
  for (let i = 0; i < 12 && !['success', 'failed', 'gave_up'].includes(state.status); i += 1) state = await loop.runStep(state, bindings);
  assert.equal(state.status, 'success', state.haltReason);
  assert.match(provider.activeBytesDuringReview, /value = 1/, 'active workspace mutated before independent staged review');
  assert.match(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), /value = 2/);
  const editorCall = provider.calls.find(call => call.sessionId.includes(':subagent:editor:'));
  assert.ok(editorCall);
  const editorPrompt = editorCall.messages[0].content;
  assert.match(editorPrompt, /Host-owned sub-agent assignment/);
  assert.match(editorPrompt, /Exact model: weak-editor/);
  assert.match(editorPrompt, /Committed architect execution plan/);
  assert.doesNotMatch(editorPrompt, /RAW_SCRATCHPAD_SENTINEL_DO_NOT_LEAK/);
  assert.doesNotMatch(editorPrompt, /RAW_COORDINATOR_LOG_SENTINEL_DO_NOT_LEAK/);
  const workers = state.subAgentTopology.workers;
  assert.ok(workers.some(worker => worker.role === 'Architect' && worker.modelId === 'strong-architect'));
  assert.ok(workers.some(worker => worker.role === 'Editor' && worker.modelId === 'weak-editor'));
  assert.ok(workers.some(worker => worker.role === 'Reviewer' && worker.modelId === 'reviewer-model'));
  assert.equal(new Set(workers.map(worker => worker.sessionId)).size, workers.length);
  assert.equal(state.runStats.subAgentMerges, 1);
  assert.equal(state.subAgentTopology.merges.at(-1)?.status, 'merged');
  assert.equal(state.subAgentTopology.handoffs.every(item => item.rawTranscriptIncluded === false), true);
  assert.equal(state.evidenceLedger.some(item => item.testResult?.pass), true);
  return { state, calls: provider.calls.length, activeBytesDuringReview: provider.activeBytesDuringReview.trim() };
}

try {
  const direct = await directCoordinatorProof();
  const negatives = await redOracleAndConflictProof();
  const cumulative = await cumulativeMultiFileProof();
  const recovery = await rollbackAndResumeProof();
  const product = await realLoopProof();
  console.log(JSON.stringify({
    pass: true,
    direct: { workers: direct.topology.workers.length, handoffs: direct.topology.handoffs.length, merge: direct.merged.status },
    negatives: { redOracleGreen: negatives.red.stage?.stagedOracleGreen, conflict: negatives.conflict.status },
    cumulative,
    recovery: { rollback: recovery.merge.rollbackSucceeded, resume: recovery.resumedStatus },
    product: { status: product.state.status, providerCalls: product.state.runStats.providerCalls, topologyWorkers: product.state.subAgentTopology.workers.length, merges: product.state.runStats.subAgentMerges, activeBytesDuringReview: product.activeBytesDuringReview }
  }, null, 2));
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
