import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareCompactionStrategies, createModelContextProfile } from '../out/harness/contextOptimization.js';
import { chooseModelRoute } from '../out/harness/modelRouting.js';
import { ComposerContextService } from '../out/harness/composerContext.js';
import { AgentHarnessLoop } from '../out/harness/loop.js';

const capability = (contextLength, toolCalls = true) => ({ structuredOutput: true, toolCalls, vision: false, contextLength });
const profiles = [16_000, 32_000, 128_000, 1_000_000].map(contextLength => createModelContextProfile(`fixture/${contextLength}`, 'Editor', capability(contextLength), 'provider-catalog'));
for (let index = 1; index < profiles.length; index += 1) {
  assert.ok(profiles[index].promptCharBudget >= profiles[index - 1].promptCharBudget, 'prompt budgets must be monotonic');
}
for (const profile of profiles) {
  assert.ok(profile.outputReserveTokens >= 2_048, 'every profile reserves output capacity');
  assert.ok(profile.promptTokenBudget + profile.outputReserveTokens <= profile.contextTokens, 'prompt plus reserve must fit context');
  assert.ok(profile.promptCharBudget <= 256_000, 'host hard cap must hold');
}

const catalog = [
  { id: 'cheap/capable', name: 'Cheap', provider: 'cheap', capabilities: ['structured_output', 'tool_calls'], contextLength: 64_000, promptPrice: 0.0000001, completionPrice: 0.0000002 },
  { id: 'frontier/capable', name: 'Frontier', provider: 'frontier', capabilities: ['structured_output', 'tool_calls'], contextLength: 128_000, promptPrice: 0.00001, completionPrice: 0.00003 },
  { id: 'cheap/no-tools', name: 'No tools', provider: 'cheap', capabilities: ['structured_output'], contextLength: 128_000, promptPrice: 0, completionPrice: 0 },
  { id: 'cheap/small-context', name: 'Small', provider: 'cheap', capabilities: ['structured_output', 'tool_calls'], contextLength: 8_000, promptPrice: 0, completionPrice: 0 },
  { id: 'unknown/capable', name: 'Unknown price', provider: 'unknown', capabilities: ['structured_output', 'tool_calls'], contextLength: 64_000 }
];
const route = chooseModelRoute({
  taskId: 'edit-1', taskTitle: 'Fix the small validation branch', role: 'Editor', explicitModelId: 'frontier/capable', defaultModelId: 'default/code',
  pool: ['unknown/capable', 'frontier/capable', 'cheap/no-tools', 'cheap/capable'], catalog, capabilityFor: () => capability(64_000), enabled: true
});
assert.equal(route.selectedModelId, 'cheap/capable', 'known-price capable cheap worker should win');
assert.equal(route.source, 'configured-pool');
assert.equal(route.candidates.find(item => item.modelId === 'cheap/no-tools')?.accepted, false);
assert.ok(route.candidates.find(item => item.modelId === 'cheap/no-tools')?.reason.includes('tool calls'));

const complex = chooseModelRoute({
  taskId: 'edit-2', taskTitle: 'Multi-file causal refactor', role: 'Editor', explicitModelId: 'frontier/capable', defaultModelId: 'default/code',
  pool: ['cheap/small-context', 'frontier/capable'], catalog, capabilityFor: () => capability(64_000), enabled: true, openBlockerCount: 2
});
assert.equal(complex.terrain, 'complex-edit');
assert.equal(complex.selectedModelId, 'frontier/capable');
assert.equal(complex.candidates.find(item => item.modelId === 'cheap/small-context')?.accepted, false);

const architect = chooseModelRoute({
  taskId: 'plan-1', taskTitle: 'Create the implementation plan', role: 'Architect', explicitModelId: 'frontier/capable', defaultModelId: 'default/plan',
  pool: ['cheap/capable'], catalog, capabilityFor: () => capability(64_000), enabled: true
});
assert.equal(architect.selectedModelId, 'frontier/capable', 'Architect binding must remain authoritative');
assert.equal(architect.source, 'explicit-role');

