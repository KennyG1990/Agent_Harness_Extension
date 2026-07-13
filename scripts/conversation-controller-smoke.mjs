import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationController } from '../out/harness/conversationController.js';
import { AgentHarnessLoop } from '../out/harness/loop.js';

const controller = new ConversationController();
const route = (message, overrides = {}) => controller.route({ message, modeIntent: 'code', ...overrides });

assert.equal(route('Explain how authentication works').route, 'answer');
assert.equal(route('Add password reset with expiring tokens').route, 'start_run');
assert.equal(route('/goal fix the failing test').route, 'start_run');
assert.equal(route('Add password reset', { modeIntent: 'ask' }).route, 'clarify_intent');
assert.equal(route('Add password reset', { modeIntent: 'ask' }).requiresModeChange, true);
assert.equal(route('What is the current status?', { runStatus: 'running' }).route, 'inspect_status');
assert.equal(route('Use PostgreSQL, not Redis', { runStatus: 'running' }).route, 'steer_run');
assert.equal(route('Continue', { runStatus: 'running' }).route, 'continue_run');
assert.equal(route('I have another thought', { runStatus: 'running' }).route, 'clarify_intent');
assert.equal(route('Explain the current approach', { runStatus: 'running' }).route, 'answer');
assert.equal(route('yes, use the existing migration framework', { runStatus: 'awaiting_input', pendingClarificationId: 'clarification-1' }).route, 'answer_clarification');
assert.deepEqual(route('Approve', { runStatus: 'awaiting_approval', pendingApprovalId: 'approval-1' }), {
  route: 'resolve_approval', approvalDecision: 'approve', reason: 'The message explicitly approves the active persisted proposal.'
});
assert.equal(route('Reject', { runStatus: 'awaiting_approval', pendingApprovalId: 'approval-1' }).approvalDecision, 'reject');
assert.equal(route('Change the patch', { runStatus: 'awaiting_approval', pendingApprovalId: 'approval-1' }).route, 'inspect_status');
assert.equal(route('Pause', { runStatus: 'running' }).route, 'pause');
assert.equal(route('Resume', { runStatus: 'paused' }).route, 'resume');
assert.equal(route('Cancel', { runStatus: 'running' }).route, 'cancel');
assert.equal(route('Fix another bug', { runStatus: 'success' }).route, 'start_run');
assert.equal(route('Looks useful').route, 'clarify_intent');
assert.equal(route('/research compare two libraries').route, 'research');

const envelope = proposal => JSON.stringify({
  explanation: `Perform ${proposal.name} through the governed causal fixture.`,
  confidence: 95,
  materialUncertainty: false,
  uncertainties: [],
  proposal
});

const createFixture = (prefix, passingAfterEdit = true) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2));
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = () => "broken";\n');
  fs.writeFileSync(path.join(root, 'test.js'), passingAfterEdit
    ? 'if(require("./app")() !== "fixed") process.exit(1); console.log("green");\n'
    : 'console.error("forced red oracle"); process.exit(1);\n');
  return root;
};

const prepareStage = (state, owner, stage, title) => {
  state.taskGraph.tasks = [{ id: `${stage}-task`, title, status: 'running', dependencies: [], blockers: [], owner }];
  const order = ['classify', 'plan', 'baseline', 'reconcile', 'document_plan', 'implement', 'verify', 'review', 'evidence', 'close'];
  for (const item of state.workflow.stages) {
    const position = order.indexOf(item.id);
    const current = order.indexOf(stage);
    item.status = position < current ? 'completed' : item.id === stage ? 'running' : 'pending';
  }
  state.workflow.currentStage = stage;
  return state;
};

