import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AgentHarnessLoop } from '../out/harness/loop.js';
import { AgentGatewayServer, generateAgentGatewayToken } from '../out/harness/agentGateway.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

function fixtureRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node test.js' } }, null, 2));
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'test.js'), "const assert=require('node:assert/strict'); assert.equal(require('./app'),2); console.log('green');\n");
  return root;
}

function reviewerProvider(counter) {
  return {
    id: 'gateway-review-fixture',
    modelId: 'review-fixture',
    capabilities: () => ({ structuredOutput: true, toolCalls: true, vision: false, contextLength: 128000 }),
    listModels: async () => [],
    generateChat: async options => {
      counter.calls += 1;
      const system = String(options.messages?.[0]?.content || '');
      if (/Reviewer|review/i.test(system)) return { text: JSON.stringify({ status: 'approved', summary: 'Fixture reviewer approved the bounded proposal.', concerns: [] }) };
      throw new Error('Gateway causal fixture must not ask Forge to generate a proposal.');
    }
  };
}

function envelope(name, args, explanation = `External client proposes ${name}.`) {
  return { explanation, confidence: 95, materialUncertainty: false, uncertainties: [], proposal: { name, arguments: args } };
}

// Causal harness proof: external proposals use the normal loop but never inflate provider/model credit.
const harnessRoot = fixtureRoot('forge-agent-gateway-harness-');
const reviewCalls = { calls: 0 };
const loop = new AgentHarnessLoop(reviewerProvider(reviewCalls), harnessRoot);
let state = await loop.initializeHarness('Fix app.js so the disposable test passes.', {}, {}, { humanApprovalPolicy: 'ask', assuranceLevel: 'standard' });
assert.equal(state.executionContract.status, 'confirmed');
state = await loop.runSubmittedProposal(state, envelope('read_file', { path: 'app.js' }));
assert.equal(state.runStats.gatewayProposals, 1);
assert.equal(state.runStats.modelDrivenProposals, 0);
assert.equal(state.runStats.providerCalls, 0);
assert.equal(state.runStats.fallbackProposals, 0);
assert.equal(state.runStats.actuallyModelDriven, false);
assert.equal(state.taskGraph.tasks[0].status, 'completed');

state = await loop.runSubmittedProposal(state, envelope('update_plan', { planMd: '# PLAN.md\n\n- Fix app.js.\n- Run tests.\n- Review the diff.\n- Record green evidence.\n' }));
assert.equal(state.taskGraph.tasks[1].status, 'completed');

state = await loop.runSubmittedProposal(state, envelope('write_file', { path: '../escape.js', content: 'bad\n' }));
assert.notEqual(state.status, 'success');
assert.equal(fs.existsSync(path.join(harnessRoot, '..', 'escape.js')), false);
assert.match(String(state.firewall.validationReason || ''), /outside workspace|escape|path/i);

state = await loop.runSubmittedProposal(state, envelope('write_file', { path: 'app.js', content: 'module.exports = 2;\n' }));
assert.equal(state.status, 'awaiting_approval');
assert.equal(fs.readFileSync(path.join(harnessRoot, 'app.js'), 'utf8'), 'module.exports = 1;\n', 'gateway proposal must not mutate before native approval');
assert.ok(state.pendingHumanApproval?.id);
const approvalId = state.pendingHumanApproval.id;
state = await loop.decideHumanApproval('approve', approvalId, 'Native fixture approval.', { review: 'review-fixture', code: 'review-fixture' });
assert.equal(fs.readFileSync(path.join(harnessRoot, 'app.js'), 'utf8'), 'module.exports = 2;\n');
assert.equal(state.lastOraclePass, true);
assert.equal(reviewCalls.calls, 0, 'approval-time model bindings cannot widen a confirmed gateway contract or spend provider credits');

state = await loop.runSubmittedProposal(state, envelope('run_tests', {}));
state = await loop.runSubmittedProposal(state, envelope('get_diff', {}));
state = await loop.runSubmittedProposal(state, envelope('record_evidence', { observation: 'Green disposable test result observed through the governed gateway run.' }));
assert.equal(state.status, 'success');
assert.ok(state.evidenceLedger.some(item => item.testResult?.pass === true));
assert.equal(state.runStats.gatewayProposals >= 6, true);
assert.equal(state.runStats.modelDrivenProposals, 0);
assert.equal(state.runStats.fallbackProposals, 0);
assert.equal(state.runStats.actuallyModelDriven, false, 'unattested bearer client must not count as verified model-driven work');
assert.ok(state.runStats.preCommitReviews >= 1, 'normal pre-commit review must remain in the harness path');
assert.equal(reviewCalls.calls, 0, 'deterministic Standard-mode gateway proof must not spend provider credits');

