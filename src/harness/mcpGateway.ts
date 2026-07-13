import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Ajv, { ValidateFunction } from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 32 * 1024;
const MAX_JSON_DEPTH = 20;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DISCOVERY_PAGES = 20;
const MAX_DISCOVERED_TOOLS = 1000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type McpSideEffect = 'read' | 'workspace_write' | 'network' | 'external_write';
export type McpApproval = 'never' | 'always';

export interface McpToolPolicy {
  sideEffect: McpSideEffect;
  approval: McpApproval;
  allowedRoles: string[];
  scope: 'workspace' | 'external';
  workspacePathFields: string[];
  evidenceRequired: boolean;
}

export interface McpServerConfig {
  id: string;
  name?: string;
  enabled: boolean;
  transport: 'stdio' | 'streamable-http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  credentialBindings?: Record<string, string>;
  tools: Record<string, McpToolPolicy>;
}

export interface McpDiscoveredTool {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  policy: McpToolPolicy;
}

export interface McpCallContext {
  sessionId: string;
  taskId: string;
  role: string;
}

export interface McpGatewayResult {
  success: boolean;
  output: string;
  evidencePath?: string;
  interaction?: McpInteractionRecord;
}

export interface McpInteractionRecord {
  id: string;
  timestamp: string;
  sessionId: string;
  taskId: string;
  role: string;
  serverId: string;
  toolName: string;
  sideEffect: McpSideEffect;
  success: boolean;
  outputTruncated: boolean;
  output: string;
  payloadDigest: string;
  evidencePath: string;
}

export interface McpGatewayOptions {
  workspaceRoot: () => string;
  servers: () => McpServerConfig[];
  getSecret?: (key: string) => PromiseLike<string | undefined>;
  resolveWorkspacePath: (relativePath: string) => string;
  timeoutMs?: number;
}

interface ConnectedClient {
  client: Client;
  close(): Promise<void>;
}

export class McpToolGateway {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly discovered = new Map<string, McpDiscoveredTool>();

  constructor(private readonly options: McpGatewayOptions) {}

  public configuredServers(): McpServerConfig[] {
    return this.options.servers().filter(server => server.enabled).map(server => normalizeMcpServerConfig(server));
  }

  public async discover(serverId?: string): Promise<McpDiscoveredTool[]> {
    const servers = this.configuredServers().filter(server => !serverId || server.id === serverId);
    const result: McpDiscoveredTool[] = [];
    for (const server of servers) {
      const connection = await this.connect(server);
      try {
        let cursor: string | undefined;
        let pages = 0;
        do {
          if (pages >= MAX_DISCOVERY_PAGES || result.length >= MAX_DISCOVERED_TOOLS) throw new Error('MCP discovery exceeded its bounded page or tool limit.');
          const response = await connection.client.listTools(cursor ? { cursor } : undefined, { timeout: this.timeoutMs() });
          pages += 1;
          for (const remote of response.tools) {
            if (result.length >= MAX_DISCOVERED_TOOLS) throw new Error('MCP discovery exceeded its bounded tool limit.');
            const policy = server.tools[remote.name];
            if (!policy) continue;
            const normalizedPolicy = validateToolPolicy(policy);
            const inputSchema = remote.inputSchema as Record<string, unknown>;
            validateInputSchema(inputSchema);
            const tool: McpDiscoveredTool = {
              serverId: server.id,
              name: remote.name,
              description: String(remote.description || '').slice(0, 1000),
              inputSchema,
              policy: normalizedPolicy
            };
            const key = toolKey(server.id, remote.name);
            this.discovered.set(key, tool);
            this.validators.set(key, this.ajv.compile(tool.inputSchema));
            result.push(tool);
          }
          cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : undefined;
        } while (cursor);
      } finally {
        await connection.close();
      }
    }
    return result;
  }

  public sanitizedCatalog(role?: string): Array<{ serverId: string; name: string; description: string; sideEffect: McpSideEffect; approval: McpApproval }> {
    return Array.from(this.discovered.values())
      .filter(tool => !role || tool.policy.allowedRoles.includes(role))
      .map(tool => ({ serverId: tool.serverId, name: tool.name, description: tool.description, sideEffect: tool.policy.sideEffect, approval: tool.policy.approval }))
      .sort((a, b) => `${a.serverId}/${a.name}`.localeCompare(`${b.serverId}/${b.name}`));
  }

