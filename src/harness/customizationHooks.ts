import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { cleanupIsolatedWorkspace, prepareIsolatedWorkspace } from './isolation';
import {
  CustomizationSnapshotV1,
  HookInput,
  ImportedHook,
  NormalizedHookOutput,
  hooksForEvent,
  normalizeHookOutput
} from './customizationCompatibility';
import { ToolProposal } from './types';

export interface HookCandidateRecord {
  id: string;
  hookId: string;
  sourcePath: string;
  event: HookInput['event'];
  decision: NormalizedHookOutput['decision'];
  reason: string;
  contextCandidates: string[];
  evidenceCandidates: string[];
  trusted: false;
  timestamp: string;
}

export interface HookRunResult {
  decision: NormalizedHookOutput['decision'];
  reason: string;
  proposal?: ToolProposal;
  candidates: HookCandidateRecord[];
  hookRuns: Array<{ hookId: string; exitCode: number | null; durationMs: number; timedOut: boolean; sourceRestored: boolean }>;
}

export interface HookExecutionOptions {
  enabled: boolean;
  workspaceRoot: string;
  maxSnapshotFiles?: number;
  maxSnapshotBytes?: number;
}

interface SourceSnapshot {
  files: Map<string, Buffer>;
  totalBytes: number;
}

export async function executeCustomizationHooks(snapshot: CustomizationSnapshotV1, input: HookInput, options: HookExecutionOptions): Promise<HookRunResult> {
  const hooks = hooksForEvent(snapshot, input.event, input.proposal);
  if (!hooks.length) return { decision: 'allow', reason: 'No matching hooks.', proposal: input.proposal, candidates: [], hookRuns: [] };
  if (!options.enabled) return { decision: 'allow', reason: 'Compatible hooks are present but execution is disabled.', proposal: input.proposal, candidates: [], hookRuns: [] };
  const root = fs.realpathSync(options.workspaceRoot);
  let currentProposal = input.proposal;
  const candidates: HookCandidateRecord[] = [];
  const hookRuns: HookRunResult['hookRuns'] = [];
  let aggregate: HookRunResult['decision'] = 'allow';
  const reasons: string[] = [];

  for (const hook of hooks) {
    const before = snapshotSource(root, options.maxSnapshotFiles ?? 20_000, options.maxSnapshotBytes ?? 128 * 1024 * 1024);
    let output: NormalizedHookOutput;
    let runMeta: HookRunResult['hookRuns'][number];
    try {
      const executed = await executeOneHook(root, hook, { ...input, proposal: currentProposal });
      runMeta = { hookId: hook.id, exitCode: executed.exitCode, durationMs: executed.durationMs, timedOut: executed.timedOut, sourceRestored: true };
      if (executed.timedOut) throw new Error('Hook timed out.');
      if (executed.exitCode === 2) {
        output = { decision: 'deny', reason: executed.stderr || 'Hook exited with blocking status 2.', contextCandidates: [], evidenceCandidates: [], rejectedClaims: [] };
      } else if (executed.exitCode !== 0) {
        throw new Error(`Hook exited ${executed.exitCode}: ${executed.stderr.slice(0, 1000)}`);
      } else if (!executed.stdout.trim()) {
        output = { decision: 'allow', reason: 'Hook completed without structured output.', contextCandidates: [], evidenceCandidates: [], rejectedClaims: [] };
      } else {
        output = normalizeHookOutput(JSON.parse(executed.stdout), currentProposal);
      }
    } catch (err: any) {
      output = { decision: input.event === 'pre_tool' ? 'deny' : 'allow', reason: `Hook failure: ${String(err?.message || err).slice(0, 1000)}`, contextCandidates: [], evidenceCandidates: [], rejectedClaims: [] };
      runMeta = runMeta! || { hookId: hook.id, exitCode: null, durationMs: 0, timedOut: /timed out/i.test(String(err?.message || err)), sourceRestored: true };
    }

    const after = snapshotSource(root, options.maxSnapshotFiles ?? 20_000, options.maxSnapshotBytes ?? 128 * 1024 * 1024);
    if (!snapshotsEqual(before, after)) {
      const restored = restoreSnapshot(root, before, after);
      runMeta.sourceRestored = restored;
      output = { decision: 'deny', reason: restored ? 'Hook attempted to mutate the active workspace; source bytes were restored.' : 'Hook mutated the active workspace and restoration failed.', contextCandidates: [], evidenceCandidates: [], rejectedClaims: [] };
    }
    hookRuns.push(runMeta);
    if (output.narrowedProposal) currentProposal = output.narrowedProposal;
    aggregate = strongestDecision(aggregate, output.decision);
    reasons.push(`${hook.sourcePath}: ${output.reason}`);
    if (output.contextCandidates.length || output.evidenceCandidates.length || output.decision !== 'allow') {
      candidates.push({
        id: `hook-candidate-${crypto.randomBytes(8).toString('hex')}`,
        hookId: hook.id,
        sourcePath: hook.sourcePath,
        event: input.event,
        decision: output.decision,
        reason: output.reason,
        contextCandidates: output.contextCandidates,
        evidenceCandidates: output.evidenceCandidates,
        trusted: false,
        timestamp: new Date().toISOString()
      });
    }
    if (aggregate === 'deny') break;
  }

  persistHookCandidates(root, candidates);
  return { decision: aggregate, reason: reasons.join('\n').slice(0, 4000), proposal: currentProposal, candidates, hookRuns };
}

