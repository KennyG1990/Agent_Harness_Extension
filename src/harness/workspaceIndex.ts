import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const WORKSPACE_INDEX_SCHEMA_VERSION = 1;
export const MAX_WORKSPACE_INDEX_FILES = 5_000;
const MAX_INDEXED_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SYMBOLS_PER_FILE = 40;
const EXCLUDED_SEGMENTS = new Set([
  '.git', '.forge', '.hg', '.svn', '.tmp', '.vscode-test', 'node_modules', 'vendor', 'out', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '__pycache__', 'target', 'bin', 'obj', 'artifacts', 'test-results', 'playwright-report'
]);
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.kt', '.kts',
  '.md', '.mjs', '.mts', '.php', '.ps1', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte', '.swift', '.toml',
  '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml'
]);
const TEXT_FILENAMES = new Set(['dockerfile', 'makefile', 'readme', 'license', 'agents.md', 'claude.md']);

export interface WorkspaceIndexSymbol {
  name: string;
  kind: string;
  line: number;
  declaration: string;
}

export interface WorkspaceIndexFile {
  path: string;
  bytes: number;
  modifiedMs: number;
  language: string;
  symbols: WorkspaceIndexSymbol[];
}

export interface WorkspaceIndexReport {
  schemaVersion: 1;
  workspaceId: string;
  generatedAt: string;
  status: 'ready';
  fileCount: number;
  symbolCount: number;
  ignoredCount: number;
  truncated: boolean;
  maxFiles: number;
  fingerprint: string;
  files: WorkspaceIndexFile[];
}

export interface WorkspaceIndexStatus {
  status: 'missing' | 'building' | 'ready' | 'stale' | 'error';
  fileCount: number;
  symbolCount: number;
  ignoredCount: number;
  truncated: boolean;
  generatedAt?: string;
  fingerprint?: string;
  error?: string;
}

export interface WorkspaceMentionCandidate {
  kind: 'file' | 'folder' | 'symbol';
  path: string;
  label: string;
  detail: string;
  symbolName?: string;
  line?: number;
  symbolKind?: string;
}

export interface WorkspaceMentionSearchResult {
  candidates: WorkspaceMentionCandidate[];
  provenance: 'ready' | 'stale' | 'missing';
  truncated: boolean;
}

export class WorkspaceIndexService {
  private readonly root: string;
  private readonly forgeDir: string;
  private readonly indexPath: string;
  private readonly stalePath: string;
  private building = false;
  private lastError?: string;

  constructor(workspaceRoot: string) {
    this.root = fs.realpathSync(workspaceRoot);
    this.forgeDir = path.join(this.root, '.forge');
    this.indexPath = path.join(this.forgeDir, 'workspace-index.json');
    this.stalePath = path.join(this.forgeDir, 'workspace-index-stale.json');
  }

