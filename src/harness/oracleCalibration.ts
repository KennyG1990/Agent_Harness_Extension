import { exec } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectProjectAdapter } from './projectAdapters';

export const ORACLE_CALIBRATION_POLICY_VERSION = 1;
export const AUDITED_ORACLE_SENSITIVITY_FLOOR = 0.80;
export const AUDITED_ORACLE_MIN_MUTANTS = 5;

const MAX_FILES = 5_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_MUTANTS = 20;
const EXCLUDED_DIRS = new Set(['.git', '.forge', 'node_modules', 'out', 'dist', 'build', 'coverage', 'artifacts', '.vscode-test', '.cache']);
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);

export interface OracleCalibrationMutantV1 {
  id: string;
  relativePath: string;
  operator: string;
  status: 'killed' | 'survived' | 'error';
  durationMs: number;
  outputDigest: string;
}

export interface OracleCalibrationReportV1 {
  schemaVersion: 1;
  policyVersion: number;
  calibrationId: string;
  generatedAt: string;
  status: 'pass' | 'below_floor' | 'unsupported' | 'baseline_red' | 'baseline_flaky' | 'workspace_drift' | 'cleanup_failed' | 'tampered';
  ecosystem: string;
  adapterFingerprint: string;
  testCommand: string;
  testSuiteDigest: string;
  workspaceIdentityHash: string;
  floor: number;
  minimumMutants: number;
  candidateCount: number;
  appliedMutants: number;
  killedMutants: number;
  survivedMutants: number;
  errorMutants: number;
  sensitivity: number;
  sourceWorkspaceMutated: boolean;
  testsMutated: boolean;
  scanTruncated: boolean;
  baselineBefore: CommandProbe;
  baselineAfter: CommandProbe;
  mutants: OracleCalibrationMutantV1[];
  reportDigest: string;
}

export interface OracleCalibrationAssessment {
  available: boolean;
  reason: string;
  report?: OracleCalibrationReportV1;
  sensitivity: number;
  floor: number;
  appliedMutants: number;
  testSuiteDigest?: string;
  calibrationId?: string;
}

export interface RunOracleCalibrationOptions {
  workspaceRoot: string;
  maxMutants?: number;
  sensitivityFloor?: number;
  commandTimeoutMs?: number;
  keepIsolated?: boolean;
}

interface CommandProbe { pass: boolean; timedOut: boolean; durationMs: number; outputDigest: string; }
interface FileInventory { files: Array<{ relativePath: string; fullPath: string; size: number; hash: string }>; digest: string; truncated: boolean; }
interface MutationCandidate { relativePath: string; position: number; before: string; after: string; operator: string; }

