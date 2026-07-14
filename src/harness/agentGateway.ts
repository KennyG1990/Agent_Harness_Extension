import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { SubmittedProposalEnvelope } from './loop';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REPLAY_ENTRIES = 1_000;
const MAX_AUDIT_ENTRIES = 1_000;
const MAX_JSON_DEPTH = 20;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface AgentGatewaySessionView {
  schemaVersion: 1;
  sessionId: string;
  contractDigest: string;
  contractStatus: string;
  status: string;
  phase: string;
  activeTask?: { id: string; title: string; role: string; status: string };
  oracle: { green: boolean; lint: string; typecheck: string; tests: string; build: string };
  pending?: { kind: 'contract' | 'approval' | 'clarification'; id: string; summary: string };
  latestProgress: Array<{ sequence: number; kind: string; status: string; summary: string; detail?: string; role: string; toolName?: string }>;
  proposalAccounting: { gateway: number; gatewayRejected: number; provider: number; fallback: number; actuallyModelDriven: boolean };
  haltReason?: string;
}

export interface AgentGatewayGoalRequest {
  requestId: string;
  goal: string;
}

export interface AgentGatewayProposalRequest {
  requestId: string;
  sessionId: string;
  contractDigest: string;
  envelope: SubmittedProposalEnvelope;
}

export interface AgentGatewayCancelRequest {
  requestId: string;
  sessionId: string;
}

export interface AgentGatewayDelegate {
  submitGoal(request: AgentGatewayGoalRequest): Promise<AgentGatewaySessionView>;
  submitProposal(request: AgentGatewayProposalRequest): Promise<AgentGatewaySessionView>;
  getStatus(sessionId: string): Promise<AgentGatewaySessionView>;
  cancel(request: AgentGatewayCancelRequest): Promise<AgentGatewaySessionView>;
}

export interface AgentGatewayOptions {
  workspaceRoot: () => string;
  enabled: () => boolean;
  getToken: () => PromiseLike<string | undefined>;
  delegate: AgentGatewayDelegate;
  port?: number;
  rateLimitPerMinute?: number;
  version?: string;
}

export interface AgentGatewayStatus {
  schemaVersion: 1;
  enabled: boolean;
  running: boolean;
  host: typeof LOOPBACK_HOST;
  port?: number;
  url?: string;
  startedAt?: string;
  stoppedAt?: string;
  authenticated: true;
  capabilities: readonly ['submit_goal', 'submit_proposal', 'get_status', 'cancel'];
}

interface ReplayEntry {
  requestId: string;
  requestDigest: string;
  status: 'pending' | 'complete';
  httpStatus?: number;
  response?: unknown;
  recordedAt: string;
}

interface GatewayAuditEntry {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  requestId?: string;
  requestDigest: string;
  method: string;
  route: string;
  outcome: 'received' | 'accepted' | 'rejected' | 'completed' | 'failed';
  httpStatus: number;
  sessionId?: string;
  reasonCode?: string;
}

class GatewayHttpError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string) {
    super(message);
  }
}

export class AgentGatewayServer {
  private server?: http.Server;
  private startedAt?: string;
  private stoppedAt?: string;
  private dispatching = false;
  private readonly requestTimes: number[] = [];

  constructor(private readonly options: AgentGatewayOptions) {}

