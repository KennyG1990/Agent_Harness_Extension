import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';
import { BackgroundSessionManager } from '../out/harness/backgroundSessionManager.js';
import { runBackgroundSession } from '../out/harness/backgroundRunner.js';
import { cleanupIsolatedWorkspace } from '../out/harness/isolation.js';

const roots = [];
const bindings = { Explorer: 'weak-reader', Architect: 'strong-architect', Editor: 'qwen-9b-fixture', Reviewer: 'reviewer-model' };

function fixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'value.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'test.mjs'), "import assert from 'node:assert/strict';\nimport { value } from './src/value.js';\nassert.equal(value, 2);\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node test.mjs' } }, null, 2));
  return root;
}

function envelope(name, args) {
  return JSON.stringify({ explanation: `Fixture proposes ${name}.`, confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name, arguments: args } });
}

function initializerProvider() {
  return { capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }), listModels: async () => [], generateChat: async () => ({ text: envelope('repo_search', { query: 'value' }) }) };
}

function approvalProvider() {
  return {
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async options => {
      const system = String(options.messages[0]?.content || '');
      if (/Reviewer/.test(system)) return { text: JSON.stringify({ status: 'approved', summary: 'Host fixture reviewer approved the exact staged diff.', concerns: [] }) };
      return { text: envelope('repo_search', { query: 'value' }) };
    }
  };
}

async function initialState(root, humanApprovalPolicy = 'auto') {
  const loop = new AgentHarnessLoop(initializerProvider(), root, undefined);
  const state = await loop.initializeHarness('Fix src/value.js so the existing test passes.', bindings, {}, { humanApprovalPolicy });
  assert.equal(state.executionContract.status, 'confirmed');
  return state;
}

function writeDetachedHelpers(root, askFirst = false) {
  const runnerModule = path.resolve('out/harness/backgroundRunner.js');
  const worker = path.join(root, 'fixture-worker.cjs');
  const launcher = path.join(root, 'fixture-launcher.cjs');
  fs.writeFileSync(worker, `
const fs = require('node:fs');
const path = require('node:path');
const { runBackgroundSession } = require(${JSON.stringify(runnerModule)});
const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const askFirst = ${askFirst ? 'true' : 'false'};
const askMarker = path.join(manifest.isolatedRoot, '.forge', 'fixture-asked');
const patch = '<<<<<<< SEARCH\\nexport const value = 1;\\n=======\\nexport const value = 2;\\n>>>>>>> REPLACE';
const envelope = (name, args) => JSON.stringify({ explanation: 'fixture ' + name, confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name, arguments: args } });
let first = true;
const provider = {
  capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
  listModels: async () => [],
  generateChat: async options => {
    if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 700)); }
    if (askFirst && !fs.existsSync(askMarker)) {
      fs.writeFileSync(askMarker, 'asked');
      return { text: envelope('ask_user', { question: 'Should the fixture change value to two?', uncertainty: 'The requested target needs confirmation.', options: ['Yes', 'No'], recommendedAnswer: 'Yes' }) };
    }
    const system = String(options.messages[0]?.content || '');
    if (/Pre-Commit Reviewer/.test(system) || /staged-diff Reviewer/.test(system) || /Forge Reviewer/.test(system)) return { text: JSON.stringify({ status: 'approved', summary: 'Scoped fixture change is correct.', concerns: [] }), usage: { promptTokens: 10, completionTokens: 4, totalCost: 0 } };
    if (options.sessionId.includes(':subagent:explorer:')) return { text: envelope('repo_search', { query: 'value' }) };
    if (options.sessionId.includes(':subagent:architect:')) return { text: envelope('update_plan', { planMd: '# PLAN.md\\n\\n## Focus Files\\n- src/value.js\\n\\n## Steps\\n- Change one to two.\\n- Run tests.\\n' }) };
    if (options.sessionId.includes(':subagent:editor:')) return { text: envelope('apply_patch', { path: 'src/value.js', patchContent: patch }) };
    return { text: envelope('run_tests', {}) };
  }
};
runBackgroundSession(manifestPath, provider).then(() => process.exit(0)).catch(error => { fs.appendFileSync(manifest.logPath, String(error.stack || error) + '\\n'); process.exit(1); });
`, 'utf8');
  fs.writeFileSync(launcher, `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
process.stdout.write(String(child.pid));
`, 'utf8');
  return { worker, launcher };
}