export async function runOracleCalibration(options: RunOracleCalibrationOptions): Promise<OracleCalibrationReportV1> {
  const root = fs.realpathSync(options.workspaceRoot);
  const adapter = detectProjectAdapter(root);
  const floor = Math.max(AUDITED_ORACLE_SENSITIVITY_FLOOR, Math.min(1, finite(options.sensitivityFloor, AUDITED_ORACLE_SENSITIVITY_FLOOR)));
  const maxMutants = Math.max(AUDITED_ORACLE_MIN_MUTANTS, Math.min(MAX_MUTANTS, Math.floor(finite(options.maxMutants, 10))));
  const timeoutMs = Math.max(1_000, Math.min(120_000, Math.floor(finite(options.commandTimeoutMs, 30_000))));
  const before = inventory(root);
  const testSuiteBefore = testSuiteIdentity(root, adapter.fingerprint, adapter.commands.test.command || '');
  const supported = adapter.ecosystem === 'node'
    && Boolean(adapter.commands.test.command)
    && !before.truncated
    && !testSuiteBefore.truncated;
  if (!supported) {
    const baseline = emptyProbe();
    const base = {
      schemaVersion: 1 as const,
      policyVersion: ORACLE_CALIBRATION_POLICY_VERSION,
      calibrationId: `calibration-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      generatedAt: new Date().toISOString(),
      status: 'unsupported' as const,
      ecosystem: adapter.ecosystem,
      adapterFingerprint: adapter.fingerprint,
      testCommand: adapter.commands.test.command || '',
      testSuiteDigest: testSuiteBefore.digest,
      workspaceIdentityHash: sha256(root.toLowerCase()),
      floor,
      minimumMutants: AUDITED_ORACLE_MIN_MUTANTS,
      candidateCount: 0,
      appliedMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      errorMutants: 0,
      sensitivity: 0,
      sourceWorkspaceMutated: false,
      testsMutated: false,
      scanTruncated: before.truncated || testSuiteBefore.truncated,
      baselineBefore: baseline,
      baselineAfter: baseline,
      mutants: []
    };
    const unsupportedReport = { ...base, reportDigest: calibrationReportDigest(base) };
    persistReport(root, unsupportedReport);
    return unsupportedReport;
  }
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oracle-calibration-'));
  const isolatedRoot = path.join(tempParent, 'workspace');
  let report: OracleCalibrationReportV1 | undefined;
  let cleanupFailed = false;
  try {
    copyInventory(before, root, isolatedRoot);
    const isolatedTestsBefore = testSuiteIdentity(isolatedRoot, adapter.fingerprint, adapter.commands.test.command || '');
    const candidates = mutationCandidates(isolatedRoot, maxMutants);
    const environment = calibrationEnvironment(root);
    const baselineBefore = adapter.commands.test.command
      ? await runCommand(adapter.commands.test.command, isolatedRoot, timeoutMs, environment)
      : emptyProbe();
    const mutants: OracleCalibrationMutantV1[] = [];
    if (baselineBefore.pass) {
      for (const candidate of candidates) {
        const target = contained(isolatedRoot, candidate.relativePath);
        const original = fs.readFileSync(target, 'utf8');
        let probe: CommandProbe;
        try {
          const mutated = applyMutation(original, candidate);
          fs.writeFileSync(target, mutated, 'utf8');
          probe = await runCommand(String(adapter.commands.test.command), isolatedRoot, timeoutMs, environment);
        } catch {
          probe = { pass: false, timedOut: true, durationMs: 0, outputDigest: sha256('mutation execution error') };
        } finally {
          fs.writeFileSync(target, original, 'utf8');
        }
        const status: OracleCalibrationMutantV1['status'] = probe.timedOut ? 'error' : probe.pass ? 'survived' : 'killed';
        mutants.push({ id: mutationId(candidate), relativePath: candidate.relativePath, operator: candidate.operator, status, durationMs: probe.durationMs, outputDigest: probe.outputDigest });
      }
    }
    const baselineAfter = adapter.commands.test.command
      ? await runCommand(adapter.commands.test.command, isolatedRoot, timeoutMs, environment)
      : emptyProbe();
    const isolatedTestsAfter = testSuiteIdentity(isolatedRoot, adapter.fingerprint, adapter.commands.test.command || '');
    const after = inventory(root);
    const testSuiteAfter = testSuiteIdentity(root, adapter.fingerprint, adapter.commands.test.command || '');
    const sourceWorkspaceMutated = before.digest !== after.digest;
    const testsMutated = testSuiteBefore.digest !== testSuiteAfter.digest || isolatedTestsBefore.digest !== isolatedTestsAfter.digest;
    const killed = mutants.filter(item => item.status === 'killed').length;
    const survived = mutants.filter(item => item.status === 'survived').length;
    const errors = mutants.filter(item => item.status === 'error').length;
    const applied = mutants.length;
    const sensitivity = applied > 0 ? killed / applied : 0;
    let status: OracleCalibrationReportV1['status'];
    if (candidates.length < AUDITED_ORACLE_MIN_MUTANTS) status = 'unsupported';
    else if (!baselineBefore.pass) status = 'baseline_red';
    else if (!baselineAfter.pass) status = 'baseline_flaky';
    else if (sourceWorkspaceMutated || testsMutated) status = 'workspace_drift';
    else status = applied >= AUDITED_ORACLE_MIN_MUTANTS && errors === 0 && sensitivity >= floor ? 'pass' : 'below_floor';
    const generatedAt = new Date().toISOString();
    const base = {
      schemaVersion: 1 as const,
      policyVersion: ORACLE_CALIBRATION_POLICY_VERSION,
      calibrationId: `calibration-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      generatedAt,
      status,
      ecosystem: adapter.ecosystem,
      adapterFingerprint: adapter.fingerprint,
      testCommand: adapter.commands.test.command || '',
      testSuiteDigest: testSuiteBefore.digest,
      workspaceIdentityHash: sha256(root.toLowerCase()),
      floor,
      minimumMutants: AUDITED_ORACLE_MIN_MUTANTS,
      candidateCount: candidates.length,
      appliedMutants: applied,
      killedMutants: killed,
      survivedMutants: survived,
      errorMutants: errors,
      sensitivity,
      sourceWorkspaceMutated,
      testsMutated,
      scanTruncated: before.truncated || testSuiteBefore.truncated,
      baselineBefore,
      baselineAfter,
      mutants
    };
    report = { ...base, reportDigest: calibrationReportDigest(base) };
  } finally {
    if (options.keepIsolated !== true) {
      try { fs.rmSync(tempParent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
      catch { cleanupFailed = true; }
    }
  }
  if (!report) throw new Error('Oracle calibration failed before a report could be produced.');
  if (cleanupFailed) report = resignReport({ ...report, status: 'cleanup_failed' });
  persistReport(root, report);
  return report;
}

export function assessOracleCalibration(workspaceRoot: string): OracleCalibrationAssessment {
  const root = fs.realpathSync(workspaceRoot);
  const target = path.join(root, '.forge', 'oracle-calibration.json');
  if (!fs.existsSync(target)) return unavailable('no calibration report');
  let report: OracleCalibrationReportV1;
  try { report = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { return unavailable('calibration report is unreadable'); }
  if (report.schemaVersion !== 1 || report.policyVersion !== ORACLE_CALIBRATION_POLICY_VERSION) return unavailable('unsupported calibration policy', report);
  if (calibrationReportDigest(report) !== report.reportDigest) return unavailable('calibration report digest mismatch', report);
  if (report.status !== 'pass') return unavailable(`calibration status is ${report.status}`, report);
  const adapter = detectProjectAdapter(root);
  if (adapter.ecosystem !== 'node' || adapter.fingerprint !== report.adapterFingerprint || (adapter.commands.test.command || '') !== report.testCommand) return unavailable('project adapter or test command changed', report);
  const tests = testSuiteIdentity(root, adapter.fingerprint, adapter.commands.test.command || '');
  if (tests.truncated || tests.digest !== report.testSuiteDigest) return unavailable('test suite or configuration changed', report);
  if (report.floor < AUDITED_ORACLE_SENSITIVITY_FLOOR || report.minimumMutants < AUDITED_ORACLE_MIN_MUTANTS) return unavailable('calibration floor is weaker than Audited policy', report);
  if (report.appliedMutants < AUDITED_ORACLE_MIN_MUTANTS || report.errorMutants !== 0 || report.sensitivity < Math.max(report.floor, AUDITED_ORACLE_SENSITIVITY_FLOOR)) return unavailable('calibration sensitivity floor is not satisfied', report);
  if (report.sourceWorkspaceMutated || report.testsMutated || report.scanTruncated || !report.baselineBefore.pass || !report.baselineAfter.pass) return unavailable('calibration preservation or baseline gate failed', report);
  return { available: true, reason: 'calibrated', report, sensitivity: report.sensitivity, floor: report.floor, appliedMutants: report.appliedMutants, testSuiteDigest: report.testSuiteDigest, calibrationId: report.calibrationId };
}

export function calibrationReportDigest(value: Omit<OracleCalibrationReportV1, 'reportDigest'> | OracleCalibrationReportV1): string {
  const { reportDigest: _ignored, ...canonical } = value as OracleCalibrationReportV1;
  return sha256(canonicalJson(canonical));
}

function unavailable(reason: string, report?: OracleCalibrationReportV1): OracleCalibrationAssessment {
  return { available: false, reason, report, sensitivity: Number(report?.sensitivity || 0), floor: Number(report?.floor || AUDITED_ORACLE_SENSITIVITY_FLOOR), appliedMutants: Number(report?.appliedMutants || 0), testSuiteDigest: report?.testSuiteDigest, calibrationId: report?.calibrationId };
}

function persistReport(root: string, report: OracleCalibrationReportV1): void {
  const forge = path.join(root, '.forge');
  const archive = path.join(forge, 'calibrations');
  fs.mkdirSync(archive, { recursive: true });
  const text = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(archive, `${report.calibrationId}.json`), text, { encoding: 'utf8', flag: 'wx' });
  writeAtomic(path.join(forge, 'oracle-calibration.json'), text);
}

function writeAtomic(target: string, text: string): void {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temp, target);
      return;
    } catch (error: any) {
      if (attempt >= 19 || !['EPERM', 'EBUSY', 'EACCES'].includes(String(error?.code || ''))) {
        try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function resignReport(report: OracleCalibrationReportV1): OracleCalibrationReportV1 {
  return { ...report, reportDigest: calibrationReportDigest(report) };
}

function mutationCandidates(root: string, limit: number): MutationCandidate[] {
  const result: MutationCandidate[] = [];
  const files = inventory(root).files
    .filter(file => SOURCE_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()) && !isTestOrConfigPath(file.relativePath) && !file.relativePath.toLowerCase().endsWith('.d.ts') && file.size <= MAX_SOURCE_FILE_BYTES)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const file of files) {
    const text = fs.readFileSync(file.fullPath, 'utf8');
    for (const token of scanMutableTokens(text)) {
      result.push({ relativePath: file.relativePath, ...token });
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function scanMutableTokens(text: string): Array<Omit<MutationCandidate, 'relativePath'>> {
  const replacements: Record<string, string> = { true: 'false', false: 'true', '===': '!==', '!==': '===', '==': '!=', '!=': '==', '>=': '<', '<=': '>', '&&': '||', '||': '&&' };
  // Standalone angle operators are excluded in policy v1 because lexical
  // scanning cannot reliably distinguish comparisons from arrows, JSX, or TS
  // generic syntax. Invalid mutants must never inflate sensitivity.
  const operators = ['!==', '===', '>=', '<=', '&&', '||', '!=', '=='];
  const tokens: Array<Omit<MutationCandidate, 'relativePath'>> = [];
  let index = 0;
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' | 'regex' = 'code';
  let regexClass = false;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (state === 'line') { if (char === '\n') state = 'code'; index += 1; continue; }
    if (state === 'block') { if (char === '*' && next === '/') { state = 'code'; index += 2; } else index += 1; continue; }
    if (state === 'regex') {
      if (char === '\\') { index += 2; continue; }
      if (char === '[') regexClass = true;
      else if (char === ']') regexClass = false;
      else if (char === '/' && !regexClass) {
        state = 'code';
        index += 1;
        while (/[A-Za-z]/.test(text[index] || '')) index += 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (state !== 'code') {
      if (char === '\\') { index += 2; continue; }
      if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) state = 'code';
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') { state = 'line'; index += 2; continue; }
    if (char === '/' && next === '*') { state = 'block'; index += 2; continue; }
    if (char === '/' && isRegexLiteralStart(text, index)) { state = 'regex'; regexClass = false; index += 1; continue; }
    if (char === "'") { state = 'single'; index += 1; continue; }
    if (char === '"') { state = 'double'; index += 1; continue; }
    if (char === '`') { state = 'template'; index += 1; continue; }
    const word = /^(true|false)\b/.exec(text.slice(index));
    const previous = index > 0 ? text[index - 1] : '';
    if (word && !/[A-Za-z0-9_$]/.test(previous)) {
      tokens.push({ position: index, before: word[1], after: replacements[word[1]], operator: `${word[1]}->${replacements[word[1]]}` });
      index += word[1].length;
      continue;
    }
    const operator = operators.find(value => text.startsWith(value, index));
    if (operator) {
      tokens.push({ position: index, before: operator, after: replacements[operator], operator: `${operator}->${replacements[operator]}` });
      index += operator.length;
      continue;
    }
    index += 1;
  }
  return tokens;
}

function isRegexLiteralStart(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  const significant = prefix.match(/(?:^|[\s;{}])([A-Za-z_$][\w$]*)\s*$/)?.[1];
  if (significant && ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'yield', 'await'].includes(significant)) return true;
  const previous = prefix.match(/\S\s*$/)?.[0].trim().slice(-1) || '';
  return previous === '' || '=([{!,:;?&|+-*%^~<>'.includes(previous);
}

function applyMutation(content: string, candidate: MutationCandidate): string {
  if (content.slice(candidate.position, candidate.position + candidate.before.length) !== candidate.before) throw new Error('Mutation candidate no longer applies.');
  return `${content.slice(0, candidate.position)}${candidate.after}${content.slice(candidate.position + candidate.before.length)}`;
}

function mutationId(candidate: MutationCandidate): string { return sha256(canonicalJson(candidate)).slice(0, 24); }

function inventory(root: string): FileInventory {
  const files: FileInventory['files'] = [];
  let bytes = 0;
  let truncated = false;
  const visit = (dir: string): void => {
    if (truncated) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name) || entry.name.endsWith('.vsix')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (files.length >= MAX_FILES || bytes + stat.size > MAX_TOTAL_BYTES) { truncated = true; return; }
        const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath);
        files.push({ relativePath, fullPath, size: stat.size, hash: sha256(content) });
        bytes += stat.size;
      }
    }
  };
  visit(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, truncated, digest: sha256(canonicalJson({ truncated, files: files.map(file => ({ path: file.relativePath, size: file.size, hash: file.hash })) })) };
}

