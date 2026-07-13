import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';

const makeWorkspace = prefix => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\'tests green\')"' } }, null, 2));
  fs.writeFileSync(path.join(root, 'target.txt'), 'stream fixture\n');
  return root;
};
const envelope = proposal => JSON.stringify({ explanation: `Propose ${proposal.name} for the causal stream fixture.`, confidence: 95, materialUncertainty: false, uncertainties: [], proposal });
const prepare = (state, role, title, stage) => {
  state.taskGraph.tasks = [{ id: `${role.toLowerCase()}-task`, title, status: 'running', dependencies: [], blockers: [], owner: role }];
  for (const item of state.workflow.stages) item.status = item.id === stage ? 'running' : stageOrder(item.id) < stageOrder(stage) ? 'completed' : 'pending';
  state.workflow.currentStage = stage;
  return state;
};
const stageOrder = id => ['classify', 'plan', 'baseline', 'reconcile', 'document_plan', 'implement', 'verify', 'review', 'evidence', 'close'].indexOf(id);
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for streamed event.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const root = makeWorkspace('forge-progress-stream-');
let releaseProvider;
const providerGate = new Promise(resolve => { releaseProvider = resolve; });
const provider = {
  capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
  listModels: async () => [],
  generateChat: async () => {
    await providerGate;
    return { text: envelope({ name: 'read_file', arguments: { path: 'target.txt' } }) };
  }
};
const events = [];
const loop = new AgentHarnessLoop(provider, root, undefined);
loop.setProgressListener(event => events.push(event));
let state = await loop.initializeHarness('Prove ordered progress before a delayed model returns.');
prepare(state, 'Editor', 'Read the fixture through the governed tool path', 'implement');
let resolved = false;
const stepPromise = loop.runStep(state, { code: 'delayed-scripted-model' }).then(value => { resolved = true; return value; });
await waitFor(() => events.some(event => event.kind === 'provider_wait'));
assert.equal(resolved, false, 'provider_wait must arrive before the delayed runStep resolves.');
releaseProvider();
state = await stepPromise;
for (const kind of ['step_started', 'provider_wait', 'proposal', 'validation', 'tool_started', 'tool_finished']) {
  assert.ok(events.some(event => event.kind === kind), `stream must include ${kind}`);
}
const orderedKinds = events.map(event => event.kind);
for (const [before, after] of [['provider_wait', 'proposal'], ['proposal', 'validation'], ['validation', 'tool_started'], ['tool_started', 'tool_finished']]) {
  assert.ok(orderedKinds.indexOf(before) < orderedKinds.indexOf(after), `${before} must precede ${after}`);
}
assert.deepEqual(events.map(event => event.sequence), [...events.map(event => event.sequence)].sort((a, b) => a - b));

const oracleRoot = makeWorkspace('forge-progress-oracle-');
const oracleEvents = [];
const oracleLoop = new AgentHarnessLoop({ ...provider, generateChat: async () => ({ text: envelope({ name: 'run_tests', arguments: {} }) }) }, oracleRoot, undefined);
oracleLoop.setProgressListener(event => oracleEvents.push(event));
let oracleState = await oracleLoop.initializeHarness('Stream the real green project oracle.');
prepare(oracleState, 'Reviewer', 'Verification oracle', 'verify');
oracleState = await oracleLoop.runStep(oracleState, { review: 'scripted-reviewer' });
assert.ok(oracleEvents.some(event => event.kind === 'oracle' && event.status === 'pass'));
assert.equal(oracleState.lastOraclePass, true);

const rejectionRoot = makeWorkspace('forge-progress-reject-');
const rejectionEvents = [];
const rejectionLoop = new AgentHarnessLoop({ ...provider, generateChat: async () => ({ text: envelope({ name: 'browser_validate', arguments: { url: 'https://example.com' } }) }) }, rejectionRoot, undefined);
rejectionLoop.setProgressListener(event => rejectionEvents.push(event));
let rejectionState = await rejectionLoop.initializeHarness('Reject remote browser authority visibly.');
prepare(rejectionState, 'Reviewer', 'Verification browser policy', 'verify');
rejectionState = await rejectionLoop.runStep(rejectionState, { review: 'scripted-reviewer' });
assert.ok(rejectionEvents.some(event => event.kind === 'validation' && event.status === 'fail'));
assert.ok(rejectionEvents.some(event => event.kind === 'reflection'));
assert.equal(rejectionEvents.some(event => event.kind === 'tool_started'), false, 'rejected proposals must never claim tool execution.');

const askRoot = makeWorkspace('forge-progress-ask-');
const askEvents = [];
const askLoop = new AgentHarnessLoop({ ...provider, generateChat: async () => ({ text: envelope({ name: 'ask_user', arguments: { question: 'Which API contract should be preserved?', uncertainty: 'Two incompatible contracts exist.', options: ['v1', 'v2'], recommendedAnswer: 'v2' } }) }) }, askRoot, undefined);
askLoop.setProgressListener(event => askEvents.push(event));
let askState = await askLoop.initializeHarness('Ask when material ambiguity blocks work.');
prepare(askState, 'Architect', 'Resolve contract ambiguity', 'plan');
askState = await askLoop.runStep(askState, { plan: 'scripted-architect' });
assert.equal(askState.status, 'awaiting_input');
assert.ok(askEvents.some(event => event.kind === 'awaiting_input' && event.status === 'warning'));

const persisted = fs.readFileSync(path.join(root, '.forge', 'progress-events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(new Set(persisted.map(event => event.id)).size, persisted.length, 'persisted event IDs must be unique.');
assert.deepEqual(persisted.map(event => event.sequence), [...persisted.map(event => event.sequence)].sort((a, b) => a - b));
console.log(JSON.stringify({ passed: true, delayedEventCount: events.length, oracleEventCount: oracleEvents.length, rejectedEventCount: rejectionEvents.length, askEventCount: askEvents.length, persistedPath: path.join(root, '.forge', 'progress-events.jsonl') }, null, 2));
