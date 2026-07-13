import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type ComposerContextKind = 'file' | 'folder' | 'selection' | 'diagnostics' | 'symbol' | 'image';

export interface ComposerContextAttachment {
  id: string;
  kind: ComposerContextKind;
  label: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  diagnosticCount?: number;
  symbolName?: string;
  neighborPaths?: string[];
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256?: string;
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
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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

  public captureSymbol(filePath: string, symbolName: string, line: number, indexedFiles: Array<{ path: string }>): ComposerContextAttachment {
    const resolved = this.resolveContainedFile(filePath);
    const name = String(symbolName || '').trim().slice(0, 200);
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('Symbol name is invalid.');
    const sourceLines = fs.readFileSync(resolved.absolutePath, 'utf8').split(/\r?\n/);
    const declarationLine = positiveLine(line);
    if (declarationLine > sourceLines.length || !new RegExp(`\\b${escapeRegExp(name)}\\b`).test(sourceLines[declarationLine - 1] || '')) {
      throw new Error('The indexed symbol declaration is stale. Rebuild the workspace index.');
    }
    const declarationStart = Math.max(1, declarationLine - 12);
    const declarationEnd = Math.min(sourceLines.length, declarationLine + 28);
    const sections = [`### Declaration ${resolved.relativePath}:${declarationLine}\n${numberedWindow(sourceLines, declarationStart, declarationEnd)}`];
    const neighborPaths: string[] = [];
    const word = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    for (const item of indexedFiles) {
      if (neighborPaths.length >= 4 || item.path === resolved.relativePath) continue;
      let neighbor: { absolutePath: string; relativePath: string };
      try { neighbor = this.resolveContainedFile(item.path); } catch { continue; }
      let lines: string[];
      try { lines = fs.readFileSync(neighbor.absolutePath, 'utf8').split(/\r?\n/); } catch { continue; }
      const hit = lines.findIndex(candidate => word.test(candidate));
      if (hit < 0) continue;
      const start = Math.max(1, hit + 1 - 3);
      const end = Math.min(lines.length, hit + 1 + 5);
      sections.push(`### Exact-name neighbor ${neighbor.relativePath}:${hit + 1}\n${numberedWindow(lines, start, end)}`);
      neighborPaths.push(neighbor.relativePath);
    }
    const content = boundedText(sections.join('\n\n'), MAX_ATTACHMENT_BYTES);
    return this.makeAttachment('symbol', `${name} · ${resolved.relativePath}:${declarationLine}`, content, {
      path: resolved.relativePath,
      lineStart: declarationLine,
      lineEnd: declarationLine,
      symbolName: name,
      neighborPaths
    });
  }

  public captureImage(filePath: string): ComposerContextAttachment {
    const resolved = this.resolveContainedFile(filePath);
    const extension = path.extname(resolved.relativePath).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : undefined;
    if (!mimeType) throw new Error('Forge image context supports PNG, JPEG, and WebP only.');
    const bytes = fs.readFileSync(resolved.absolutePath);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image context must be between 1 byte and 2 MiB.');
    if (!matchesImageSignature(bytes, mimeType)) throw new Error('Image bytes do not match the selected image format.');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const content = `Host-owned image attachment: ${resolved.relativePath}\nMIME: ${mimeType}\nSHA-256: ${sha256}\nBytes: ${bytes.length}\nRaw bytes are supplied transiently only to a selected vision-capable model.`;
    return this.makeAttachment('image', path.basename(resolved.relativePath), content, { path: resolved.relativePath, mimeType, sha256, byteCount: bytes.length });
  }