function testSuiteIdentity(root: string, adapterFingerprint: string, testCommand: string): { digest: string; truncated: boolean } {
  const all = inventory(root);
  const files = all.files.filter(file => isTestOrConfigPath(file.relativePath)).map(file => ({ path: file.relativePath, size: file.size, hash: file.hash }));
  return { truncated: all.truncated, digest: sha256(canonicalJson({ adapterFingerprint, testCommand, files })) };
}

function isTestOrConfigPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  const name = path.posix.basename(normalized);
  if (/(^|\/)(__tests__|tests?|specs?|fixtures|snapshots?)(\/|$)/.test(normalized)) return true;
  if (/\.(test|spec|bench|config)\.[^.]+$/.test(name) || /^(test|spec)\.[^.]+$/.test(name) || name.endsWith('.snap')) return true;
  return ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'vitest.config.ts', 'vitest.config.js', 'jest.config.js', 'jest.config.ts'].includes(normalized);
}

function copyInventory(subject: FileInventory, sourceRoot: string, targetRoot: string): void {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of subject.files) {
    const source = contained(sourceRoot, file.relativePath);
    const target = contained(targetRoot, file.relativePath, false);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function contained(root: string, relativePath: string, requireExisting = true): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) throw new Error('Calibration path must be contained.');
  const target = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error('Calibration path escapes the isolated workspace.');
  if (requireExisting && (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink())) throw new Error('Calibration target is missing or symbolic.');
  return target;
}

function calibrationEnvironment(sourceRoot: string): NodeJS.ProcessEnv {
  const modules = path.join(sourceRoot, 'node_modules');
  const bin = path.join(modules, '.bin');
  return fs.existsSync(modules) ? { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`, NODE_PATH: modules } : { ...process.env };
}

function runCommand(command: string, cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CommandProbe> {
  const started = Date.now();
  return new Promise(resolve => exec(command, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, env }, (error: any, stdout, stderr) => {
    const output = `${stdout || ''}${stderr || ''}`;
    resolve({ pass: !error, timedOut: Boolean(error?.killed || error?.signal === 'SIGTERM'), durationMs: Date.now() - started, outputDigest: sha256(output || String(error?.code || '')) });
  }));
}

function emptyProbe(): CommandProbe { return { pass: false, timedOut: false, durationMs: 0, outputDigest: sha256('missing test command') }; }
function finite(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function sha256(value: string | Buffer): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