  public async validateProposal(args: Record<string, unknown>, role: string): Promise<{ valid: boolean; reason?: string; tool?: McpDiscoveredTool; payload?: Record<string, unknown> }> {
    const serverId = boundedIdentifier(args.serverId, 'serverId');
    const toolName = boundedIdentifier(args.toolName, 'toolName');
    if (!serverId.valid || !toolName.valid) return { valid: false, reason: serverId.reason || toolName.reason };
    const payloadResult = parseBoundedPayload(args.payloadJson);
    if (!payloadResult.valid) return { valid: false, reason: payloadResult.reason };

    const key = toolKey(serverId.value!, toolName.value!);
    let configuredServer: McpServerConfig | undefined;
    try {
      configuredServer = this.configuredServers().find(server => server.id === serverId.value);
    } catch (error: any) {
      return { valid: false, reason: `[mcp_policy_invalid] ${safeError(error)}` };
    }
    const configuredPolicy = configuredServer?.tools[toolName.value!];
    if (!configuredServer || !configuredPolicy) return { valid: false, reason: `[mcp_tool_not_authorized] ${serverId.value}/${toolName.value} is not explicitly configured.` };
    let tool = this.discovered.get(key);
    if (!tool) {
      try {
        await this.discover(serverId.value);
      } catch (error: any) {
        return { valid: false, reason: `[mcp_discovery_failed] ${safeError(error)}` };
      }
      tool = this.discovered.get(key);
    }
    if (!tool) return { valid: false, reason: `[mcp_tool_not_authorized] ${serverId.value}/${toolName.value} is not both discovered and explicitly configured.` };
    try {
      tool = { ...tool, policy: validateToolPolicy(configuredPolicy) };
      this.discovered.set(key, tool);
    } catch (error: any) {
      return { valid: false, reason: `[mcp_policy_invalid] ${safeError(error)}` };
    }
    if (!tool.policy.allowedRoles.includes(role)) return { valid: false, reason: `[mcp_role_blocked] ${role} cannot call ${serverId.value}/${toolName.value}.` };

    const validator = this.validators.get(key);
    if (!validator || !validator(payloadResult.payload)) {
      const detail = (validator?.errors || []).slice(0, 5).map(error => `${error.instancePath || '/'} ${error.message || 'is invalid'}`).join('; ');
      return { valid: false, reason: `[mcp_schema_blocked] Payload does not match the discovered schema${detail ? `: ${detail}` : '.'}` };
    }
    for (const field of tool.policy.workspacePathFields) {
      const values = valuesAtPath(payloadResult.payload!, field);
      for (const value of values) {
        if (typeof value !== 'string') return { valid: false, reason: `[mcp_scope_blocked] Workspace path field '${field}' must be a string.` };
        try {
          this.options.resolveWorkspacePath(value);
        } catch (error: any) {
          return { valid: false, reason: `[mcp_scope_blocked] ${safeError(error)}` };
        }
      }
    }
    return { valid: true, tool, payload: payloadResult.payload };
  }

  public async execute(args: Record<string, unknown>, context: McpCallContext): Promise<McpGatewayResult> {
    const validation = await this.validateProposal(args, context.role);
    if (!validation.valid || !validation.tool || !validation.payload) return { success: false, output: validation.reason || 'MCP proposal rejected.' };
    const server = this.configuredServers().find(candidate => candidate.id === validation.tool!.serverId);
    if (!server) return { success: false, output: 'MCP server is disabled or no longer configured.' };
    const connection = await this.connect(server);
    let success = false;
    let output = '';
    try {
      const response = await connection.client.callTool(
        { name: validation.tool.name, arguments: validation.payload },
        undefined,
        { timeout: this.timeoutMs() }
      );
      success = !('isError' in response && response.isError === true);
      output = normalizeMcpOutput(response);
    } catch (error: any) {
      output = `[mcp_call_failed] ${safeError(error)}`;
    } finally {
      await connection.close();
    }
    output = await this.redactKnownSecrets(server, output);
    return this.recordInteraction(validation.tool, validation.payload, context, success, output);
  }