const disabled = chooseModelRoute({
  taskId: 'edit-3', taskTitle: 'Fix typo', role: 'Editor', explicitModelId: 'frontier/capable', defaultModelId: 'default/code',
  pool: ['cheap/capable'], catalog, capabilityFor: () => capability(64_000), enabled: false
});
assert.equal(disabled.selectedModelId, 'frontier/capable', 'routing opt-out must preserve explicit binding');

const compaction = await compareCompactionStrategies([
  { id: 'required-goal', required: true, priority: 100, content: 'GOAL_SENTINEL must remain exact.' },
  { id: 'required-tool-contract', required: true, priority: 100, content: 'TOOL_CONTRACT_SENTINEL must remain exact.' },
  { id: 'optional-history', priority: 10, content: 'repeated history '.repeat(10_000) },
  { id: 'optional-results', priority: 9, toolResult: true, content: 'stale result '.repeat(8_000) }
], profiles[1], async (_text, maxChars) => 'Scripted model summary of optional history and stale tool results.'.slice(0, maxChars), true);
assert.equal(compaction.requiredSectionsPreserved, true);
assert.equal(compaction.scripted, true);
assert.equal(compaction.deterministic.compacted, true);
assert.ok(compaction.modelWritten.summaryChars > 0);
assert.ok(compaction.modelWritten.sourceCompressionChars > 100_000);

class ScriptedImageProvider {
  constructor(vision) { this.vision = vision; this.calls = 0; this.lastOptions = undefined; }
  capabilities() { return { structuredOutput: true, toolCalls: true, vision: this.vision, contextLength: 64_000 }; }
  async listModels() { return [{ id: this.vision ? 'fixture/vision' : 'fixture/text', name: 'Fixture', provider: 'fixture', capabilities: ['structured_output', 'tool_calls', ...(this.vision ? ['vision'] : [])], contextLength: 64_000, promptPrice: 0, completionPrice: 0 }]; }
  async generateChat(options) {
    this.calls += 1;
    this.lastOptions = options;
    return { text: JSON.stringify({ confidence: 95, materialUncertainty: false, uncertainties: [], explanation: 'Inspect source.', proposal: { name: 'repo_search', arguments: { query: 'export' } } }), usage: { promptTokens: 10, completionTokens: 5, totalCost: 0 } };
  }
}

const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-image-route-'));
fs.mkdirSync(path.join(imageRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(imageRoot, 'src', 'index.ts'), 'export const answer = 42;\n');
fs.writeFileSync(path.join(imageRoot, 'src', 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
const imageAttachment = new ComposerContextService(imageRoot).captureImage('src/diagram.png');

const textProvider = new ScriptedImageProvider(false);
const textLoop = new AgentHarnessLoop(textProvider, imageRoot, undefined);
let textState = await textLoop.initializeHarness('Inspect the attached diagram.', { code: 'fixture/text' }, {}, { userContext: [imageAttachment] });
textState = await textLoop.runStep(textState, { code: 'fixture/text' });
assert.equal(textProvider.calls, 0, 'non-vision model must not receive image bytes');
assert.equal(textState.status, 'awaiting_input');

const visionProvider = new ScriptedImageProvider(true);
const visionLoop = new AgentHarnessLoop(visionProvider, imageRoot, undefined);
let visionState = await visionLoop.initializeHarness('Inspect the attached diagram.', { code: 'fixture/vision' }, {}, { userContext: [imageAttachment] });
visionState = await visionLoop.runStep(visionState, { code: 'fixture/vision' });
assert.equal(visionProvider.calls, 1);
const userContent = visionProvider.lastOptions.messages.find(message => message.role === 'user').content;
assert.ok(Array.isArray(userContent));
assert.ok(userContent.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')));
assert.equal(JSON.stringify(visionState).includes('data:image/png;base64,'), false, 'raw image bytes must not persist in harness state');
fs.rmSync(imageRoot, { recursive: true, force: true });

console.log(JSON.stringify({ pass: true, profiles, selected: route.selectedModelId, complexSelected: complex.selectedModelId, architectSelected: architect.selectedModelId, compaction, nonVisionProviderCalls: textProvider.calls, visionProviderCalls: visionProvider.calls }, null, 2));
