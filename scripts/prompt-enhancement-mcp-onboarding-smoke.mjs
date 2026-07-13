import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { enhancePrompt, PROMPT_ENHANCEMENT_SCHEMA } from '../out/harness/promptEnhancer.js';
import { normalizeMcpServerConfig, removeMcpServerConfig, upsertMcpServerConfig } from '../out/harness/mcpGateway.js';

let providerCalls = 0;
let lastOptions;
const provider = {
  capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
  listModels: async () => [],
  generateChat: async options => {
    providerCalls += 1;
    lastOptions = options;
    return {
      text: JSON.stringify({
        objective: 'Fix the parser without widening its public API.',
        scope: 'Inspect the existing parser and its focused tests; change only files required by the defect.',
        constraints: ['Preserve existing supported syntax.', 'Do not weaken tests or validation.'],
        acceptanceCriteria: ['The failing parser fixture passes.', 'Existing parser tests remain green.'],
        evidence: ['Focused parser test output.', 'Diff limited to the required implementation and test files.'],
        openQuestions: ['Should malformed legacy input remain accepted?']
      }),
      usage: { promptTokens: 120, completionTokens: 80, totalCost: 0.00004 }
    };
  }
};

const enhanced = await enhancePrompt(provider, {
  draft: 'fix parser bug',
  modelId: 'google/gemini-2.5-flash-lite',
  sessionId: 'forge-enhance-test',
  modeName: 'Code'
});
assert.equal(providerCalls, 1);
assert.equal(lastOptions.modelId, 'google/gemini-2.5-flash-lite');
assert.equal(lastOptions.responseFormatSchema, PROMPT_ENHANCEMENT_SCHEMA);
assert.equal(lastOptions.fallbackModels, undefined, 'prompt enhancement must not silently route to a stronger fallback.');
assert.match(enhanced.enhancedPrompt, /^Objective:/);
assert.match(enhanced.enhancedPrompt, /Done when:/);
assert.match(enhanced.enhancedPrompt, /Required evidence:/);
assert.match(enhanced.enhancedPrompt, /Open questions for the user:/);
assert.equal(enhanced.usage.totalCost, 0.00004);
assert.match(enhanced.originalDigest, /^[a-f0-9]{64}$/);

await assert.rejects(() => enhancePrompt(provider, { draft: '', modelId: 'cheap/model', sessionId: 'empty' }), /Enter a prompt/);
await assert.rejects(() => enhancePrompt(provider, { draft: 'x'.repeat(12_001), modelId: 'cheap/model', sessionId: 'large' }), /12,000/);
assert.equal(providerCalls, 1, 'invalid drafts must reject before provider spend.');

const malformedProvider = { ...provider, generateChat: async () => ({ text: '{not-json' }) };
await assert.rejects(() => enhancePrompt(malformedProvider, { draft: 'keep me', modelId: 'cheap/model', sessionId: 'malformed' }), /original draft was preserved/i);
const extraFieldProvider = { ...provider, generateChat: async () => ({ text: JSON.stringify({ objective: 'x', scope: 'x', constraints: [], acceptanceCriteria: ['x'], evidence: ['x'], openQuestions: [], hiddenReasoning: 'never' }) }) };
await assert.rejects(() => enhancePrompt(extraFieldProvider, { draft: 'keep me', modelId: 'cheap/model', sessionId: 'extra' }), /unexpected fields/i);

const readPolicy = { sideEffect: 'read', approval: 'never', allowedRoles: ['Explorer', 'Reviewer'], scope: 'workspace', workspacePathFields: ['path'], evidenceRequired: true };
const server = normalizeMcpServerConfig({
  id: 'local-tools', name: 'Local tools', enabled: true, transport: 'stdio', command: process.execPath, args: ['server.mjs'], tools: { inspect_file: readPolicy }
});
assert.equal(server.tools.inspect_file.approval, 'never');
assert.equal(upsertMcpServerConfig([], server).length, 1);
const replaced = upsertMcpServerConfig([server], { ...server, name: 'Updated local tools' });
assert.equal(replaced.length, 1);
assert.equal(replaced[0].name, 'Updated local tools');
assert.deepEqual(removeMcpServerConfig(replaced, 'local-tools'), []);
assert.throws(() => removeMcpServerConfig([], 'missing'), /not configured/);
assert.throws(() => normalizeMcpServerConfig({ ...server, transport: 'streamable-http', command: undefined, url: 'https://example.com/mcp' }), /loopback host/);
assert.throws(() => normalizeMcpServerConfig({ ...server, args: ['--api-key=secret'] }), /SecretStorage/);
assert.throws(() => normalizeMcpServerConfig({ ...server, tools: { bad: { ...readPolicy, allowedRoles: [] } } }), /at least one allowed role/);

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'webview', 'src', 'App.tsx'), 'utf8');
const extensionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'extension.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
assert.match(appSource, /command: 'enhance-prompt'/);
assert.doesNotMatch(appSource, /Please clarify assumptions, propose a safe plan/);
assert.match(appSource, /Review before sending/);
assert.match(extensionSource, /forge-agent\.enhancePrompt/);
assert.match(extensionSource, /forge-agent\.addMcpServer/);
assert.match(extensionSource, /forge-agent\.removeMcpServer/);
assert.equal(manifest.contributes.configuration.properties['forge.promptEnhancementModel'].default, 'google/gemini-2.5-flash-lite');
assert.equal(manifest.contributes.configuration.properties['forge.mcpTimeoutMs'].maximum, 120000);

console.log(JSON.stringify({
  pass: true,
  providerCalls,
  modelId: enhanced.modelId,
  structured: true,
  autoSubmitted: false,
  mcpOnboarding: { add: true, replace: true, remove: true, remoteRejected: true, secretArgumentRejected: true }
}, null, 2));
