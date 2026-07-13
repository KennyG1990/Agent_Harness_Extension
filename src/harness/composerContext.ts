import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ComposerContextKind = 'file' | 'folder' | 'selection' | 'diagnostics';

export interface ComposerContextAttachment {
  id: string;
  kind: ComposerContextKind;
  label: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  diagnosticCount?: number;
  byteCount: number;
  capturedAt: string;
  content: string;
}

export type ComposerContextSummary = Omit<ComposerContextAttachment, 'content'>;

const MAX_ATTACHMENTS = 12;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 192 * 1024;
const MAX_DIAGNOSTICS = 100;
const MAX_FOLDER_PATHS = 500;

export class ComposerContextService {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = fs.realpathSync(path.resolve(workspaceRoot));
  }

  public captureFile(filePath: string): ComposerContextAttachment {
    const resolved = this.resolveContainedFile(filePath);
    const content = readBoundedText(resolved.absolutePath);
    return this.makeAttachment('file', path.basename(resolved.relativePath), content, {
      path: resolved.relativePath
    });
  }

  public captureSelection(filePath: string, lineStart: number, lineEnd: number, text: string): ComposerContextAttachment {
    const resolved = this.resolveContainedFile(filePath);
    const start = positiveLine(lineStart);
    const end = Math.max(start, positiveLine(lineEnd));
    const content = boundedText(text, MAX_ATTACHMENT_BYTES);
    if (!content.trim()) throw new Error('Select non-empty text before attaching a selection.');
    return this.makeAttachment('selection', `${path.basename(resolved.relativePath)}:${start}-${end}`, content, {
      path: resolved.relativePath,
      lineStart: start,
      lineEnd: end
    });
  }

  public captureFolder(folderPath: string, indexedPaths: string[]): ComposerContextAttachment {
    const resolved = this.resolveContainedDirectory(folderPath);
    const prefix = `${resolved.relativePath}/`;
    const paths = [...new Set((Array.isArray(indexedPaths) ? indexedPaths : [])
      .map(item => String(item || '').replace(/\\/g, '/'))
      .filter(item => isSafeRelativePath(item) && item.startsWith(prefix)))]
      .sort()
      .slice(0, MAX_FOLDER_PATHS);
    if (!paths.length) throw new Error('The selected folder has no indexed source or text files.');
    const content = boundedText(paths.join('\n'), MAX_ATTACHMENT_BYTES);
    return this.makeAttachment('folder', `${path.posix.basename(resolved.relativePath)}/ (${paths.length} files)`, content, {
      path: resolved.relativePath
    });
  }

  public captureDiagnostics(entries: Array<{ path: string; line: number; severity: string; message: string }>): ComposerContextAttachment {
    const accepted: string[] = [];
    for (const entry of entries.slice(0, MAX_DIAGNOSTICS)) {
      let relativePath: string;
      try { relativePath = this.resolveContainedFile(entry.path).relativePath; } catch { continue; }
      const message = String(entry.message || '').replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 500);
      if (!message) continue;
      const severity = String(entry.severity || 'unknown').replace(/[^a-z]/gi, '').toLowerCase().slice(0, 16) || 'unknown';
      accepted.push(`${relativePath}:${positiveLine(entry.line)} [${severity}] ${message}`);
    }
    if (!accepted.length) throw new Error('No workspace diagnostics are currently available.');
    return this.makeAttachment('diagnostics', `Diagnostics (${accepted.length})`, accepted.join('\n'), { diagnosticCount: accepted.length });
  }

  public normalizeList(raw: unknown): ComposerContextAttachment[] {
    if (!Array.isArray(raw)) return [];
    const accepted: ComposerContextAttachment[] = [];
    let totalBytes = 0;
    const ids = new Set<string>();
    for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
      const normalized = this.normalizePersisted(item);
      if (!normalized || ids.has(normalized.id)) continue;
      if (totalBytes + normalized.byteCount > MAX_TOTAL_BYTES) break;
      ids.add(normalized.id);
      totalBytes += normalized.byteCount;
      accepted.push(normalized);
    }
    return accepted;
  }

  public append(existing: unknown, attachment: ComposerContextAttachment): ComposerContextAttachment[] {
    const current = this.normalizeList(existing).filter(item => item.id !== attachment.id);
    const next = [...current, this.normalizePersisted(attachment)].filter(Boolean) as ComposerContextAttachment[];
    if (next.length > MAX_ATTACHMENTS) throw new Error(`Forge supports at most ${MAX_ATTACHMENTS} context attachments per session.`);
    if (next.reduce((sum, item) => sum + item.byteCount, 0) > MAX_TOTAL_BYTES) throw new Error('Context attachments exceed the 192 KiB session limit. Remove an item before adding another.');
    return next;
  }

  public summaries(attachments: unknown): ComposerContextSummary[] {
    return this.normalizeList(attachments).map(({ content: _content, ...summary }) => summary);
  }

  public renderForPrompt(attachments: unknown): string {
    return this.normalizeList(attachments).map(item => {
      const location = item.path ? `\nWorkspace path: ${item.path}${item.lineStart ? ` lines ${item.lineStart}-${item.lineEnd}` : ''}` : '';
      return `### Attached ${item.kind}: ${item.label}${location}\n${item.content}`;
    }).join('\n\n');
  }

  private makeAttachment(kind: ComposerContextKind, label: string, content: string, extra: Partial<ComposerContextAttachment>): ComposerContextAttachment {
    const capturedAt = new Date().toISOString();
    const byteCount = Buffer.byteLength(content, 'utf8');
    const identity = `${kind}\0${extra.path || ''}\0${extra.lineStart || ''}\0${extra.lineEnd || ''}\0${content}`;
    return {
      id: `ctx-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)}`,
      kind,
      label: String(label || kind).slice(0, 120),
      byteCount,
      capturedAt,
      content,
      ...extra
    };
  }

  private normalizePersisted(raw: any): ComposerContextAttachment | null {
    if (!raw || !['file', 'folder', 'selection', 'diagnostics'].includes(raw.kind)) return null;
    const kind = raw.kind as ComposerContextKind;
    const content = boundedText(raw.content, MAX_ATTACHMENT_BYTES);
    if (!content.trim()) return null;
    const byteCount = Buffer.byteLength(content, 'utf8');
    const pathValue = typeof raw.path === 'string' ? raw.path.replace(/\\/g, '/') : undefined;
    if (kind !== 'diagnostics') {
      if (!pathValue || path.isAbsolute(pathValue)) return null;
      try {
        if (kind === 'folder') this.resolveContainedDirectory(pathValue);
        else this.resolveContainedFile(pathValue);
      } catch { return null; }
    }
    if (kind === 'folder') {
      const prefix = `${pathValue}/`;
      const manifestPaths = content.split('\n').filter(Boolean);
      if (!manifestPaths.length || manifestPaths.length > MAX_FOLDER_PATHS || manifestPaths.some(item => !isSafeRelativePath(item) || !item.startsWith(prefix))) return null;
    }
    const lineStart = kind === 'selection' ? positiveLine(raw.lineStart) : undefined;
    const lineEnd = kind === 'selection' ? Math.max(lineStart!, positiveLine(raw.lineEnd)) : undefined;
    const diagnosticCount = kind === 'diagnostics' ? Math.min(MAX_DIAGNOSTICS, Math.max(1, Number(raw.diagnosticCount) || content.split('\n').length)) : undefined;
    const expected = this.makeAttachment(kind, String(raw.label || kind), content, { path: pathValue, lineStart, lineEnd, diagnosticCount });
    return { ...expected, capturedAt: validIso(raw.capturedAt) || expected.capturedAt };
  }

  private resolveContainedFile(filePath: string): { absolutePath: string; relativePath: string } {
    const candidate = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(this.workspaceRoot, filePath);
    const relative = path.relative(this.workspaceRoot, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Context file must be inside the open workspace.');
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Context attachment must be a regular non-symlink file.');
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(this.workspaceRoot, real);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Context file resolves outside the open workspace.');
    return { absolutePath: real, relativePath: realRelative.replace(/\\/g, '/') };
  }

  private resolveContainedDirectory(folderPath: string): { absolutePath: string; relativePath: string } {
    const candidate = path.isAbsolute(folderPath) ? path.resolve(folderPath) : path.resolve(this.workspaceRoot, folderPath);
    const relative = path.relative(this.workspaceRoot, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Context folder must be inside the open workspace.');
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Context attachment must be a regular non-symlink folder.');
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(this.workspaceRoot, real);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Context folder resolves outside the open workspace.');
    return { absolutePath: real, relativePath: realRelative.replace(/\\/g, '/') };
  }
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value) && !path.posix.isAbsolute(value) && !value.split('/').some(segment => !segment || segment === '.' || segment === '..');
}

function readBoundedText(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Context files must be 64 KiB or smaller. Select a focused range instead.');
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) throw new Error('Binary files cannot be attached as model context.');
  return boundedText(buffer.toString('utf8'), MAX_ATTACHMENT_BYTES);
}

function boundedText(value: unknown, maxBytes: number): string {
  const input = String(value || '').replace(/\u0000/g, '');
  const buffer = Buffer.from(input, 'utf8');
  return buffer.length <= maxBytes ? input : buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/g, '');
}

function positiveLine(value: unknown): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function validIso(value: unknown): string | undefined {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