  public providerImageParts(attachments: unknown): Array<{ type: 'image_url'; image_url: { url: string } }> {
    const parts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
    for (const item of this.normalizeList(attachments).filter(attachment => attachment.kind === 'image')) {
      const resolved = this.resolveContainedFile(item.path || '');
      const bytes = fs.readFileSync(resolved.absolutePath);
      if (!item.mimeType || !item.sha256 || bytes.length > MAX_IMAGE_BYTES || !matchesImageSignature(bytes, item.mimeType)) throw new Error('Persisted image context failed format or size revalidation.');
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Persisted image context changed after capture. Remove it and attach the current image.');
      parts.push({ type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${bytes.toString('base64')}` } });
    }
    return parts;
  }

  public normalizeList(raw: unknown): ComposerContextAttachment[] {
    if (!Array.isArray(raw)) return [];
    const accepted: ComposerContextAttachment[] = [];
    let totalBytes = 0;
    const ids = new Set<string>();
    for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
      const normalized = this.normalizePersisted(item);
      if (!normalized || ids.has(normalized.id)) continue;
      const budgetBytes = normalized.kind === 'image' ? 0 : normalized.byteCount;
      if (totalBytes + budgetBytes > MAX_TOTAL_BYTES) break;
      ids.add(normalized.id);
      totalBytes += budgetBytes;
      accepted.push(normalized);
    }
    return accepted;
  }

  public append(existing: unknown, attachment: ComposerContextAttachment): ComposerContextAttachment[] {
    const current = this.normalizeList(existing).filter(item => item.id !== attachment.id);
    const next = [...current, this.normalizePersisted(attachment)].filter(Boolean) as ComposerContextAttachment[];
    if (next.length > MAX_ATTACHMENTS) throw new Error(`Forge supports at most ${MAX_ATTACHMENTS} context attachments per session.`);
    if (next.reduce((sum, item) => sum + (item.kind === 'image' ? 0 : item.byteCount), 0) > MAX_TOTAL_BYTES) throw new Error('Context attachments exceed the 192 KiB text-session limit. Remove an item before adding another.');
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
    const contentByteCount = Buffer.byteLength(content, 'utf8');
    const identity = `${kind}\0${extra.path || ''}\0${extra.lineStart || ''}\0${extra.lineEnd || ''}\0${extra.mimeType || ''}\0${extra.sha256 || ''}\0${content}`;
    return {
      id: `ctx-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)}`,
      kind,
      label: String(label || kind).slice(0, 120),
      byteCount: contentByteCount,
      capturedAt,
      content,
      ...extra
    };
  }

  private normalizePersisted(raw: any): ComposerContextAttachment | null {
    if (!raw || !['file', 'folder', 'selection', 'diagnostics', 'symbol', 'image'].includes(raw.kind)) return null;
    const kind = raw.kind as ComposerContextKind;
    const content = boundedText(raw.content, MAX_ATTACHMENT_BYTES);
    if (!content.trim()) return null;
    const contentByteCount = Buffer.byteLength(content, 'utf8');
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
    const lineStart = kind === 'selection' || kind === 'symbol' ? positiveLine(raw.lineStart) : undefined;
    const lineEnd = kind === 'selection' || kind === 'symbol' ? Math.max(lineStart!, positiveLine(raw.lineEnd)) : undefined;
    const diagnosticCount = kind === 'diagnostics' ? Math.min(MAX_DIAGNOSTICS, Math.max(1, Number(raw.diagnosticCount) || content.split('\n').length)) : undefined;
    const symbolName = kind === 'symbol' ? String(raw.symbolName || '').trim().slice(0, 200) : undefined;
    if (kind === 'symbol' && !/^[A-Za-z_$][\w$]*$/.test(symbolName || '')) return null;
    const neighborPaths: string[] | undefined = kind === 'symbol' && Array.isArray(raw.neighborPaths)
      ? raw.neighborPaths.map((item: unknown) => String(item || '').replace(/\\/g, '/')).filter((item: string) => isSafeRelativePath(item)).slice(0, 4)
      : undefined;
    if (neighborPaths?.some((item: string) => { try { this.resolveContainedFile(item); return false; } catch { return true; } })) return null;
    const mimeType = kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(raw.mimeType) ? raw.mimeType as ComposerContextAttachment['mimeType'] : undefined;
    const sha256 = kind === 'image' && /^[a-f0-9]{64}$/.test(String(raw.sha256 || '')) ? String(raw.sha256) : undefined;
    const byteCount = kind === 'image' ? Math.floor(Number(raw.byteCount || 0)) : contentByteCount;
    if (kind === 'image' && (!mimeType || !sha256 || byteCount < 1 || byteCount > MAX_IMAGE_BYTES || contentByteCount > 2_000)) return null;
    const expected = this.makeAttachment(kind, String(raw.label || kind), content, { path: pathValue, lineStart, lineEnd, diagnosticCount, symbolName, neighborPaths, mimeType, sha256, byteCount });
    if (typeof raw.id === 'string' && raw.id !== expected.id) return null;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numberedWindow(lines: string[], start: number, end: number): string {
  return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
}

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}