  public async start(): Promise<AgentGatewayStatus> {
    if (this.server) return this.status();
    if (!this.options.enabled()) throw new Error('Agent Gateway is disabled. Enable forge.agentGatewayEnabled before starting it.');
    const token = String(await this.options.getToken() || '');
    if (Buffer.byteLength(token, 'utf8') < 32) throw new Error('Agent Gateway token is missing or too short. Rotate the gateway token before starting.');
    const configuredPort = normalizePort(this.options.port);
    const server = http.createServer((request, response) => { void this.handle(request, response); });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 50;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(configuredPort, LOOPBACK_HOST);
    });
    this.server = server;
    this.startedAt = new Date().toISOString();
    this.stoppedAt = undefined;
    this.persistStatus();
    return this.status();
  }

  public async stop(): Promise<AgentGatewayStatus> {
    const server = this.server;
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    this.server = undefined;
    this.stoppedAt = new Date().toISOString();
    this.persistStatus();
    return this.status();
  }

  public status(): AgentGatewayStatus {
    const address = this.server?.address();
    const port = address && typeof address === 'object' ? address.port : undefined;
    return {
      schemaVersion: 1,
      enabled: this.options.enabled(),
      running: Boolean(this.server),
      host: LOOPBACK_HOST,
      ...(port ? { port, url: `http://${LOOPBACK_HOST}:${port}` } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      authenticated: true,
      capabilities: ['submit_goal', 'submit_proposal', 'get_status', 'cancel']
    };
  }

  public async dispose(): Promise<void> {
    await this.stop().catch(() => undefined);
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const method = String(request.method || 'GET').toUpperCase();
    let route = '/';
    let requestId: string | undefined;
    let requestDigest = digest(`${method}:unparsed`);
    try {
      this.validateNetworkRequest(request);
      await this.authenticate(request);
      this.consumeRateLimit();
      const url = new URL(String(request.url || '/'), `http://${LOOPBACK_HOST}`);
      route = url.pathname;
      if (url.search) throw new GatewayHttpError(400, 'query_not_allowed', 'Agent Gateway routes do not accept query parameters.');

      if (method === 'GET' && route === '/v1/capabilities') {
        requestDigest = digest(`${method}:${route}`);
        return this.respond(response, 200, {
          schemaVersion: 1,
          gatewayVersion: String(this.options.version || 'unknown'),
          capabilities: this.status().capabilities,
          deniedCapabilities: ['approve', 'answer_clarification', 'author_evidence', 'select_oracle', 'accept_diff', 'merge', 'attest', 'manage_keys', 'declare_success']
        }, { method, route, requestDigest, outcome: 'completed' });
      }

      const statusMatch = method === 'GET' ? route.match(/^\/v1\/sessions\/([A-Za-z0-9._-]{1,128})$/) : null;
      if (statusMatch) {
        const sessionId = statusMatch[1];
        requestDigest = digest(`${method}:${route}`);
        const view = await this.options.delegate.getStatus(sessionId);
        return this.respond(response, 200, view, { method, route: '/v1/sessions/:id', requestDigest, sessionId, outcome: 'completed' });
      }

      if (method !== 'POST') throw new GatewayHttpError(404, 'route_not_found', 'Agent Gateway route not found.');
      this.validateContentType(request);
      const body = await readJsonBody(request);
      requestId = boundedRequestId(body.requestId);
      requestDigest = digest(`${method}:${route}:${canonicalJson(body)}`);

      const replay = this.findReplay(requestId);
      if (replay) {
        if (replay.requestDigest !== requestDigest) throw new GatewayHttpError(409, 'replay_collision', 'The requestId was already used for different request content.');
        if (replay.status !== 'complete') throw new GatewayHttpError(409, 'request_in_progress', 'The matching request is still in progress.');
        return this.respond(response, replay.httpStatus || 200, replay.response, { method, route, requestId, requestDigest, outcome: 'completed' });
      }
      if (this.dispatching) throw new GatewayHttpError(409, 'gateway_busy', 'Another state-changing gateway request is in progress.');

      this.writeReplay({ requestId, requestDigest, status: 'pending', recordedAt: new Date().toISOString() });
      this.appendAudit({ method, route, requestId, requestDigest, outcome: 'accepted', httpStatus: 202 });
      this.dispatching = true;
      try {
        const result = await this.dispatchPost(route, body);
        ensureBoundedResponse(result);
        this.writeReplay({ requestId, requestDigest, status: 'complete', httpStatus: 200, response: result, recordedAt: new Date().toISOString() });
        return this.respond(response, 200, result, { method, route, requestId, requestDigest, sessionId: sessionIdFromBody(body), outcome: 'completed' });
      } catch (error: any) {
        const normalized = normalizeError(error);
        const payload = { error: normalized.code, message: normalized.message };
        this.writeReplay({ requestId, requestDigest, status: 'complete', httpStatus: normalized.httpStatus, response: payload, recordedAt: new Date().toISOString() });
        return this.respond(response, normalized.httpStatus, payload, { method, route, requestId, requestDigest, sessionId: sessionIdFromBody(body), outcome: 'failed', reasonCode: normalized.code });
      } finally {
        this.dispatching = false;
      }
    } catch (error: any) {
      const normalized = normalizeError(error);
      return this.respond(response, normalized.httpStatus, { error: normalized.code, message: normalized.message }, { method, route, requestId, requestDigest, outcome: 'rejected', reasonCode: normalized.code });
    }
  }

  private async dispatchPost(route: string, body: Record<string, unknown>): Promise<AgentGatewaySessionView> {
    if (route === '/v1/goals') {
      exactKeys(body, ['requestId', 'goal']);
      const goal = boundedString(body.goal, 'goal', 1, 20_000);
      return this.options.delegate.submitGoal({ requestId: boundedRequestId(body.requestId), goal });
    }
    const proposalMatch = route.match(/^\/v1\/sessions\/([A-Za-z0-9._-]{1,128})\/proposals$/);
    if (proposalMatch) {
      exactKeys(body, ['requestId', 'contractDigest', 'envelope']);
      const sessionId = proposalMatch[1];
      const contractDigest = boundedDigest(body.contractDigest, 'contractDigest');
      const envelope = normalizeEnvelope(body.envelope);
      return this.options.delegate.submitProposal({ requestId: boundedRequestId(body.requestId), sessionId, contractDigest, envelope });
    }
    const cancelMatch = route.match(/^\/v1\/sessions\/([A-Za-z0-9._-]{1,128})\/cancel$/);
    if (cancelMatch) {
      exactKeys(body, ['requestId']);
      return this.options.delegate.cancel({ requestId: boundedRequestId(body.requestId), sessionId: cancelMatch[1] });
    }
    throw new GatewayHttpError(404, 'route_not_found', 'Agent Gateway route not found.');
  }

  private validateNetworkRequest(request: http.IncomingMessage): void {
    const remote = String(request.socket.remoteAddress || '');
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(remote)) throw new GatewayHttpError(403, 'non_loopback_client', 'Agent Gateway accepts loopback clients only.');
    const host = String(request.headers.host || '');
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host)) throw new GatewayHttpError(403, 'invalid_host', 'Agent Gateway requires a literal 127.0.0.1 Host header.');
    if (request.headers.origin !== undefined) throw new GatewayHttpError(403, 'browser_origin_blocked', 'Browser-origin requests are not accepted by the Agent Gateway.');
  }

  private async authenticate(request: http.IncomingMessage): Promise<void> {
    const expected = String(await this.options.getToken() || '');
    const header = String(request.headers.authorization || '');
    const match = header.match(/^Bearer ([^\s]+)$/);
    if (!match || !constantTimeEqual(match[1], expected)) throw new GatewayHttpError(401, 'unauthorized', 'A valid Agent Gateway bearer token is required.');
  }

  private consumeRateLimit(): void {
    const now = Date.now();
    while (this.requestTimes.length && this.requestTimes[0] <= now - 60_000) this.requestTimes.shift();
    const cap = Math.max(1, Math.min(600, Math.floor(this.options.rateLimitPerMinute || 60)));
    if (this.requestTimes.length >= cap) throw new GatewayHttpError(429, 'rate_limited', `Agent Gateway rate limit (${cap}/minute) exceeded.`);
    this.requestTimes.push(now);
  }

  private validateContentType(request: http.IncomingMessage): void {
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw new GatewayHttpError(415, 'content_type_required', 'POST requests require application/json.');
  }

  private replayPath(): string { return path.join(this.options.workspaceRoot(), '.forge', 'agent-gateway', 'replay.json'); }
  private auditPath(): string { return path.join(this.options.workspaceRoot(), '.forge', 'agent-gateway', 'audit.jsonl'); }
  private statusPath(): string { return path.join(this.options.workspaceRoot(), '.forge', 'agent-gateway', 'status.json'); }

  private findReplay(requestId: string): ReplayEntry | undefined {
    return this.readReplay().find(item => item.requestId === requestId);
  }

  private readReplay(): ReplayEntry[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.replayPath(), 'utf8'));
      return Array.isArray(parsed?.entries) ? parsed.entries.slice(-MAX_REPLAY_ENTRIES) : [];
    } catch { return []; }
  }

  private writeReplay(entry: ReplayEntry): void {
    const entries = this.readReplay();
    const index = entries.findIndex(item => item.requestId === entry.requestId);
    if (index >= 0) entries[index] = entry; else entries.push(entry);
    writeJsonAtomic(this.replayPath(), { schemaVersion: 1, updatedAt: new Date().toISOString(), entries: entries.slice(-MAX_REPLAY_ENTRIES) });
  }

  private appendAudit(input: Omit<GatewayAuditEntry, 'schemaVersion' | 'id' | 'timestamp'>): void {
    const target = this.auditPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let lines: string[] = [];
    try { lines = fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).slice(-(MAX_AUDIT_ENTRIES - 1)); } catch { /* first event */ }
    const entry: GatewayAuditEntry = { schemaVersion: 1, id: `gateway-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, timestamp: new Date().toISOString(), ...input };
    fs.writeFileSync(target, `${[...lines, JSON.stringify(entry)].join('\n')}\n`, 'utf8');
  }

  private respond(response: http.ServerResponse, status: number, body: unknown, audit: Omit<GatewayAuditEntry, 'schemaVersion' | 'id' | 'timestamp' | 'httpStatus'>): void {
    const safe = ensureBoundedResponse(body);
    try { this.appendAudit({ ...audit, httpStatus: status }); } catch { /* transport responses must remain available after a best-effort rejection audit */ }
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(safe);
  }

  private persistStatus(): void {
    try { writeJsonAtomic(this.statusPath(), this.status()); } catch { /* status reporting cannot widen transport authority */ }
  }
}

export function generateAgentGatewayToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeEnvelope(value: unknown): SubmittedProposalEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GatewayHttpError(400, 'invalid_envelope', 'envelope must be an object.');
  const input = value as Record<string, unknown>;
  exactKeys(input, ['explanation', 'proposal', 'confidence', 'materialUncertainty', 'uncertainties']);
  if (!input.proposal || typeof input.proposal !== 'object' || Array.isArray(input.proposal)) throw new GatewayHttpError(400, 'invalid_envelope', 'envelope.proposal must be an object.');
  const proposal = input.proposal as Record<string, unknown>;
  exactKeys(proposal, ['name', 'arguments']);
  if (!proposal.arguments || typeof proposal.arguments !== 'object' || Array.isArray(proposal.arguments)) throw new GatewayHttpError(400, 'invalid_envelope', 'proposal.arguments must be an object.');
  validateJsonTree(proposal.arguments, 0);
  const confidence = input.confidence === undefined ? undefined : Number(input.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) throw new GatewayHttpError(400, 'invalid_envelope', 'confidence must be between 0 and 100.');
  const uncertainties = input.uncertainties === undefined ? [] : input.uncertainties;
  if (!Array.isArray(uncertainties) || uncertainties.length > 10) throw new GatewayHttpError(400, 'invalid_envelope', 'uncertainties must contain at most 10 strings.');
  return {
    explanation: boundedString(input.explanation, 'explanation', 1, 4_000),
    proposal: { name: boundedString(proposal.name, 'proposal.name', 1, 128) as any, arguments: JSON.parse(JSON.stringify(proposal.arguments)) },
    ...(confidence === undefined ? {} : { confidence }),
    materialUncertainty: input.materialUncertainty === true,
    uncertainties: uncertainties.map((item, index) => boundedString(item, `uncertainties[${index}]`, 1, 1_000))
  };
}

function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    request.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES && !rejected) {
        rejected = true;
        reject(new GatewayHttpError(413, 'payload_too_large', `Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        return;
      }
      if (!rejected) chunks.push(buffer);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GatewayHttpError(400, 'invalid_json', 'Request body must be a JSON object.');
        validateJsonTree(value, 0);
        resolve(value);
      } catch (error: any) {
        reject(error instanceof GatewayHttpError ? error : new GatewayHttpError(400, 'invalid_json', `Invalid JSON: ${String(error?.message || error)}`));
      }
    });
    request.on('error', error => reject(new GatewayHttpError(400, 'request_failed', String(error.message || error))));
  });
}

