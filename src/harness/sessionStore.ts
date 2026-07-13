import * as fs from 'fs';
import * as path from 'path';
import { HarnessState } from './types';
import { ComposerContextAttachment, ComposerContextService } from './composerContext';

export interface SessionSummary {
  sessionId: string;
  kind: 'run' | 'chat';
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  status: string;
  steps: number;
  costUsd: number;
  resumable: boolean;
}

export interface SessionListResult {
  sessions: SessionSummary[];
  corruptCount: number;
}

export interface LoadedSession {
  state?: HarnessState;
  meta: SessionSummary;
  chat: Array<{ role: 'user' | 'assistant'; content: string; modelId?: string; error?: boolean }>;
  context: ComposerContextAttachment[];
}

const SESSION_ID = /^forge-[a-z0-9][a-z0-9._:-]{3,119}$/;
const RESUMABLE = new Set(['idle', 'running', 'paused']);
const MAX_INDEX = 200;
const MAX_STATE_BYTES = 20 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;
const MAX_CHAT_BYTES = 1024 * 1024;

export class SessionStore {
  private readonly forgeRoot: string;
  private readonly sessionsRoot: string;

  constructor(private readonly workspaceRoot: string) {
    this.forgeRoot = path.join(path.resolve(workspaceRoot), '.forge');
    this.sessionsRoot = path.join(this.forgeRoot, 'sessions');
  }

  public list(): SessionListResult {
    fs.mkdirSync(this.sessionsRoot, { recursive: true });
    const sessions: SessionSummary[] = [];
    let corruptCount = 0;
    for (const entry of fs.readdirSync(this.sessionsRoot, { withFileTypes: true })) {
      if (!entry.name.startsWith('forge-')) continue;
      try {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe session directory');
        sessions.push(this.readValidated(entry.name).meta);
      } catch {
        corruptCount += 1;
      }
    }
    sessions.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    const bounded = sessions.slice(0, MAX_INDEX);
    this.writeJsonAtomic(path.join(this.sessionsRoot, 'index.json'), bounded);
    return { sessions: bounded, corruptCount };
  }

  public load(sessionId: string, makeActive = false): LoadedSession {
    const loaded = this.readValidated(sessionId);
    if (makeActive) {
      if (loaded.state) this.writeJsonAtomic(path.join(this.forgeRoot, 'state.json'), loaded.state);
      this.writeJsonAtomic(path.join(this.forgeRoot, 'active-session.json'), { sessionId: loaded.meta.sessionId, kind: loaded.meta.kind, updatedAt: new Date().toISOString() });
    }
    return loaded;
  }