  public build(): WorkspaceIndexReport {
    this.building = true;
    this.lastError = undefined;
    try {
      const scan = this.scanFiles();
      const files: WorkspaceIndexFile[] = [];
      for (const relativePath of scan.paths) {
        const absolutePath = path.join(this.root, ...relativePath.split('/'));
        try {
          const stat = fs.statSync(absolutePath);
          if (!stat.isFile() || stat.size > MAX_INDEXED_FILE_BYTES) {
            scan.ignoredCount += 1;
            continue;
          }
          const buffer = fs.readFileSync(absolutePath);
          if (buffer.subarray(0, 4096).includes(0)) {
            scan.ignoredCount += 1;
            continue;
          }
          const content = buffer.toString('utf8');
          files.push({
            path: relativePath,
            bytes: stat.size,
            modifiedMs: Math.trunc(stat.mtimeMs),
            language: languageForPath(relativePath),
            symbols: extractSymbols(relativePath, content)
          });
        } catch {
          scan.ignoredCount += 1;
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      const fingerprint = crypto.createHash('sha256').update(files.map(file => `${file.path}:${file.bytes}:${file.modifiedMs}`).join('\n')).digest('hex');
      const report: WorkspaceIndexReport = {
        schemaVersion: WORKSPACE_INDEX_SCHEMA_VERSION,
        workspaceId: workspaceId(this.root),
        generatedAt: new Date().toISOString(),
        status: 'ready',
        fileCount: files.length,
        symbolCount: files.reduce((sum, file) => sum + file.symbols.length, 0),
        ignoredCount: scan.ignoredCount,
        truncated: scan.truncated,
        maxFiles: MAX_WORKSPACE_INDEX_FILES,
        fingerprint,
        files
      };
      fs.mkdirSync(this.forgeDir, { recursive: true });
      writeJsonAtomic(this.indexPath, report);
      fs.rmSync(this.stalePath, { force: true });
      return report;
    } catch (error: any) {
      this.lastError = String(error?.message || error).slice(0, 500);
      throw error;
    } finally {
      this.building = false;
    }
  }

  public load(): WorkspaceIndexReport | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as WorkspaceIndexReport;
      if (parsed.schemaVersion !== WORKSPACE_INDEX_SCHEMA_VERSION || parsed.workspaceId !== workspaceId(this.root) || parsed.status !== 'ready') return null;
      if (!Array.isArray(parsed.files) || parsed.files.length > MAX_WORKSPACE_INDEX_FILES || parsed.fileCount !== parsed.files.length) return null;
      let symbolCount = 0;
      for (const file of parsed.files) {
        if (!isSafeRelativePath(file.path) || isExcludedPath(file.path) || !Array.isArray(file.symbols) || file.symbols.length > MAX_SYMBOLS_PER_FILE) return null;
        const absolutePath = path.resolve(this.root, ...file.path.split('/'));
        if (!isContained(this.root, absolutePath)) return null;
        if (fs.existsSync(absolutePath)) {
          if (fs.lstatSync(absolutePath).isSymbolicLink() || !isContained(this.root, fs.realpathSync(absolutePath))) return null;
        }
        symbolCount += file.symbols.length;
      }
      if (parsed.symbolCount !== symbolCount) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public status(): WorkspaceIndexStatus {
    if (this.building) return { status: 'building', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false };
    if (this.lastError) return { status: 'error', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false, error: this.lastError };
    const report = this.load();
    if (!report) return { status: 'missing', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false };
    return {
      status: fs.existsSync(this.stalePath) ? 'stale' : 'ready',
      fileCount: report.fileCount,
      symbolCount: report.symbolCount,
      ignoredCount: report.ignoredCount,
      truncated: report.truncated,
      generatedAt: report.generatedAt,
      fingerprint: report.fingerprint
    };
  }

  public markStale(reason = 'workspace_changed'): WorkspaceIndexStatus {
    const report = this.load();
    if (!report) return this.status();
    fs.mkdirSync(this.forgeDir, { recursive: true });
    writeJsonAtomic(this.stalePath, { reason: String(reason).slice(0, 120), markedAt: new Date().toISOString(), fingerprint: report.fingerprint });
    return this.status();
  }

  public getArtifactPath(): string {
    return this.indexPath;
  }

  public searchMentions(query: string, limit = 20): WorkspaceMentionSearchResult {
    const report = this.load();
    if (!report) return { candidates: [], provenance: 'missing', truncated: false };
    const normalizedQuery = String(query || '').trim().toLowerCase().slice(0, 120);
    const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 20)));
    const candidates = new Map<string, WorkspaceMentionCandidate>();
    for (const file of report.files) {
      candidates.set(`file:${file.path}`, {
        kind: 'file', path: file.path, label: path.posix.basename(file.path), detail: `${file.path} · ${file.language}`
      });
      const segments = file.path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const folderPath = segments.slice(0, index).join('/');
        candidates.set(`folder:${folderPath}`, {
          kind: 'folder', path: folderPath, label: `${segments[index - 1]}/`, detail: `${folderPath}/ · folder`
        });
      }
      for (const symbol of file.symbols) {
        candidates.set(`symbol:${file.path}:${symbol.line}:${symbol.name}`, {
          kind: 'symbol',
          path: file.path,
          label: symbol.name,
          detail: `${file.path}:${symbol.line} · ${symbol.kind}`,
          symbolName: symbol.name,
          line: symbol.line,
          symbolKind: symbol.kind
        });
      }
    }
    const ranked = [...candidates.values()]
      .map(candidate => ({ candidate, score: mentionScore(candidate, normalizedQuery) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path));
    return {
      candidates: ranked.slice(0, boundedLimit).map(item => item.candidate),
      provenance: fs.existsSync(this.stalePath) ? 'stale' : 'ready',
      truncated: ranked.length > boundedLimit || report.truncated
    };
  }

  private scanFiles(): { paths: string[]; ignoredCount: number; truncated: boolean } {
    const paths: string[] = [];
    let ignoredCount = 0;
    let truncated = false;
    const walk = (directory: string): void => {
      if (truncated) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { ignoredCount += 1; return; }
      for (const entry of entries) {
        if (truncated) break;
        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.relative(this.root, absolutePath).replace(/\\/g, '/');
        if (entry.isSymbolicLink() || isExcludedPath(relativePath)) { ignoredCount += 1; continue; }
        if (entry.isDirectory()) { walk(absolutePath); continue; }
        if (!entry.isFile() || !isTextCandidate(relativePath)) { ignoredCount += 1; continue; }
        if (paths.length >= MAX_WORKSPACE_INDEX_FILES) { truncated = true; break; }
        paths.push(relativePath);
      }
    };
    walk(this.root);
    return { paths, ignoredCount, truncated };
  }
}