function detachedLauncher(helpers, observations) {
  return async request => {
    const launched = spawnSync(process.execPath, [helpers.launcher, helpers.worker, request.manifestPath], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(launched.status, 0, launched.stderr);
    observations.launcherExited = true;
    const pid = Number(String(launched.stdout).trim());
    assert.ok(Number.isInteger(pid) && pid > 0);
    return { pid };
  };
}

async function waitFor(manager, sessionId, statuses, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = manager.store.load(sessionId);
    if (statuses.includes(session.status)) return session;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${statuses.join(', ')}`);
}

function prepared(session) {
  return { sourceRoot: session.sourceRoot, isolatedRoot: session.isolatedRoot, tempParent: session.tempParent, requestedMode: session.isolationMode, mode: session.isolationMode, fallbackReason: session.isolationFallbackReason, baseCommit: session.baseCommit, dirtyFilesOverlaid: [] };
}

async function greenMergeProof() {
  const root = fixture('forge-background-green-');
  const observations = { launcherExited: false };
  const helpers = writeDetachedHelpers(root);
  const manager = new BackgroundSessionManager(root, detachedLauncher(helpers, observations));
  const state = await initialState(root);
  const session = await manager.start(state, 'copy');
  await assert.rejects(() => manager.start(state, 'copy'), /already leased/);
  const terminal = await waitFor(manager, session.sessionId, ['awaiting_review', 'failed', 'gave_up']);
  assert.equal(terminal.status, 'awaiting_review', terminal.error);
  assert.equal(observations.launcherExited, true);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n', 'source changed before merge');
  assert.ok(terminal.changedFiles.includes('src/value.js'));
  for (const artifact of ['PLAN.md', 'SCRATCHPAD.md', 'todos.json', 'evidence_ledger.json']) assert.ok(terminal.changedFiles.includes(artifact), `missing governed artifact ${artifact}`);
  const copies = manager.reviewCopies(session.sessionId);
  assert.ok(copies.some(item => item.path === 'src/value.js'));
  const reviewed = manager.approveReview(session.sessionId);
  assert.match(reviewed.merge.reviewDigest, /^[a-f0-9]{64}$/);
  const result = await manager.merge(session.sessionId);
  assert.equal(result.merged, true, result.oracle.summary);
  assert.equal(result.oracle.pass, true);
  assert.match(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), /value = 2/);
  cleanupIsolatedWorkspace(prepared(manager.store.load(session.sessionId)));
  return { launcherExited: observations.launcherExited, changedFiles: result.changedFiles, oracle: result.oracle.summary };
}

async function rollbackProof() {
  const root = fixture('forge-background-rollback-');
  const observations = { launcherExited: false };
  const helpers = writeDetachedHelpers(root);
  const manager = new BackgroundSessionManager(root, detachedLauncher(helpers, observations));
  const state = await initialState(root);
  const session = await manager.start(state, 'copy');
  const terminal = await waitFor(manager, session.sessionId, ['awaiting_review', 'failed', 'gave_up']);
  assert.equal(terminal.status, 'awaiting_review', terminal.error);
  manager.reviewCopies(session.sessionId);
  manager.approveReview(session.sessionId);
  fs.writeFileSync(path.join(root, 'test.mjs'), 'console.error("concurrent red source oracle"); process.exit(1);\n');
  const result = await manager.merge(session.sessionId);
  assert.equal(result.merged, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.oracle.pass, false);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n', 'red merge did not roll back source bytes');
  cleanupIsolatedWorkspace(prepared(manager.store.load(session.sessionId)));
  return { rolledBack: result.rolledBack, oracle: result.oracle.summary };
}

async function reviewTamperProof() {
  const root = fixture('forge-background-tamper-');
  const observations = { launcherExited: false };
  const helpers = writeDetachedHelpers(root);
  const manager = new BackgroundSessionManager(root, detachedLauncher(helpers, observations));
  const state = await initialState(root);
  const session = await manager.start(state, 'copy');
  const terminal = await waitFor(manager, session.sessionId, ['awaiting_review', 'failed', 'gave_up']);
  assert.equal(terminal.status, 'awaiting_review', terminal.error);
  await assert.rejects(async () => manager.approveReview(session.sessionId), /Open the current background diff/);
  manager.reviewCopies(session.sessionId);
  manager.approveReview(session.sessionId);
  fs.writeFileSync(path.join(terminal.isolatedRoot, 'src', 'value.js'), 'export const value = 99;\n');
  await assert.rejects(() => manager.merge(session.sessionId), /changed after host review/);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  cleanupIsolatedWorkspace(prepared(manager.store.load(session.sessionId)));
  return { staleReviewRejected: true };
}

async function manifestAndRecoveryProof() {
  const root = fixture('forge-background-manifest-');
  const state = await initialState(root);
  const fakeLauncher = async () => ({ pid: 99999999 });
  const manager = new BackgroundSessionManager(root, fakeLauncher);
  const session = await manager.start(state, 'copy');
  const stale = manager.store.update(session.sessionId, current => ({ ...current, status: 'running', pid: 99999999, heartbeatAt: new Date(0).toISOString() }));
  assert.equal(manager.store.isStale(stale), true);
  const resumed = await manager.resume(session.sessionId);
  assert.equal(resumed.status, 'running');
  const cancelled = await manager.cancel(session.sessionId, 100);
  assert.equal(cancelled.status, 'cancelled');
  cleanupIsolatedWorkspace(prepared(manager.store.load(session.sessionId)));

  const tamperRoot = fixture('forge-background-contract-');
  const tamperManager = new BackgroundSessionManager(tamperRoot, async () => ({ pid: process.pid }));
  const tamperState = await initialState(tamperRoot);
  const tamperSession = await tamperManager.start(tamperState, 'copy');
  const manifestPath = tamperManager.store.manifestPath(tamperSession.sessionId);
  const forged = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  forged.executionContract.digest = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(forged, null, 2));
  await assert.rejects(() => runBackgroundSession(manifestPath, initializerProvider()), /contract identity or confirmation is invalid/);
  assert.equal(tamperManager.store.load(tamperSession.sessionId).status, 'failed');
  cleanupIsolatedWorkspace(prepared(tamperManager.store.load(tamperSession.sessionId)));

  const missingRoot = fixture('forge-background-missing-');
  const missingManager = new BackgroundSessionManager(missingRoot, fakeLauncher);
  const missingSession = await missingManager.start(await initialState(missingRoot), 'copy');
  fs.rmSync(missingSession.tempParent, { recursive: true, force: true });
  assert.throws(() => missingManager.reviewCopies(missingSession.sessionId), /workspace is missing/);
  await missingManager.cancel(missingSession.sessionId, 100);
  return { staleDetected: true, staleResumed: true, forgedContractRejected: true, missingRootRejected: true };
}

async function askGateProof() {
  const root = fixture('forge-background-ask-');
  const observations = { launcherExited: false };
  const helpers = writeDetachedHelpers(root, true);
  const manager = new BackgroundSessionManager(root, detachedLauncher(helpers, observations));
  const session = await manager.start(await initialState(root), 'copy');
  const waiting = await waitFor(manager, session.sessionId, ['awaiting_input', 'failed']);
  assert.equal(waiting.status, 'awaiting_input', waiting.error);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  const isolatedState = JSON.parse(fs.readFileSync(waiting.statePath, 'utf8'));
  const pending = isolatedState.clarifications.find(item => item.status === 'pending');
  assert.ok(pending);
  const loop = new AgentHarnessLoop(approvalProvider(), waiting.isolatedRoot, undefined);
  loop.answerClarification('Yes', pending.id);
  await manager.resume(session.sessionId);
  const terminal = await waitFor(manager, session.sessionId, ['awaiting_review', 'failed', 'gave_up']);
  assert.equal(terminal.status, 'awaiting_review', terminal.error);
  assert.equal(observations.launcherExited, true);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  cleanupIsolatedWorkspace(prepared(terminal));
  return { pausedForInput: true, resumedAfterAnswer: true, sourcePreserved: true };
}

async function approvalGateProof() {
  const root = fixture('forge-background-approval-');
  const observations = { launcherExited: false };
  const helpers = writeDetachedHelpers(root);
  const manager = new BackgroundSessionManager(root, detachedLauncher(helpers, observations));
  const session = await manager.start(await initialState(root, 'ask'), 'copy');
  const waiting = await waitFor(manager, session.sessionId, ['awaiting_approval', 'failed'], 60_000);
  assert.equal(waiting.status, 'awaiting_approval', waiting.error);
  const isolatedState = JSON.parse(fs.readFileSync(waiting.statePath, 'utf8'));
  assert.equal(isolatedState.pendingHumanApproval?.status, 'pending');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  const loop = new AgentHarnessLoop(approvalProvider(), waiting.isolatedRoot, undefined);
  await loop.decideHumanApproval('approve', isolatedState.pendingHumanApproval.id, 'Approved by causal fixture.', bindings);
  await manager.resume(session.sessionId);
  const terminal = await waitFor(manager, session.sessionId, ['awaiting_review', 'failed', 'gave_up'], 60_000);
  assert.equal(terminal.status, 'awaiting_review', terminal.error);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  cleanupIsolatedWorkspace(prepared(terminal));
  return { pausedBeforeMutation: true, resumedAfterApproval: true, sourcePreserved: true };
}

try {
  const green = await greenMergeProof();
  const rollback = await rollbackProof();
  const tamper = await reviewTamperProof();
  const recovery = await manifestAndRecoveryProof();
  const askGate = await askGateProof();
  const approvalGate = await approvalGateProof();
  console.log(JSON.stringify({ pass: true, green, rollback, tamper, recovery, askGate, approvalGate, noProviderSpend: true }, null, 2));
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
