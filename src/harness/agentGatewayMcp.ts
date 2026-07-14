import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const gatewayUrl = normalizeGatewayUrl(process.env.FORGE_AGENT_GATEWAY_URL);
const gatewayToken = String(process.env.FORGE_AGENT_GATEWAY_TOKEN || '');
if (gatewayToken.length < 32) throw new Error('FORGE_AGENT_GATEWAY_TOKEN is missing or too short.');

const server = new McpServer({ name: 'forge-agent-governed-gateway', version: '1.0.0' });

server.registerTool('forge_submit_goal', {
  description: 'Submit a bounded coding goal to the authenticated local Forge harness. This does not approve actions or bypass the execution contract.',
  inputSchema: { goal: z.string().min(1).max(20_000) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, async ({ goal }) => result(await gatewayRequest('/v1/goals', 'POST', { requestId: requestId('goal'), goal })));

server.registerTool('forge_submit_proposal', {
  description: 'Submit one structured proposal to an existing Forge session. Forge still owns validation, approval, commit, verification, evidence, and terminal truth.',
  inputSchema: {
    sessionId: z.string().min(1).max(128),
    contractDigest: z.string().regex(/^[a-fA-F0-9]{64}$/),
    explanation: z.string().min(1).max(4_000),
    toolName: z.string().min(1).max(128),
    argumentsJson: z.string().min(2).max(64 * 1024),
    confidence: z.number().min(0).max(100).optional(),
    materialUncertainty: z.boolean().optional(),
    uncertainties: z.array(z.string().min(1).max(1_000)).max(10).optional()
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
}, async ({ sessionId, contractDigest, explanation, toolName, argumentsJson, confidence, materialUncertainty, uncertainties }) => {
  const args = parseArguments(argumentsJson);
  return result(await gatewayRequest(`/v1/sessions/${encodeURIComponent(sessionId)}/proposals`, 'POST', {
    requestId: requestId('proposal'),
    contractDigest,
    envelope: { explanation, proposal: { name: toolName, arguments: args }, ...(confidence === undefined ? {} : { confidence }), materialUncertainty: materialUncertainty === true, uncertainties: uncertainties || [] }
  }));
});

server.registerTool('forge_get_status', {
  description: 'Read a bounded Forge session status. Full source snapshots, credentials, hidden prompts, approval authority, and trusted evidence bodies are not returned.',
  inputSchema: { sessionId: z.string().min(1).max(128) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ sessionId }) => result(await gatewayRequest(`/v1/sessions/${encodeURIComponent(sessionId)}`, 'GET')));

server.registerTool('forge_cancel', {
  description: 'Request terminal cancellation of a Forge session. Cancellation cannot approve, merge, or declare success.',
  inputSchema: { sessionId: z.string().min(1).max(128) },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
}, async ({ sessionId }) => result(await gatewayRequest(`/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, 'POST', { requestId: requestId('cancel') })));

void server.connect(new StdioServerTransport());

async function gatewayRequest(route: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}${route}`, {
    method,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${gatewayToken}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (text.length > 128 * 1024) throw new Error('Agent Gateway response exceeded the MCP facade limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Agent Gateway returned invalid JSON (${response.status}).`); }
  if (!response.ok) {
    const detail = parsed && typeof parsed === 'object' ? String((parsed as any).message || (parsed as any).error || response.statusText) : response.statusText;
    throw new Error(`Agent Gateway rejected the request (${response.status}): ${detail}`);
  }
  return parsed;
}

function normalizeGatewayUrl(value: unknown): string {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FORGE_AGENT_GATEWAY_URL must be an origin-only http://127.0.0.1 URL.');
  }
  return url.origin;
}

function parseArguments(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('argumentsJson must encode an object.');
  return parsed;
}

function requestId(prefix: string): string {
  return `mcp-${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function result(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
