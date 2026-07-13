import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mcp-smoke-'));
const { McpToolGateway } = await import(pathToFileURL(path.join(process.cwd(), 'out', 'harness', 'mcpGateway.js')).href);
const fixture = path.join(process.cwd(), 'out', 'test', 'fixtures', 'mcpFixtureServer.js');

function resolveWorkspacePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('path must be workspace-relative');
  const target = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error('path escapes workspace');
  return target;
}

const server = {
  id: 'fixture',
  enabled: true,
  transport: 'stdio',
  command: process.execPath,
  args: [fixture],
  cwd: root,
  tools: {
    read_echo: { sideEffect: 'read', approval: 'never', allowedRoles: ['Explorer', 'Editor'], scope: 'external', workspacePathFields: [], evidenceRequired: true },
    write_marker: { sideEffect: 'workspace_write', approval: 'never', allowedRoles: ['Editor'], scope: 'workspace', workspacePathFields: ['path'], evidenceRequired: true },
    large_output: { sideEffect: 'read', approval: 'never', allowedRoles: ['Explorer'], scope: 'external', workspacePathFields: [], evidenceRequired: true }
    ,echo_secret: { sideEffect: 'read', approval: 'never', allowedRoles: ['Explorer'], scope: 'external', workspacePathFields: [], evidenceRequired: true }
  }
};
const gateway = new McpToolGateway({ workspaceRoot: () => root, resolveWorkspacePath, servers: () => [server], timeoutMs: 10000 });
const discovered = await gateway.discover();
assert.deepEqual(discovered.map(tool => tool.name).sort(), ['echo_secret', 'large_output', 'read_echo', 'write_marker']);
assert.equal(gateway.sanitizedCatalog().some(tool => tool.name === 'undeclared_tool'), false, 'discovery must not grant authority');

const readArgs = { serverId: 'fixture', toolName: 'read_echo', payloadJson: JSON.stringify({ message: 'weak-worker' }) };
assert.equal((await gateway.validateProposal(readArgs, 'Explorer')).valid, true);
assert.equal(gateway.isMutating(readArgs), false);
assert.equal(gateway.requiresApproval(readArgs), false);
const read = await gateway.execute(readArgs, { sessionId: 'weak-editor-session', taskId: 'explore-1', role: 'Explorer' });
assert.equal(read.success, true);
assert.match(read.output, /fixture:weak-worker/);
assert.ok(read.evidencePath && fs.existsSync(read.evidencePath));

assert.equal((await gateway.validateProposal({ ...readArgs, payloadJson: '{}' }, 'Explorer')).valid, false, 'discovered schema must be enforced');
assert.equal((await gateway.validateProposal(readArgs, 'Reviewer')).valid, false, 'role policy must be enforced');
assert.equal((await gateway.validateProposal({ serverId: 'fixture', toolName: 'undeclared_tool', payloadJson: '{"value":"x"}' }, 'Explorer')).valid, false, 'undeclared tool must reject');

const writeArgs = { serverId: 'fixture', toolName: 'write_marker', payloadJson: JSON.stringify({ path: 'result.txt', content: 'governed' }) };
assert.equal((await gateway.validateProposal(writeArgs, 'Editor')).valid, true);
assert.equal(gateway.isMutating(writeArgs), true);
assert.equal(gateway.requiresApproval(writeArgs), true, 'non-read policy upgrades approval to always');
assert.equal((await gateway.validateProposal({ ...writeArgs, payloadJson: JSON.stringify({ path: '../escape.txt', content: 'bad' }) }, 'Editor')).valid, false);
const write = await gateway.execute(writeArgs, { sessionId: 'weak-editor-session', taskId: 'edit-1', role: 'Editor' });
assert.equal(write.success, true);
assert.equal(fs.readFileSync(path.join(root, 'result.txt'), 'utf8'), 'governed');

const large = await gateway.execute({ serverId: 'fixture', toolName: 'large_output', payloadJson: '{"size":50000}' }, { sessionId: 'weak-editor-session', taskId: 'explore-2', role: 'Explorer' });
assert.equal(large.success, true);
assert.equal(large.output.length, 32768);
assert.equal(large.interaction.outputTruncated, true);

const secretServer = { ...server, credentialBindings: { FIXTURE_SECRET: 'token' } };
const secretGateway = new McpToolGateway({ workspaceRoot: () => root, resolveWorkspacePath, servers: () => [secretServer], getSecret: async key => key === 'fixture.token' ? 'fixture-secret-value' : undefined, timeoutMs: 10000 });
await secretGateway.discover();
const redacted = await secretGateway.execute({ serverId: 'fixture', toolName: 'echo_secret', payloadJson: '{}' }, { sessionId: 'weak-editor-session', taskId: 'secret-1', role: 'Explorer' });
assert.equal(redacted.success, true);
assert.equal(redacted.output, '[REDACTED_MCP_CREDENTIAL]');
assert.equal(fs.readFileSync(redacted.evidencePath, 'utf8').includes('fixture-secret-value'), false, 'credential must not reach MCP evidence');

const staleServer = structuredClone(server);
const staleGateway = new McpToolGateway({ workspaceRoot: () => root, resolveWorkspacePath, servers: () => [staleServer], timeoutMs: 10000 });
await staleGateway.discover();
staleServer.tools.read_echo.allowedRoles = ['Reviewer'];
staleServer.tools.read_echo.sideEffect = 'external_write';
assert.equal((await staleGateway.validateProposal(readArgs, 'Explorer')).valid, false, 'current host policy must override cached discovery authority');
assert.equal((await staleGateway.validateProposal(readArgs, 'Reviewer')).valid, true);
assert.equal(staleGateway.requiresApproval(readArgs), true, 'current side-effect policy must replace stale cached policy');