  public createChat(title: string): LoadedSession {
    const sessionId = `forge-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const dir = this.sessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    this.writeJsonAtomic(path.join(dir, 'meta.json'), { sessionId, kind: 'chat', title: boundedText(title, 80) || 'New conversation', pinned: false, createdAt: now, updatedAt: now });
    this.writeJsonAtomic(path.join(dir, 'chat.json'), []);
    this.writeJsonAtomic(path.join(dir, 'context.json'), []);
    return this.load(sessionId, true);
  }

  public loadActive(): LoadedSession | null {
    try {
      const pointer = this.readJson(path.join(this.forgeRoot, 'active-session.json'), MAX_META_BYTES);
      return this.load(String(pointer.sessionId || ''), false);
    } catch {
      return null;
    }
  }

  public pin(sessionId: string, pinned: boolean): SessionListResult {
    const loaded = this.readValidated(sessionId);
    const metaPath = path.join(this.sessionDir(sessionId), 'meta.json');
    this.writeJsonAtomic(metaPath, { ...loaded.meta, pinned: pinned === true, updatedAt: new Date().toISOString() });
    return this.list();
  }

  public saveChat(sessionId: string, messages: unknown): void {
    this.readValidated(sessionId);
    const sanitized = sanitizeChat(messages);
    this.writeJsonAtomic(path.join(this.sessionDir(sessionId), 'chat.json'), sanitized);
  }

  public saveContext(sessionId: string, attachments: unknown): ComposerContextAttachment[] {
    this.readValidated(sessionId);
    const normalized = new ComposerContextService(this.workspaceRoot).normalizeList(attachments);
    this.writeJsonAtomic(path.join(this.sessionDir(sessionId), 'context.json'), normalized);
    return normalized;
  }

  public delete(sessionId: string, activeSessionId?: string): SessionListResult {
    this.assertSessionId(sessionId);
    if (sessionId === activeSessionId) throw new Error('The active session cannot be deleted. Open another session or start a new run first.');
    const dir = this.sessionDir(sessionId);
    if (!fs.existsSync(dir)) throw new Error('Forge session does not exist.');
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe session directory.');
    this.readValidated(sessionId);
    fs.rmSync(dir, { recursive: true, force: false });
    return this.list();
  }

  private readValidated(sessionId: string): LoadedSession {
    this.assertSessionId(sessionId);
    const dir = this.sessionDir(sessionId);
    if (!fs.existsSync(dir)) throw new Error('Forge session does not exist.');
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe session directory.');
    let rawMeta: any = {};
    try { rawMeta = this.readJson(path.join(dir, 'meta.json'), MAX_META_BYTES); } catch { rawMeta = {}; }
    const kind: 'run' | 'chat' = rawMeta.kind === 'chat' ? 'chat' : 'run';
    let state: HarnessState | undefined;
    if (kind === 'run') {
      state = this.readJson(path.join(dir, 'state.json'), MAX_STATE_BYTES) as HarnessState;
      if (!state || state.sessionId !== sessionId || !state.goalContract || !state.taskGraph || typeof state.status !== 'string') {
        throw new Error('Session state identity or schema is invalid.');
      }
    } else if (rawMeta.sessionId !== sessionId) {
      throw new Error('Session metadata identity is invalid.');
    }
    const now = new Date().toISOString();
    const updatedAt = isoOr(rawMeta.updatedAt, now);
    const meta: SessionSummary = {
      sessionId,
      kind,
      title: boundedText(rawMeta.title || state?.goalContract.goal || 'Untitled run', 80),
      pinned: rawMeta.pinned === true,
      createdAt: isoOr(rawMeta.createdAt, updatedAt),
      updatedAt,
      status: kind === 'chat' ? 'chat' : boundedToken(state?.status, 32),
      steps: nonNegative(state?.currentStepIndex),
      costUsd: nonNegative(state?.goalContract.spent),
      resumable: kind === 'run' && RESUMABLE.has(String(state?.status || ''))
    };
    let chat: LoadedSession['chat'] = [];
    try { chat = sanitizeChat(this.readJson(path.join(dir, 'chat.json'), MAX_CHAT_BYTES)); } catch { chat = []; }
    let context: ComposerContextAttachment[] = [];
    try { context = new ComposerContextService(this.workspaceRoot).normalizeList(this.readJson(path.join(dir, 'context.json'), MAX_CHAT_BYTES)); } catch { context = []; }
    if (!context.length && state?.userContext?.length) context = new ComposerContextService(this.workspaceRoot).normalizeList(state.userContext);
    return { state, meta, chat, context };
  }

  private sessionDir(sessionId: string): string {
    this.assertSessionId(sessionId);
    return path.join(this.sessionsRoot, sessionId);
  }

  private assertSessionId(sessionId: string): void {
    if (!SESSION_ID.test(String(sessionId || ''))) throw new Error('Invalid Forge session ID.');
  }

  private readJson(filePath: string, maxBytes: number): any {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Session artifact is missing or exceeds its size limit.');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
  }
}

function sanitizeChat(messages: unknown): LoadedSession['chat'] {
  if (!Array.isArray(messages)) return [];
  const accepted: LoadedSession['chat'] = [];
  let bytes = 0;
  for (const raw of messages.slice(-500).reverse()) {
    if (!raw || (raw.role !== 'user' && raw.role !== 'assistant')) continue;
    const content = boundedText(raw.content, 20_000);
    if (!content) continue;
    const item = {
      role: raw.role,
      content,
      ...(typeof raw.modelId === 'string' ? { modelId: boundedToken(raw.modelId, 160) } : {}),
      ...(raw.error === true ? { error: true } : {})
    } as LoadedSession['chat'][number];
    const itemBytes = Buffer.byteLength(JSON.stringify(item));
    if (bytes + itemBytes > MAX_CHAT_BYTES) break;
    bytes += itemBytes;
    accepted.push(item);
  }
  return accepted.reverse();
}

function boundedText(value: unknown, max: number): string {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function boundedToken(value: unknown, max: number): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_./:@+-]/g, '_').slice(0, max);
}

function nonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isoOr(value: unknown, fallback: string): string {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}
