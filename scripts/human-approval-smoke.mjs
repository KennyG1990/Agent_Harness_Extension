import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';

function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2));
  fs.writeFileSync(path.join(root, 'test.js'), "const fs=require('fs'); if(fs.readFileSync('target.txt','utf8').trim()!=='after') process.exit(1);\n");
  fs.writeFileSync(path.join(root, 'target.txt'), 'before\n');
  return root;
}

function prepareEditor(state) {
  state.taskGraph.tasks = [{ id: 'edit', title: 'Change target', status: 'running', dependencies: [], blockers: [], owner: 'Editor' }];
  for (const stage of state.workflow.stages) {
    if (['classify', 'plan', 'baseline', 'reconcile', 'document_plan'].includes(stage.id)) stage.status = 'completed';
  }
  state.workflow.currentStage = 'implement';
  return state;
}

function writeProvider(counter) {
  return {
    id: 'approval-provider', modelId: 'weak-scripted',
    generateChat: async () => {
      counter.calls += 1;
      return { text: JSON.stringify({ explanation: 'Apply the requested bounded edit.', confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name: 'write_file', arguments: { path: 'target.txt', content: 'after\n' } } }) };
    }
  };
}

const askRoot = workspace('forge-human-approval-ask-');
const askCalls = { calls: 0 };
const askLoop = new AgentHarnessLoop(writeProvider(askCalls), askRoot);
let askState = prepareEditor(await askLoop.initializeHarness('Change target.', {}, {}, { humanApprovalPolicy: 'ask' }));
askState = await askLoop.runStep(askState);
assert.equal(askState.status, 'awaiting_approval');
assert.equal(fs.readFileSync(path.join(askRoot, 'target.txt'), 'utf8'), 'before\n', 'ask mode must not mutate before approval');
assert.equal(askState.safetyCheckpoints.length, 0, 'checkpoint creation belongs to COMMIT and must not run before approval');
assert.equal(askState.runStats.workerProcessExecutions, 0);
assert.equal(askCalls.calls, 1);
assert.equal(askState.pendingHumanApproval?.proposal.name, 'write_file');
const approvalId = askState.pendingHumanApproval.id;
await assert.rejects(() => askLoop.decideHumanApproval('approve', 'forged-id'), /does not match/);
askState = await askLoop.decideHumanApproval('approve', approvalId);
assert.equal(fs.readFileSync(path.join(askRoot, 'target.txt'), 'utf8'), 'after\n');
assert.equal(askCalls.calls, 1, 'approval must commit the persisted proposal without another provider call');
assert.equal(askState.runStats.humanApprovalApprovals, 1);
assert.equal(askState.humanApprovals[0].status, 'approved');
assert.ok(askState.safetyCheckpoints.length > 0);
assert.ok(fs.existsSync(path.join(askRoot, '.forge', 'human-approvals.json')));
await assert.rejects(() => askLoop.decideHumanApproval('approve', approvalId), /No pending/);

const rejectRoot = workspace('forge-human-approval-reject-');
const rejectCalls = { calls: 0 };
const rejectLoop = new AgentHarnessLoop(writeProvider(rejectCalls), rejectRoot);
let rejectState = prepareEditor(await rejectLoop.initializeHarness('Change target.', {}, {}, { humanApprovalPolicy: 'ask' }));
rejectState = await rejectLoop.runStep(rejectState);
const rejectedId = rejectState.pendingHumanApproval.id;
rejectState = await rejectLoop.decideHumanApproval('reject', rejectedId, 'Use a smaller patch.');
assert.equal(rejectState.status, 'idle');
assert.equal(fs.readFileSync(path.join(rejectRoot, 'target.txt'), 'utf8'), 'before\n');
assert.equal(rejectState.safetyCheckpoints.length, 0);
assert.equal(rejectState.humanApprovals[0].status, 'rejected');
assert.match(rejectState.scratchpadMd, /Do not repeat the rejected action unchanged/);
await assert.rejects(() => rejectLoop.decideHumanApproval('reject', rejectedId), /No pending/);

const tamperRoot = workspace('forge-human-approval-tamper-');
const tamperLoop = new AgentHarnessLoop(writeProvider({ calls: 0 }), tamperRoot);
let tamperState = prepareEditor(await tamperLoop.initializeHarness('Change target.', {}, {}, { humanApprovalPolicy: 'ask' }));
tamperState = await tamperLoop.runStep(tamperState);
tamperState.pendingHumanApproval.proposal.arguments.content = 'tampered\n';
await assert.rejects(() => tamperLoop.decideHumanApproval('approve', tamperState.pendingHumanApproval.id), /integrity validation/);
assert.equal(fs.readFileSync(path.join(tamperRoot, 'target.txt'), 'utf8'), 'before\n');

const autoRoot = workspace('forge-human-approval-auto-');
let autoCalls = 0;
const autoLoop = new AgentHarnessLoop({ id: 'bad-provider', modelId: 'weak-scripted', generateChat: async () => {
  autoCalls += 1;
  return { text: JSON.stringify({ explanation: 'Attempt path escape.', confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name: 'write_file', arguments: { path: '../escape.txt', content: 'bad' } } }) };
} }, autoRoot);
let autoState = prepareEditor(await autoLoop.initializeHarness('Attempt invalid edit.', {}, {}, { humanApprovalPolicy: 'auto' }));
autoState = await autoLoop.runStep(autoState);
assert.notEqual(autoState.status, 'awaiting_approval');
assert.equal(autoState.pendingHumanApproval, undefined);
assert.equal(fs.existsSync(path.join(autoRoot, '..', 'escape.txt')), false);
assert.match(String(autoState.firewall.validationReason), /outside workspace|escapes workspace|workspace/i);

const externalRoot = workspace('forge-human-approval-external-');
let externalCalls = 0;
const externalLoop = new AgentHarnessLoop({ id: 'external-provider', modelId: 'scripted', generateChat: async () => {
  externalCalls += 1;
  return { text: JSON.stringify({ explanation: 'Invoke one previously inspected desktop control.', confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name: 'computer_action', arguments: { stateId: 'computer-state-12345678', action: 'invoke', targetId: 'ct-0123456789abcdef' } } }) };
} }, externalRoot);
let externalState = await externalLoop.initializeHarness('Verify an allowlisted desktop application.', {}, {}, { humanApprovalPolicy: 'auto' });
externalState.taskGraph.tasks = [{ id: 'desktop-review', title: 'Desktop verification', status: 'running', dependencies: [], blockers: [], owner: 'Reviewer' }];
externalState = await externalLoop.runStep(externalState);
assert.equal(externalState.status, 'awaiting_approval', 'computer actions must require approval even under auto policy');
assert.equal(externalState.pendingHumanApproval?.proposal.name, 'computer_action');
assert.equal(externalState.runStats.workerProcessExecutions, 0);
assert.equal(externalCalls, 1);

console.log(JSON.stringify({ passed: true, askPausedBeforeCommit: true, exactProposalCommitted: true, rejectionNonMutating: true, tamperRejected: true, autoStillFirewalled: true, externalActionsAlwaysAsk: true, providerCallsOnApprove: askCalls.calls }, null, 2));