const summary = JSON.parse(fs.readFileSync(path.join(root, '.forge', 'mcp-interactions.json'), 'utf8'));
assert.equal(summary.length, 4);
assert.equal(summary.every(item => item.sessionId === 'weak-editor-session'), true);

// Product loop proof: a bounded Architect handoff precedes a separate weak Editor
// session, and the weak worker reaches the same gateway through the normal harness.
const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mcp-harness-'));
fs.writeFileSync(path.join(harnessRoot, 'package.json'), JSON.stringify({ name: 'mcp-harness-fixture', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }), 'utf8');
const harnessServer = { ...server, cwd: harnessRoot };
const harnessGateway = new McpToolGateway({ workspaceRoot: () => harnessRoot, resolveWorkspacePath: relativePath => {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('path must be workspace-relative');
  const target = path.resolve(harnessRoot, relativePath);
  if (!target.startsWith(`${harnessRoot}${path.sep}`)) throw new Error('path escapes workspace');
  return target;
}, servers: () => [harnessServer], timeoutMs: 10000 });
await harnessGateway.discover();
const { AgentHarnessLoop } = await import(pathToFileURL(path.join(process.cwd(), 'out', 'harness', 'loop.js')).href);
const providerCalls = [];
const envelope = proposal => JSON.stringify({ explanation: 'bounded scripted proposal', proposal, confidence: 95, materialUncertainty: false, uncertainties: [] });
const provider = {
  id: 'architect-weak-worker-proof',
  modelId: 'weak-worker',
  async generateChat(request) {
    const system = request.messages?.find(message => message.role === 'system')?.content || '';
    providerCalls.push({ modelId: request.modelId, sessionId: request.sessionId, system });
    if (system.includes('Role: Explorer')) return { text: envelope({ name: 'external_tool', arguments: readArgs }) };
    if (system.includes('Role: Architect')) return { text: envelope({ name: 'update_plan', arguments: { planMd: '# Plan\n\n## Premise Checks\n- MCP read established fixture authority.\n\n## Focus Files\n- package.json\n\n## Ordered Steps\n1. Ask the weak Editor to call fixture/write_marker for src/generated.txt.\n2. Run verification.' } }) };
    if (system.includes('Role: Editor')) return { text: envelope({ name: 'external_tool', arguments: { serverId: 'fixture', toolName: 'write_marker', payloadJson: JSON.stringify({ path: 'src/generated.txt', content: 'weak-worker-executed' }) } }) };
    throw new Error('unexpected provider role');
  }
};
const loop = new AgentHarnessLoop(provider, harnessRoot, undefined, harnessGateway);
let state = await loop.initializeHarness('Use the governed MCP fixture to create src/generated.txt and verify the workspace.', { Architect: 'strong-planner', Editor: 'weak-worker', code: 'weak-worker' }, {}, { humanApprovalPolicy: 'auto' });
state = await loop.runStep(state, { Architect: 'strong-planner', Editor: 'weak-worker', code: 'weak-worker' });
assert.equal(state.taskGraph.tasks[0].status, 'completed');
state = await loop.runStep(state, { Architect: 'strong-planner', Editor: 'weak-worker', code: 'weak-worker' });
assert.equal(state.taskGraph.tasks[1].status, 'completed');
assert.ok(state.architectHandoff?.planMd.includes('weak Editor'));
state = await loop.runStep(state, { Architect: 'strong-planner', Editor: 'weak-worker', code: 'weak-worker' });
assert.equal(state.status, 'awaiting_approval', 'weak worker side effect must pause even under auto approval policy');
assert.equal(fs.existsSync(path.join(harnessRoot, 'src', 'generated.txt')), false, 'workspace must remain unchanged before approval');
state = await loop.decideHumanApproval('approve', state.pendingHumanApproval.id, 'fixture approval', { Architect: 'strong-planner', Editor: 'weak-worker', code: 'weak-worker' });
assert.equal(fs.readFileSync(path.join(harnessRoot, 'src', 'generated.txt'), 'utf8'), 'weak-worker-executed');
assert.equal(state.mcpInteractions.length, 2);
assert.equal(state.runStats.mcpCalls, 2);
assert.equal(state.lastOraclePass, true);
const explorerCall = providerCalls.find(call => call.system.includes('Role: Explorer'));
const architectCall = providerCalls.find(call => call.system.includes('Role: Architect'));
const editorCall = providerCalls.find(call => call.system.includes('Role: Editor'));
assert.equal(explorerCall.modelId, 'weak-worker');
assert.equal(architectCall.modelId, 'strong-planner');
assert.equal(editorCall.modelId, 'weak-worker');
assert.notEqual(architectCall.sessionId, editorCall.sessionId, 'planner and weak worker require isolated provider sessions');
assert.match(editorCall.system, /Committed architect execution plan/);
assert.match(editorCall.system, /fixture\/write_marker/);

console.log(JSON.stringify({ pass: true, discovered: discovered.length, hiddenUndeclared: true, schemaBlocked: true, roleBlocked: true, traversalBlocked: true, approvalUpgraded: true, stalePolicyBlocked: true, credentialRedacted: true, weakWorkerToolCall: read.output, outputTruncated: large.interaction.outputTruncated, evidenceCount: summary.length, planBigExecuteSmall: { architectModel: architectCall.modelId, workerModel: editorCall.modelId, isolatedSessions: architectCall.sessionId !== editorCall.sessionId, preApprovalWorkspaceUnchanged: true, mcpCalls: state.runStats.mcpCalls, oracleGreenAfterApprovedWorkerWrite: state.lastOraclePass } }, null, 2));