  public isMutating(args: Record<string, unknown>): boolean {
    const tool = this.cachedTool(args);
    return Boolean(tool && tool.policy.sideEffect !== 'read');
  }

  public requiresApproval(args: Record<string, unknown>): boolean {
    const tool = this.cachedTool(args);
    return Boolean(tool && (tool.policy.approval === 'always' || tool.policy.sideEffect !== 'read'));
  }

  public affectsWorkspace(args: Record<string, unknown>): boolean {
    return this.cachedTool(args)?.policy.sideEffect === 'workspace_write';
  }

  public cachedPolicy(args: Record<string, unknown>): McpToolPolicy | undefined {
    return this.cachedTool(args)?.policy;
  }

  private cachedTool(args: Record<string, unknown>): McpDiscoveredTool | undefined {
    return this.discovered.get(toolKey(String(args.serverId || ''), String(args.toolName || '')));
  }

  private timeoutMs(): number {
    return Math.max(1_000, Math.min(120_000, this.options.timeoutMs || DEFAULT_TIMEOUT_MS));
  }

  private async connect(server: McpServerConfig): Promise<ConnectedClient> {
    const client = new Client({ name: 'forge-agent', version: '0.89.0' });
    if (server.transport === 'stdio') {
      const env = { ...getDefaultEnvironment(), ...(server.env || {}), ...(await this.resolveCredentials(server)) };
      const transport = new StdioClientTransport({
        command: String(server.command),
        args: server.args || [],
        cwd: server.cwd || this.options.workspaceRoot(),
        env,
        stderr: 'pipe'
      });
      try { await client.connect(transport, { timeout: this.timeoutMs() }); }
      catch (error) { await client.close().catch(() => undefined); throw error; }
      return { client, close: () => client.close() };
    }
    const url = new URL(String(server.url));
    if (!isLoopbackHost(url.hostname)) throw new Error('Streamable HTTP MCP is limited to loopback hosts until network isolation is implemented.');
    const headers = { ...(server.headers || {}), ...(await this.resolveCredentials(server)) };
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' } });
    try { await client.connect(transport, { timeout: this.timeoutMs() }); }
    catch (error) { await client.close().catch(() => undefined); throw error; }
    return { client, close: () => client.close() };
  }