const falseRoot = fixtureRoot('forge-agent-gateway-false-success-');
const falseLoop = new AgentHarnessLoop(reviewerProvider({ calls: 0 }), falseRoot);
let falseState = await falseLoop.initializeHarness('Try to claim success without proof.', {}, {}, { humanApprovalPolicy: 'ask' });
falseState = await falseLoop.runSubmittedProposal(falseState, envelope('declare_success', {}));
assert.notEqual(falseState.status, 'success');
assert.equal(falseState.lastOraclePass, false);
await assert.rejects(() => falseLoop.runSubmittedProposal(falseState, { explanation: '', proposal: { name: 'read_file', arguments: {} } }), /gateway_schema_blocked/);
assert.equal(falseState.runStats.gatewayProposalRejections, 1);

function view(sessionId = 'gateway-session', status = 'idle') {
  return {
    schemaVersion: 1,
    sessionId,
    contractDigest: 'a'.repeat(64),
    contractStatus: 'confirmed',
    status,
    phase: 'IDLE',
    activeTask: { id: '1', title: 'Inspect fixture', role: 'Explorer', status: 'running' },
    oracle: { green: false, lint: 'unchecked', typecheck: 'unchecked', tests: 'unchecked', build: 'unchecked' },
    latestProgress: [],
    proposalAccounting: { gateway: 0, gatewayRejected: 0, provider: 0, fallback: 0, actuallyModelDriven: false }
  };
}

const transportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agent-gateway-http-'));
let enabled = false;
let token = generateAgentGatewayToken();
const delegateCalls = { goals: 0, proposals: 0, status: 0, cancel: 0 };
let currentView = view();
const delegate = {
  async submitGoal(request) {
    delegateCalls.goals += 1;
    currentView = view('gateway-session', 'idle');
    if (request.goal === 'oversized-response') return { ...currentView, latestProgress: [{ sequence: 1, kind: 'tool', status: 'complete', summary: 'oversized', detail: 'x'.repeat(140_000), role: 'Explorer' }] };
    return currentView;
  },
  async submitProposal(request) {
    delegateCalls.proposals += 1;
    if (request.contractDigest !== currentView.contractDigest) throw new Error('[stale_contract] stale fixture contract');
    if (request.envelope.explanation === 'delay') await new Promise(resolve => setTimeout(resolve, 120));
    return { ...currentView, proposalAccounting: { ...currentView.proposalAccounting, gateway: currentView.proposalAccounting.gateway + 1 } };
  },
  async getStatus(sessionId) { delegateCalls.status += 1; if (sessionId !== currentView.sessionId) throw new Error('[unknown_gateway_session] missing'); return currentView; },
  async cancel() { delegateCalls.cancel += 1; currentView = { ...currentView, status: 'gave_up', haltReason: 'cancelled' }; return currentView; }
};
const gateway = new AgentGatewayServer({ workspaceRoot: () => transportRoot, enabled: () => enabled, getToken: async () => token, delegate, port: 0, rateLimitPerMinute: 60, version: 'test' });
await assert.rejects(() => gateway.start(), /disabled/);
enabled = true;
const started = await gateway.start();
assert.equal(started.running, true);
assert.equal(started.host, '127.0.0.1');
assert.ok(started.url?.startsWith('http://127.0.0.1:'));