function mentionScore(candidate: WorkspaceMentionCandidate, query: string): number {
  if (!query) return candidate.kind === 'folder' ? 30 : candidate.kind === 'symbol' ? 35 : 40;
  const label = candidate.label.toLowerCase();
  const candidatePath = candidate.path.toLowerCase();
  if (label === query || candidatePath === query) return candidate.kind === 'symbol' ? 340 : 300;
  if (label.startsWith(query)) return candidate.kind === 'symbol' ? 250 : 220;
  if (candidatePath.startsWith(query)) return 180;
  if (label.includes(query)) return 140;
  if (candidatePath.includes(query)) return 100;
  const tokens = query.split(/[\\/._-]+/).filter(Boolean);
  if (tokens.length && tokens.every(token => candidatePath.includes(token))) return 60;
  return -1;
}

function extractSymbols(relativePath: string, content: string): WorkspaceIndexSymbol[] {
  const language = languageForPath(relativePath);
  const patterns = language === 'python'
    ? [{ kind: 'class', re: /^\s*class\s+([A-Za-z_$][\w$]*)/ }, { kind: 'function', re: /^\s*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/ }]
    : language === 'go'
      ? [{ kind: 'function', re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/ }, { kind: 'type', re: /^\s*type\s+([A-Za-z_$][\w$]*)/ }]
      : language === 'rust'
        ? [{ kind: 'function', re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_$][\w$]*)/ }, { kind: 'type', re: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_$][\w$]*)/ }]
        : [{ kind: 'declaration', re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|function|const|let|var|enum|type)\s+([A-Za-z_$][\w$]*)/ }];
  const symbols: WorkspaceIndexSymbol[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const pattern of patterns) {
      const match = pattern.re.exec(line);
      if (!match) continue;
      symbols.push({ name: match[1], kind: pattern.kind, line: index + 1, declaration: `${pattern.kind} ${match[1]}` });
      break;
    }
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }
  return symbols;
}

function languageForPath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.py') return 'python';
  if (extension === '.go') return 'go';
  if (extension === '.rs') return 'rust';
  if (['.ts', '.tsx'].includes(extension)) return 'typescript';
  if (['.js', '.jsx', '.mjs', '.mts'].includes(extension)) return 'javascript';
  return extension.slice(1) || 'text';
}

function isTextCandidate(relativePath: string): boolean {
  const base = path.basename(relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(path.extname(base)) || TEXT_FILENAMES.has(base);
}

function isExcludedPath(relativePath: string): boolean {
  return relativePath.split('/').some(segment => EXCLUDED_SEGMENTS.has(segment.toLowerCase()));
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value) || value.includes('\\')) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function isContained(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function workspaceId(root: string): string {
  return crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
}

function writeJsonAtomic(target: string, value: unknown): void {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}
