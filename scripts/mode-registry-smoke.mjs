import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL_MODE_TOOLS, BUILT_IN_MODES, ModeRegistry, REQUIRED_CODE_MODE_TOOLS } from '../out/harness/modeRegistry.js';
import { AgentHarnessLoop } from '../out/harness/loop.js';

class MemoryStorage {
  values = new Map();
  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  async update(key, value) { this.values.set(key, JSON.parse(JSON.stringify(value))); }
}
const storage = new MemoryStorage();
const registry = new ModeRegistry(storage);
assert.equal(registry.list().filter(mode => mode.builtIn).length, 9);
await assert.rejects(() => registry.upsert({ id: 'code', name: 'Spoof', description: 'x', instructions: 'x', intent: 'code', modelRole: 'code', inference: 'Instant', allowedTools: ALL_MODE_TOOLS }), /Built-in modes cannot be overwritten/);
await assert.rejects(() => registry.upsert({ name: 'Unsafe', description: 'Missing proof tools', instructions: 'Try to skip proof.', intent: 'code', modelRole: 'code', inference: 'Instant', allowedTools: ['apply_patch'] }), /require proof\/workflow tools/);
await assert.rejects(() => registry.upsert({ name: 'Unknown Tool', description: 'Unknown authority', instructions: 'Try an unknown tool.', intent: 'code', modelRole: 'code', inference: 'Instant', allowedTools: [...REQUIRED_CODE_MODE_TOOLS, 'root_shell'] }), /Unknown mode tool/);

const allowedWithoutCommand = Array.from(new Set([...REQUIRED_CODE_MODE_TOOLS, 'repo_search', 'read_file', 'read_range', 'apply_patch', 'write_file']));
const custom = await registry.upsert({ name: 'No Shell Code', description: 'Agentic coding without shell commands.', instructions: 'Use file tools and deterministic test oracle only.', intent: 'code', modelRole: 'code', inference: 'Thinking', allowedTools: allowedWithoutCommand });
assert.match(custom.id, /^custom-/);
assert.equal(custom.allowedTools.includes('run_command'), false);
await assert.rejects(() => registry.upsert({ name: 'No Shell Code', description: 'Duplicate', instructions: 'Duplicate name.', intent: 'ask', modelRole: 'plan', inference: 'Instant', allowedTools: ['read_file', 'ask_user'] }), /already exists/);
const reloaded = new ModeRegistry(storage);
assert.equal(reloaded.resolve(custom.id).name, 'No Shell Code', 'custom mode must survive a later registry instance.');
await assert.rejects(() => reloaded.delete('code'), /Built-in modes cannot be deleted/);

for (let index = 0; index < 19; index++) {
  await registry.upsert({ name: `Mode ${index}`, description: `Bounded custom mode ${index}`, instructions: 'Remain advisory.', intent: 'ask', modelRole: 'plan', inference: 'Instant', allowedTools: ['read_file', 'ask_user'] });
}
await assert.rejects(() => registry.upsert({ name: 'Mode overflow', description: 'Exceeds limit', instructions: 'No.', intent: 'ask', modelRole: 'plan', inference: 'Instant', allowedTools: ['read_file', 'ask_user'] }), /limit reached/);

const makeWorkspace = prefix => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  fs.writeFileSync(path.join(root, 'target.txt'), 'mode fixture\n');
  return root;
};
const envelope = proposal => JSON.stringify({ explanation: `Causal mode proposal ${proposal.name}.`, confidence: 95, materialUncertainty: false, uncertainties: [], proposal });
const prepare = (state, role, stage) => {
  state.taskGraph.tasks = [{ id: 'mode-task', title: stage === 'verify' ? 'Verification oracle' : 'Apply scoped code changes', status: 'running', dependencies: [], blockers: [], owner: role }];
  const order = ['classify', 'plan', 'baseline', 'reconcile', 'document_plan', 'implement', 'verify', 'review', 'evidence', 'close'];
  for (const item of state.workflow.stages) item.status = item.id === stage ? 'running' : order.indexOf(item.id) < order.indexOf(stage) ? 'completed' : 'pending';
  state.workflow.currentStage = stage;
};
const policyWithoutCommand = { id: custom.id, name: custom.name, intent: 'code', instructions: custom.instructions, allowedTools: custom.allowedTools };
const blockedRoot = makeWorkspace('forge-mode-blocked-');
const blockedLoop = new AgentHarnessLoop({ generateChat: async () => ({ text: envelope({ name: 'run_command', arguments: { command: 'node -v' } }) }) }, blockedRoot, undefined);
let blockedState = await blockedLoop.initializeHarness('Prove custom mode removes shell authority.', {}, {}, { modePolicy: policyWithoutCommand });
prepare(blockedState, 'Reviewer', 'verify');
blockedState = await blockedLoop.runStep(blockedState, { review: 'scripted' });
assert.equal(blockedState.runStats.roleCapabilityBlocks, 1);
assert.equal(blockedState.workerContexts.Reviewer.processExecutions, 0, 'mode-rejected tool must not reach a worker.');
assert.match(blockedState.firewall.validationReason || '', /Allowed tools/);

const retainedRoot = makeWorkspace('forge-mode-retained-');
const retainedLoop = new AgentHarnessLoop({ generateChat: async () => ({ text: envelope({ name: 'run_tests', arguments: {} }) }) }, retainedRoot, undefined);
let retainedState = await retainedLoop.initializeHarness('Prove retained mode tools still work.', {}, {}, { modePolicy: policyWithoutCommand });
prepare(retainedState, 'Reviewer', 'verify');
retainedState = await retainedLoop.runStep(retainedState, { review: 'scripted' });
assert.equal(retainedState.lastOraclePass, true);
assert.ok(retainedState.roleHandoffs.Reviewer.allowedTools.includes('run_tests'));
assert.equal(retainedState.roleHandoffs.Reviewer.allowedTools.includes('run_command'), false);

const attemptedGrant = { id: 'custom-attempted-grant', name: 'Attempted Grant', intent: 'code', instructions: 'Try to add shell authority.', allowedTools: ALL_MODE_TOOLS };
const grantRoot = makeWorkspace('forge-mode-grant-');
const grantLoop = new AgentHarnessLoop({ generateChat: async () => ({ text: envelope({ name: 'run_command', arguments: { command: 'node -v' } }) }) }, grantRoot, undefined);
let grantState = await grantLoop.initializeHarness('Prove mode cannot grant Editor shell authority.', {}, {}, { modePolicy: attemptedGrant });
prepare(grantState, 'Editor', 'implement');
grantState = await grantLoop.runStep(grantState, { code: 'scripted' });
assert.equal(grantState.runStats.roleCapabilityBlocks, 1);
assert.equal(grantState.workerContexts.Editor.allowedTools.includes('run_command'), false);

assert.equal(await registry.delete(custom.id), true);
assert.equal(registry.list().some(mode => mode.id === custom.id), false);
console.log(JSON.stringify({ passed: true, builtIns: BUILT_IN_MODES.length, persistedCustom: true, reviewerCommandBlocked: true, retainedOracleGreen: retainedState.lastOraclePass, editorGrantBlocked: true }, null, 2));