async function request(route, { auth = token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${started.url}${route}`, {
    method,
    headers: { ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) };
}

async function requestWithHost(hostHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: started.port, path: '/v1/capabilities', method: 'GET', headers: { Host: hostHeader, Authorization: `Bearer ${token}` } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

assert.equal((await request('/v1/capabilities', { auth: null })).status, 401);
assert.equal((await request('/v1/capabilities', { auth: 'wrong-token-value-that-is-long-enough' })).status, 401);
assert.equal((await request('/v1/capabilities', { headers: { Origin: 'http://evil.example' } })).status, 403);
assert.equal((await requestWithHost('evil.example')).status, 403);
const capabilities = await request('/v1/capabilities');
assert.equal(capabilities.status, 200);
assert.deepEqual(capabilities.body.capabilities, ['submit_goal', 'submit_proposal', 'get_status', 'cancel']);
for (const forbidden of ['approve', 'author_evidence', 'select_oracle', 'merge', 'attest', 'declare_success']) assert.ok(capabilities.body.deniedCapabilities.includes(forbidden));

const goalBody = { requestId: 'goal-1', goal: 'Inspect the disposable gateway fixture.' };
const goal = await request('/v1/goals', { method: 'POST', body: goalBody });
assert.equal(goal.status, 200);
assert.equal(delegateCalls.goals, 1);
const replay = await request('/v1/goals', { method: 'POST', body: { goal: goalBody.goal, requestId: goalBody.requestId } });
assert.equal(replay.status, 200);
assert.equal(delegateCalls.goals, 1, 'same canonical request replay must not redispatch');
assert.equal((await request('/v1/goals', { method: 'POST', body: { requestId: 'goal-1', goal: 'Different content.' } })).status, 409);
assert.equal((await request('/v1/goals', { method: 'POST', body: { requestId: 'goal-extra', goal: 'x', extra: true } })).status, 400);
assert.equal((await request('/v1/goals', { method: 'POST', body: 'x'.repeat(70_000) })).status, 413);
const oversizedResponse = await request('/v1/goals', { method: 'POST', body: { requestId: 'goal-oversized-response', goal: 'oversized-response' } });
assert.equal(oversizedResponse.status, 500);
assert.equal(oversizedResponse.body.error, 'response_too_large');
assert.equal(fs.readFileSync(path.join(transportRoot, '.forge', 'agent-gateway', 'replay.json'), 'utf8').includes('x'.repeat(10_000)), false, 'oversized delegate responses must not enter the replay ledger');

for (const route of ['/v1/sessions/gateway-session/approve', '/v1/sessions/gateway-session/merge', '/v1/sessions/gateway-session/evidence', '/v1/sessions/gateway-session/success']) {
  assert.equal((await request(route, { method: 'POST', body: { requestId: `forbidden-${route.split('/').at(-1)}` } })).status, 404);
}

const proposalBody = { requestId: 'proposal-1', contractDigest: 'a'.repeat(64), envelope: envelope('read_file', { path: 'app.js' }) };
assert.equal((await request('/v1/sessions/gateway-session/proposals', { method: 'POST', body: proposalBody })).status, 200);
assert.equal(delegateCalls.proposals, 1);
const stale = await request('/v1/sessions/gateway-session/proposals', { method: 'POST', body: { ...proposalBody, requestId: 'proposal-stale', contractDigest: 'b'.repeat(64) } });
assert.equal(stale.status, 409);
assert.equal(stale.body.error, 'stale_contract');

const delayed = request('/v1/sessions/gateway-session/proposals', { method: 'POST', body: { ...proposalBody, requestId: 'proposal-delay', envelope: envelope('read_file', { path: 'app.js' }, 'delay') } });
await new Promise(resolve => setTimeout(resolve, 20));
const concurrent = await request('/v1/sessions/gateway-session/cancel', { method: 'POST', body: { requestId: 'cancel-concurrent' } });
assert.equal(concurrent.status, 409);
assert.equal((await delayed).status, 200);

const oldToken = token;
token = generateAgentGatewayToken();
assert.equal((await request('/v1/capabilities', { auth: oldToken })).status, 401);
assert.equal((await request('/v1/capabilities', { auth: token })).status, 200);

// Real stdio MCP client against the packaged facade and authenticated loopback server.
const mcp = new Client({ name: 'forge-agent-gateway-smoke', version: '1.0.0' });
const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(process.cwd(), 'out', 'agentGatewayMcp.js')],
  env: { ...getDefaultEnvironment(), FORGE_AGENT_GATEWAY_URL: started.url, FORGE_AGENT_GATEWAY_TOKEN: token },
  stderr: 'pipe'
});
await mcp.connect(mcpTransport, { timeout: 10_000 });
const toolList = await mcp.listTools();
assert.deepEqual(toolList.tools.map(item => item.name).sort(), ['forge_cancel', 'forge_get_status', 'forge_submit_goal', 'forge_submit_proposal']);
assert.equal(toolList.tools.some(item => /approve|evidence|oracle|merge|attest|success/.test(item.name)), false);
const mcpStatus = await mcp.callTool({ name: 'forge_get_status', arguments: { sessionId: 'gateway-session' } });
assert.match(String(mcpStatus.content?.[0]?.text || ''), /gateway-session/);
await mcp.close();

const auditPath = path.join(transportRoot, '.forge', 'agent-gateway', 'audit.jsonl');
const replayPath = path.join(transportRoot, '.forge', 'agent-gateway', 'replay.json');
const statusPath = path.join(transportRoot, '.forge', 'agent-gateway', 'status.json');
assert.ok(fs.existsSync(auditPath) && fs.existsSync(replayPath) && fs.existsSync(statusPath));
const persisted = `${fs.readFileSync(auditPath, 'utf8')}\n${fs.readFileSync(replayPath, 'utf8')}\n${fs.readFileSync(statusPath, 'utf8')}`;
assert.equal(persisted.includes(oldToken), false);
assert.equal(persisted.includes(token), false);
assert.equal(fs.readFileSync(auditPath, 'utf8').includes(goalBody.goal), false, 'audit must contain digests, not raw goals');
await gateway.stop();

const rateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agent-gateway-rate-'));
const rateToken = generateAgentGatewayToken();
const rateGateway = new AgentGatewayServer({ workspaceRoot: () => rateRoot, enabled: () => true, getToken: async () => rateToken, delegate, port: 0, rateLimitPerMinute: 2 });
const rateStatus = await rateGateway.start();
const rateFetch = () => fetch(`${rateStatus.url}/v1/capabilities`, { headers: { Authorization: `Bearer ${rateToken}` } });
assert.equal((await rateFetch()).status, 200);
assert.equal((await rateFetch()).status, 200);
assert.equal((await rateFetch()).status, 429);
await rateGateway.stop();

console.log(`agent-gateway smoke passed: harnessGateway=${state.runStats.gatewayProposals}, providerProposals=${state.runStats.modelDrivenProposals}, falseSuccess=${falseState.status}, httpGoals=${delegateCalls.goals}, httpProposals=${delegateCalls.proposals}, mcpTools=${toolList.tools.length}, noProviderSpend=true`);