  private async resolveCredentials(server: McpServerConfig): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    if (!this.options.getSecret) return resolved;
    for (const [targetName, secretKey] of Object.entries(server.credentialBindings || {})) {
      const secret = await this.options.getSecret(`${server.id}.${secretKey}`);
      if (secret) resolved[targetName] = secret;
    }
    return resolved;
  }

  private async redactKnownSecrets(server: McpServerConfig, text: string): Promise<string> {
    let redacted = text;
    const credentials = await this.resolveCredentials(server);
    for (const value of Object.values(credentials)) {
      if (value.length >= 4) redacted = redacted.split(value).join('[REDACTED_MCP_CREDENTIAL]');
    }
    return redacted;
  }

  private recordInteraction(tool: McpDiscoveredTool, payload: Record<string, unknown>, context: McpCallContext, success: boolean, rawOutput: string): McpGatewayResult {
    const root = this.options.workspaceRoot();
    const directory = path.join(root, '.forge', 'mcp-runs');
    fs.mkdirSync(directory, { recursive: true });
    const id = `mcp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const outputTruncated = rawOutput.length > MAX_OUTPUT_CHARS;
    const output = rawOutput.slice(0, MAX_OUTPUT_CHARS);
    const evidencePath = path.join(directory, `${id}.json`);
    const interaction: McpInteractionRecord = {
      id,
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      taskId: context.taskId,
      role: context.role,
      serverId: tool.serverId,
      toolName: tool.name,
      sideEffect: tool.policy.sideEffect,
      success,
      outputTruncated,
      output,
      payloadDigest: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      evidencePath
    };
    fs.writeFileSync(evidencePath, JSON.stringify(interaction, null, 2), 'utf8');
    const summaryPath = path.join(root, '.forge', 'mcp-interactions.json');
    let summary: McpInteractionRecord[] = [];
    try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { /* first interaction */ }
    summary.push(interaction);
    fs.writeFileSync(summaryPath, JSON.stringify(summary.slice(-500), null, 2), 'utf8');
    return { success, output, evidencePath, interaction };
  }
}

export function normalizeMcpServerConfig(input: McpServerConfig): McpServerConfig {
  const id = String(input?.id || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) throw new Error('MCP server id must be a bounded identifier.');
  if (!['stdio', 'streamable-http'].includes(input.transport)) throw new Error(`MCP server '${id}' has an unsupported transport.`);
  if (input.transport === 'stdio' && (!input.command || typeof input.command !== 'string')) throw new Error(`MCP stdio server '${id}' requires a command.`);
  if (input.command && input.command.length > 4096) throw new Error(`MCP server '${id}' command is too long.`);
  if (input.args && (!Array.isArray(input.args) || input.args.length > 100 || input.args.some(arg => typeof arg !== 'string' || arg.length > 4096))) throw new Error(`MCP server '${id}' arguments must be at most 100 bounded strings.`);
  if ((input.args || []).some(arg => /(^|[-_/])(authorization|password|secret|token|api[-_]?key)(=|$)/i.test(arg))) throw new Error(`MCP server '${id}' must bind credentials through SecretStorage, not command arguments.`);
  if (input.transport === 'streamable-http') {
    const url = new URL(String(input.url || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`MCP HTTP server '${id}' requires credential-free HTTP(S).`);
    if (!isLoopbackHost(url.hostname)) throw new Error(`MCP HTTP server '${id}' must use a loopback host.`);
  }
  for (const key of [...Object.keys(input.env || {}), ...Object.keys(input.headers || {})]) {
    if (/(authorization|cookie|password|secret|token|api[-_]?key)/i.test(key)) throw new Error(`MCP server '${id}' must store sensitive '${key}' through credentialBindings and SecretStorage.`);
  }
  for (const [target, secretName] of Object.entries(input.credentialBindings || {})) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(target) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(secretName))) throw new Error(`MCP server '${id}' has an invalid credential binding.`);
  }
  if (!input.tools || typeof input.tools !== 'object' || Array.isArray(input.tools)) throw new Error(`MCP server '${id}' requires explicit tool policies.`);
  const entries = Object.entries(input.tools);
  if (entries.length > MAX_DISCOVERED_TOOLS) throw new Error(`MCP server '${id}' declares too many tool policies.`);
  const tools: Record<string, McpToolPolicy> = {};
  for (const [name, policy] of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(name)) throw new Error(`MCP server '${id}' has an invalid tool name.`);
    tools[name] = validateToolPolicy(policy);
  }
  return { ...input, id, tools };
}

export function upsertMcpServerConfig(existing: McpServerConfig[], input: McpServerConfig): McpServerConfig[] {
  const normalized = normalizeMcpServerConfig(input);
  const current = Array.isArray(existing) ? existing.map(normalizeMcpServerConfig) : [];
  const index = current.findIndex(server => server.id === normalized.id);
  if (index < 0) return [...current, normalized];
  const next = [...current];
  next[index] = normalized;
  return next;
}

export function removeMcpServerConfig(existing: McpServerConfig[], serverId: string): McpServerConfig[] {
  const id = String(serverId || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) throw new Error('MCP server id must be a bounded identifier.');
  const current = Array.isArray(existing) ? existing.map(normalizeMcpServerConfig) : [];
  if (!current.some(server => server.id === id)) throw new Error(`MCP server '${id}' is not configured.`);
  return current.filter(server => server.id !== id);
}

function validateToolPolicy(input: McpToolPolicy): McpToolPolicy {
  const sideEffect = input?.sideEffect;
  if (!['read', 'workspace_write', 'network', 'external_write'].includes(sideEffect)) throw new Error('MCP tool policy has an invalid sideEffect.');
  const approval: McpApproval = sideEffect === 'read' && input.approval === 'never' ? 'never' : 'always';
  const allowedRoles = Array.from(new Set((input.allowedRoles || []).map(String).filter(Boolean))).slice(0, 20);
  if (!allowedRoles.length) throw new Error('MCP tool policy requires at least one allowed role.');
  return {
    sideEffect,
    approval,
    allowedRoles,
    scope: input.scope === 'workspace' ? 'workspace' : 'external',
    workspacePathFields: Array.from(new Set((input.workspacePathFields || []).map(String).filter(Boolean))).slice(0, 20),
    evidenceRequired: true
  };
}

function parseBoundedPayload(value: unknown): { valid: boolean; reason?: string; payload?: Record<string, unknown> } {
  if (typeof value !== 'string') return { valid: false, reason: '[mcp_payload_blocked] payloadJson must be a JSON string.' };
  if (Buffer.byteLength(value, 'utf8') > MAX_PAYLOAD_BYTES) return { valid: false, reason: `[mcp_payload_blocked] payloadJson exceeds ${MAX_PAYLOAD_BYTES} bytes.` };
  try {
    const payload = JSON.parse(value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, reason: '[mcp_payload_blocked] payloadJson must encode an object.' };
    const safety = validateJsonTree(payload, 0);
    return safety.valid ? { valid: true, payload } : safety;
  } catch (error: any) {
    return { valid: false, reason: `[mcp_payload_blocked] Invalid JSON: ${safeError(error)}` };
  }
}

function validateJsonTree(value: unknown, depth: number): { valid: boolean; reason?: string } {
  if (depth > MAX_JSON_DEPTH) return { valid: false, reason: `[mcp_payload_blocked] JSON nesting exceeds ${MAX_JSON_DEPTH}.` };
  if (!value || typeof value !== 'object') return { valid: true };
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) return { valid: false, reason: `[mcp_payload_blocked] Forbidden property '${key}'.` };
    const result = validateJsonTree(child, depth + 1);
    if (!result.valid) return result;
  }
  return { valid: true };
}

function validateInputSchema(schema: Record<string, unknown>): void {
  const encoded = JSON.stringify(schema);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('MCP input schema exceeds the 64 KiB limit.');
  const tree = validateJsonTree(schema, 0);
  if (!tree.valid) throw new Error(tree.reason || 'MCP input schema is unsafe.');
  const inspect = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && !child.startsWith('#/')) throw new Error('MCP input schema cannot use remote $ref values.');
      if (key === 'pattern' || key === 'patternProperties') throw new Error(`MCP input schema keyword '${key}' is disabled for untrusted schemas.`);
      inspect(child, depth + 1);
    }
  };
  inspect(schema, 0);
}

function valuesAtPath(payload: Record<string, unknown>, fieldPath: string): unknown[] {
  const segments = fieldPath.split('.').filter(Boolean);
  let current: unknown[] = [payload];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const item of current) {
      if (Array.isArray(item) && segment === '*') next.push(...item);
      else if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, segment)) next.push((item as Record<string, unknown>)[segment]);
    }
    current = next;
  }
  return current;
}

function normalizeMcpOutput(response: Record<string, unknown>): string {
  if ('toolResult' in response) return stableStringify(response.toolResult);
  const content = Array.isArray(response.content) ? response.content : [];
  const rendered = content.map((item: any) => {
    if (item?.type === 'text') return String(item.text || '');
    if (item?.type === 'resource' && item.resource?.text) return String(item.resource.text);
    return `[${String(item?.type || 'unknown')} MCP content omitted]`;
  }).join('\n');
  if (response.structuredContent) return `${rendered}${rendered ? '\n' : ''}${stableStringify(response.structuredContent)}`;
  return rendered || '[MCP tool returned no text output]';
}

function stableStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function boundedIdentifier(value: unknown, name: string): { valid: boolean; reason?: string; value?: string } {
  const normalized = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(normalized)) return { valid: false, reason: `[mcp_payload_blocked] ${name} must be a bounded identifier.` };
  return { valid: true, value: normalized };
}

function toolKey(serverId: string, toolName: string): string {
  return `${serverId}\u0000${toolName}`;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function safeError(error: unknown): string {
  return String((error as any)?.message || error || 'Unknown MCP error').slice(0, 1000);
}