async function executeOneHook(sourceRoot: string, hook: ImportedHook, input: HookInput): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }> {
  const prepared = prepareIsolatedWorkspace(sourceRoot, 'copy');
  const started = Date.now();
  try {
    return await new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
      const args = isWindows ? ['/d', '/s', '/c', hook.command] : ['-lc', hook.command];
      const child = spawn(shell, args, {
        cwd: prepared.isolatedRoot,
        env: sanitizedEnvironment(sourceRoot),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        terminateTree(child.pid);
      }, hook.timeoutMs);
      child.stdout.on('data', chunk => { if (stdout.length < 64 * 1024) stdout += String(chunk).slice(0, 64 * 1024 - stdout.length); });
      child.stderr.on('data', chunk => { if (stderr.length < 64 * 1024) stderr += String(chunk).slice(0, 64 * 1024 - stderr.length); });
      child.on('error', error => {
        clearTimeout(timer);
        resolve({ stdout, stderr: `${stderr}\n${error.message}`.trim(), exitCode: null, timedOut, durationMs: Date.now() - started });
      });
      child.on('close', code => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code, timedOut, durationMs: Date.now() - started });
      });
      child.stdin.end(JSON.stringify({
        version: 1,
        event: input.event,
        sessionId: input.sessionId,
        role: input.role,
        proposal: input.proposal,
        result: input.result,
        workspace: '.'
      }));
    });
  } finally {
    cleanupIsolatedWorkspace(prepared);
  }
}

function sanitizedEnvironment(sourceRoot: string): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key];
  const nodeBin = path.join(sourceRoot, 'node_modules', '.bin');
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  env[pathKey] = `${nodeBin}${path.delimiter}${env[pathKey] || process.env.PATH || ''}`;
  env.FORGE_CUSTOMIZATION_HOOK = '1';
  return env;
}

function terminateTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* process already exited */ }
  }
}

function snapshotSource(root: string, maxFiles: number, maxBytes: number): SourceSnapshot {
  const files = new Map<string, Buffer>();
  const stack = [root];
  let totalBytes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    const rel = path.relative(root, current).replace(/\\/g, '/');
    if (rel && excluded(rel)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort().reverse()) stack.push(path.join(current, name));
      continue;
    }
    if (!stat.isFile()) continue;
    if (files.size >= maxFiles) throw new Error(`Hook source snapshot exceeds ${maxFiles} files.`);
    totalBytes += stat.size;
    if (totalBytes > maxBytes) throw new Error(`Hook source snapshot exceeds ${maxBytes} bytes.`);
    files.set(rel, fs.readFileSync(current));
  }
  return { files, totalBytes };
}

function restoreSnapshot(root: string, before: SourceSnapshot, after: SourceSnapshot): boolean {
  try {
    for (const rel of after.files.keys()) if (!before.files.has(rel)) fs.rmSync(path.join(root, rel), { force: true });
    for (const [rel, content] of before.files) {
      const target = path.join(root, rel);
      if (!after.files.has(rel) || !content.equals(after.files.get(rel)!)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    }
    return snapshotsEqual(before, snapshotSource(root, Math.max(before.files.size + 100, 1000), Math.max(before.totalBytes + 1024 * 1024, 8 * 1024 * 1024)));
  } catch {
    return false;
  }
}

function snapshotsEqual(a: SourceSnapshot, b: SourceSnapshot): boolean {
  if (a.files.size !== b.files.size) return false;
  for (const [rel, content] of a.files) if (!b.files.has(rel) || !content.equals(b.files.get(rel)!)) return false;
  return true;
}

function excluded(rel: string): boolean {
  const first = rel.split('/')[0];
  return ['.git', '.forge', 'node_modules', 'out', 'dist', 'artifacts', '.vscode-test'].includes(first) || rel.endsWith('.vsix');
}

function strongestDecision(a: HookRunResult['decision'], b: HookRunResult['decision']): HookRunResult['decision'] {
  const rank: Record<HookRunResult['decision'], number> = { allow: 0, narrow: 1, ask: 2, deny: 3 };
  return rank[b] > rank[a] ? b : a;
}

function persistHookCandidates(root: string, additions: HookCandidateRecord[]): void {
  if (!additions.length) return;
  const target = path.join(root, '.forge', 'customization-candidates.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let existing: HookCandidateRecord[] = [];
  try { existing = JSON.parse(fs.readFileSync(target, 'utf8')).candidates || []; } catch { /* start a new candidate ledger */ }
  const payload = { version: 1, updatedAt: new Date().toISOString(), candidates: [...existing, ...additions].slice(-200) };
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, target);
}