const causalRoot = createFixture('forge-conversation-causal-');
const proposals = [
  { name: 'write_file', arguments: { path: 'app.js', content: 'module.exports = () => "fixed";\n' } },
  { name: 'run_tests', arguments: {} }
];
let providerCalls = 0;
const causalLoop = new AgentHarnessLoop({
  id: 'conversation-scripted',
  modelId: 'weak-scripted',
  generateChat: async () => ({ text: envelope(proposals[providerCalls++]) })
}, causalRoot, undefined);
const naturalRequest = 'Fix app.js so the existing test passes';
assert.equal(route(naturalRequest).route, 'start_run');
let causalState = await causalLoop.initializeHarness(naturalRequest, {}, {}, { humanApprovalPolicy: 'auto' });
const causalSessionId = causalState.sessionId;
prepareStage(causalState, 'Editor', 'implement', 'Repair the failing implementation');
causalState = await causalLoop.runStep(causalState, { code: 'weak-scripted' });
assert.equal(fs.readFileSync(path.join(causalRoot, 'app.js'), 'utf8'), 'module.exports = () => "fixed";\n');
prepareStage(causalState, 'Reviewer', 'verify', 'Run the project test oracle');
causalState = await causalLoop.runStep(causalState, { review: 'weak-scripted' });
assert.equal(causalState.sessionId, causalSessionId, 'the natural request and green oracle must share one run identity');
assert.equal(causalState.lastOraclePass, true);
assert.ok(causalState.evidenceLedger.some(item => item.testResult?.pass === true), 'same-run green evidence must be persisted');
assert.equal(providerCalls, 1, 'the deterministic Reviewer gate must inspect the diff without spending a second provider call');
assert.ok(causalState.diffReviews.length > 0, 'the same run must persist deterministic diff-review evidence');

const advisoryBefore = fs.readFileSync(path.join(causalRoot, 'app.js'), 'utf8');
assert.equal(route('Explain what app.js exports').route, 'answer');
assert.equal(fs.readFileSync(path.join(causalRoot, 'app.js'), 'utf8'), advisoryBefore, 'the read-only route must not mutate the fixture');

const redRoot = createFixture('forge-conversation-red-', false);
const redLoop = new AgentHarnessLoop({ id: 'red-scripted', modelId: 'weak-scripted', generateChat: async () => ({ text: envelope({ name: 'run_tests', arguments: {} }) }) }, redRoot, undefined);
let redState = await redLoop.initializeHarness('Fix the project and prove it with tests.', {}, {}, { humanApprovalPolicy: 'auto' });
prepareStage(redState, 'Reviewer', 'verify', 'Run the forced red oracle');
redState = await redLoop.runStep(redState, { review: 'weak-scripted' });
assert.equal(redState.lastOraclePass, false);
assert.notEqual(redState.status, 'success', 'a red oracle must never become conversational success');

const cancelRoot = createFixture('forge-conversation-cancel-');
const cancelLoop = new AgentHarnessLoop({ id: 'unused', modelId: 'unused', generateChat: async () => { throw new Error('provider must not be called'); } }, cancelRoot, undefined);
let cancelState = await cancelLoop.initializeHarness('Create a feature, then cancel it.');
cancelState = cancelLoop.cancelRun('Cancelled by conversation fixture.');
assert.equal(cancelState.status, 'gave_up');
assert.match(cancelState.haltReason, /Cancelled by conversation fixture/);
assert.throws(() => cancelLoop.cancelRun(), /terminal Forge run/);

const boundaryCancelRoot = createFixture('forge-conversation-boundary-cancel-');
let boundaryProviderCalls = 0;
const boundaryCancelLoop = new AgentHarnessLoop({ id: 'must-not-run', modelId: 'unused', generateChat: async () => { boundaryProviderCalls += 1; throw new Error('provider must not be called'); } }, boundaryCancelRoot, undefined);
let boundaryCancelState = await boundaryCancelLoop.initializeHarness('Cancel before the next provider action.');
fs.writeFileSync(path.join(boundaryCancelRoot, '.forge', 'control.json'), JSON.stringify({ cancelRequested: true, requestedAt: new Date().toISOString() }, null, 2));
boundaryCancelState = await boundaryCancelLoop.runStep(boundaryCancelState);
assert.equal(boundaryCancelState.status, 'gave_up');
assert.equal(boundaryProviderCalls, 0, 'boundary cancellation must halt before another provider call');

console.log(JSON.stringify({
  passed: true,
  deterministicRoutes: true,
  modeCeiling: true,
  pendingGatePrecedence: true,
  causalHarnessMutation: true,
  sameRunGreenEvidence: true,
  advisoryNonMutating: true,
  redOracleNoSuccess: true,
  terminalCancellation: true,
  boundaryCancellation: true,
  causalSessionId,
  causalRoot,
  redRoot
}, null, 2));