function validateJsonTree(value: unknown, depth: number): void {
  if (depth > MAX_JSON_DEPTH) throw new GatewayHttpError(400, 'json_too_deep', `JSON nesting exceeds ${MAX_JSON_DEPTH}.`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) throw new GatewayHttpError(400, 'forbidden_json_key', `JSON key '${key}' is forbidden.`);
    validateJsonTree(child, depth + 1);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new GatewayHttpError(400, 'unknown_field', `Unknown request field(s): ${extra.join(', ')}.`);
}

function boundedString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new GatewayHttpError(400, 'invalid_field', `${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new GatewayHttpError(400, 'invalid_field', `${field} must contain ${min}-${max} characters.`);
  return normalized;
}

function boundedRequestId(value: unknown): string {
  const id = boundedString(value, 'requestId', 1, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new GatewayHttpError(400, 'invalid_request_id', 'requestId must be a bounded opaque identifier.');
  return id;
}

function boundedDigest(value: unknown, field: string): string {
  const result = boundedString(value, field, 64, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new GatewayHttpError(400, 'invalid_digest', `${field} must be a SHA-256 hex digest.`);
  return result;
}

function sessionIdFromBody(body: Record<string, unknown>): string | undefined {
  return typeof body.sessionId === 'string' ? body.sessionId.slice(0, 128) : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function digest(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

function normalizePort(value: unknown): number {
  const port = value === undefined ? 43119 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024)) throw new Error('Agent Gateway port must be 0 or an integer from 1024 to 65535.');
  return port;
}

function normalizeError(error: any): GatewayHttpError {
  if (error instanceof GatewayHttpError) return error;
  const message = String(error?.message || error || 'Agent Gateway request failed.').slice(0, 2_000);
  const code = /^\[([a-z0-9_-]+)\]/i.exec(message)?.[1] || 'gateway_request_failed';
  return new GatewayHttpError(409, code, message);
}

function ensureBoundedResponse(value: unknown): string {
  validateJsonTree(value, 0);
  const json = JSON.stringify(value === undefined ? null : value);
  if (Buffer.byteLength(json, 'utf8') > MAX_RESPONSE_BYTES) throw new GatewayHttpError(500, 'response_too_large', 'Agent Gateway response exceeds its bounded contract.');
  return json;
}

function writeJsonAtomic(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, target);
}
