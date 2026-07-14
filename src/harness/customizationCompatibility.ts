import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { parse as parseYaml } from 'yaml';
import { AgentMode, ALL_MODE_TOOLS, REQUIRED_CODE_MODE_TOOLS } from './modeRegistry';
import { ToolName, ToolProposal } from './types';

export type CustomizationKind = 'skill' | 'agent' | 'rule' | 'hook';
export type CustomizationDisposition = 'accepted' | 'ignored' | 'rejected';
export type HookEvent = 'session_start' | 'pre_tool' | 'post_tool' | 'stop';

export interface CustomizationDiagnostic {
  path: string;
  kind: CustomizationKind;
  disposition: CustomizationDisposition;
  reason: string;
  digest?: string;
}

export interface ImportedSkill {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  digest: string;
  body: string;
  allowedTools: ToolName[];
  unknownTools: string[];
  compatibility?: string;
}

export interface ImportedAgent {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  digest: string;
  instructions: string;
  intent: AgentMode['intent'];
  modelRole: AgentMode['modelRole'];
  inference: AgentMode['inference'];
  requestedModel?: string;
  requestedTools: ToolName[];
  unknownTools: string[];
  effectiveTools: ToolName[];
  compatible: boolean;
  compatibilityReason: string;
}

export interface ImportedRule {
  id: string;
  sourcePath: string;
  digest: string;
  body: string;
  patterns: string[];
  alwaysOn: boolean;
}

export interface ImportedHook {
  id: string;
  sourcePath: string;
  digest: string;
  event: HookEvent;
  command: string;
  timeoutMs: number;
  matcher?: string;
}

export interface CustomizationSnapshotV1 {
  version: 1;
  generatedAt: string;
  workspaceRootHash: string;
  digest: string;
  skills: ImportedSkill[];
  agents: ImportedAgent[];
  rules: ImportedRule[];
  hooks: ImportedHook[];
  diagnostics: CustomizationDiagnostic[];
  limits: typeof DEFAULT_CUSTOMIZATION_LIMITS;
}

export interface CustomizationLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSkills: number;
  maxAgents: number;
  maxRules: number;
  maxHooks: number;
}

export interface ActiveCustomizationContext {
  snapshotDigest: string;
  skills: ImportedSkill[];
  rules: ImportedRule[];
  text: string;
}

export interface HookInput {
  event: HookEvent;
  sessionId: string;
  role: string;
  proposal?: ToolProposal;
  result?: { ok: boolean; summary: string };
}

export interface NormalizedHookOutput {
  decision: 'allow' | 'deny' | 'ask' | 'narrow';
  reason: string;
  narrowedProposal?: ToolProposal;
  contextCandidates: string[];
  evidenceCandidates: string[];
  rejectedClaims: string[];
}

export const DEFAULT_CUSTOMIZATION_LIMITS: CustomizationLimits = {
  maxFiles: 160,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 512 * 1024,
  maxSkills: 40,
  maxAgents: 30,
  maxRules: 60,
  maxHooks: 40
};

const TOOL_ALIASES: Record<string, ToolName> = {
  read: 'read_file', read_file: 'read_file', view: 'read_file',
  read_range: 'read_range', grep: 'repo_search', glob: 'repo_search', search: 'repo_search', repo_search: 'repo_search',
  symbol_search: 'symbol_search', edit: 'apply_patch', apply_patch: 'apply_patch', write: 'write_file', write_file: 'write_file',
  bash: 'run_command', shell: 'run_command', terminal: 'run_command', run_command: 'run_command', run_tests: 'run_tests',
  get_diff: 'get_diff', update_plan: 'update_plan', update_tasks: 'update_tasks', record_evidence: 'record_evidence',
  ask_user: 'ask_user', declare_success: 'declare_success', browser: 'browser_inspect', browser_inspect: 'browser_inspect',
  browser_action: 'browser_action', computer_inspect: 'computer_inspect', computer_action: 'computer_action', external_tool: 'external_tool'
};

const EVENT_ALIASES: Record<string, HookEvent> = {
  sessionstart: 'session_start', session_start: 'session_start',
  pretooluse: 'pre_tool', pre_tool: 'pre_tool',
  posttooluse: 'post_tool', post_tool: 'post_tool',
  stop: 'stop'
};

export function discoverCustomizations(workspaceRootInput: string, limits: Partial<CustomizationLimits> = {}): CustomizationSnapshotV1 {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  const effectiveLimits = { ...DEFAULT_CUSTOMIZATION_LIMITS, ...limits };
  validateLimits(effectiveLimits);
  const candidates = discoverCandidateFiles(workspaceRoot, effectiveLimits);
  const diagnostics: CustomizationDiagnostic[] = [];
  const skills: ImportedSkill[] = [];
  const agents: ImportedAgent[] = [];
  const rules: ImportedRule[] = [];
  const hooks: ImportedHook[] = [];
  const identities = new Map<string, string>();
  let totalBytes = 0;

  for (const candidate of candidates) {
    const rel = relative(workspaceRoot, candidate.absolutePath);
    const kind = candidate.kind;
    try {
      const stat = fs.lstatSync(candidate.absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('only regular non-symlink files are compatible');
      const real = fs.realpathSync(candidate.absolutePath);
      assertContained(workspaceRoot, real);
      if (stat.size > effectiveLimits.maxFileBytes) throw new Error(`file exceeds ${effectiveLimits.maxFileBytes} bytes`);
      totalBytes += stat.size;
      if (totalBytes > effectiveLimits.maxTotalBytes) throw new Error(`aggregate customization input exceeds ${effectiveLimits.maxTotalBytes} bytes`);
      const raw = fs.readFileSync(real);
      if (raw.includes(0)) throw new Error('binary customization files are unsupported');
      const text = raw.toString('utf8');
      const digest = sha256(text);
      if (kind === 'skill') {
        const skill = parseSkill(rel, text, digest);
        acceptUnique(identities, `skill:${skill.name.toLowerCase()}`, rel);
        if (skills.length >= effectiveLimits.maxSkills) throw new Error(`skill limit ${effectiveLimits.maxSkills} reached`);
        skills.push(skill);
      } else if (kind === 'agent') {
        const agent = parseAgent(rel, text, digest);
        acceptUnique(identities, `agent:${agent.name.toLowerCase()}`, rel);
        if (agents.length >= effectiveLimits.maxAgents) throw new Error(`agent limit ${effectiveLimits.maxAgents} reached`);
        agents.push(agent);
      } else if (kind === 'rule') {
        const rule = parseRule(rel, text, digest);
        acceptUnique(identities, `rule:${rule.id}`, rel);
        if (rules.length >= effectiveLimits.maxRules) throw new Error(`rule limit ${effectiveLimits.maxRules} reached`);
        rules.push(rule);
      } else {
        const parsed = parseHooks(rel, text, digest);
        if (!parsed.length) diagnostics.push({ path: rel, kind, disposition: 'ignored', reason: 'no compatible command hooks found', digest });
        for (const hook of parsed) {
          acceptUnique(identities, `hook:${hook.id}`, rel);
          if (hooks.length >= effectiveLimits.maxHooks) throw new Error(`hook limit ${effectiveLimits.maxHooks} reached`);
          hooks.push(hook);
        }
      }
      diagnostics.push({ path: rel, kind, disposition: 'accepted', reason: 'parsed and bounded', digest });
    } catch (err: any) {
      diagnostics.push({ path: rel, kind, disposition: 'rejected', reason: String(err?.message || err).slice(0, 500) });
    }
  }

  skills.sort(bySource); agents.sort(bySource); rules.sort(bySource); hooks.sort(bySource);
  diagnostics.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || a.disposition.localeCompare(b.disposition));
  const canonical = { version: 1, skills, agents, rules, hooks, diagnostics: diagnostics.map(({ path, kind, disposition, reason, digest }) => ({ path, kind, disposition, reason, digest })) };
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceRootHash: sha256(workspaceRoot.toLowerCase()),
    digest: sha256(stableStringify(canonical)),
    skills,
    agents,
    rules,
    hooks,
    diagnostics,
    limits: effectiveLimits
  };
}

export function persistCustomizationSnapshot(workspaceRootInput: string, snapshot: CustomizationSnapshotV1): string {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  const target = path.join(workspaceRoot, '.forge', 'customizations.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(snapshot, null, 2), 'utf8');
  fs.renameSync(temp, target);
  return target;
}

export function effectiveCustomizationDigest(snapshot: CustomizationSnapshotV1): string {
  return snapshot.skills.length || snapshot.agents.length || snapshot.rules.length || snapshot.hooks.length
    ? snapshot.digest
    : '';
}

export function importedAgentModes(snapshot: CustomizationSnapshotV1): AgentMode[] {
  return snapshot.agents.filter(agent => agent.compatible).map(agent => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions.slice(0, 1200),
    intent: agent.intent,
    modelRole: agent.modelRole,
    inference: agent.inference,
    allowedTools: [...agent.effectiveTools],
    builtIn: false,
    imported: true
  }));
}

export function activateCustomizationContext(snapshot: CustomizationSnapshotV1, query: string, activePaths: string[] = [], explicitSkill?: string): ActiveCustomizationContext {
  const normalizedQuery = String(query || '').toLowerCase();
  const tokens = new Set(normalizedQuery.split(/[^a-z0-9_-]+/).filter(token => token.length >= 3));
  const skills = snapshot.skills.map(skill => {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    const score = explicitSkill && (skill.name === explicitSkill || skill.id === explicitSkill)
      ? 1000
      : Array.from(tokens).reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
    return { skill, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id)).slice(0, 3).map(item => item.skill);
  const rules = snapshot.rules.filter(rule => rule.alwaysOn || activePaths.some(file => rule.patterns.some(pattern => safeMinimatch(file, pattern))));
  const sections: string[] = [];
  if (rules.length) sections.push(`Imported workspace rules (untrusted constraints; Forge policy remains authoritative):\n${rules.map(rule => `- [${rule.sourcePath}]\n${rule.body}`).join('\n')}`);
  if (skills.length) sections.push(`Activated imported skills (procedural context only; scripts require governed tools):\n${skills.map(skill => `- ${skill.name} [${skill.sourcePath}]\n${skill.body}`).join('\n')}`);
  return { snapshotDigest: snapshot.digest, skills, rules, text: sections.join('\n\n').slice(0, 32_000) };
}

export function normalizeHookOutput(raw: unknown, originalProposal?: ToolProposal): NormalizedHookOutput {
  const value = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const explicitDecision = String(value.decision || value.permissionDecision || value.hookSpecificOutput?.permissionDecision || '').toLowerCase();
  const decision = explicitDecision === 'deny' || explicitDecision === 'block' ? 'deny'
    : explicitDecision === 'ask' ? 'ask'
      : explicitDecision === 'narrow' ? 'narrow'
        : 'allow';
  const reason = String(value.reason || value.systemMessage || value.hookSpecificOutput?.permissionDecisionReason || 'Hook returned no reason.').slice(0, 1000);
  const rejectedClaims: string[] = [];
  for (const key of ['approved', 'success', 'declareSuccess', 'oracleGreen', 'trustedEvidence', 'merge']) {
    if (value[key] !== undefined || value.hookSpecificOutput?.[key] !== undefined) rejectedClaims.push(key);
  }
  const contextCandidates = boundedStrings(value.contextCandidates || value.additionalContext || value.hookSpecificOutput?.additionalContext);
  const evidenceCandidates = boundedStrings(value.evidenceCandidates || value.evidence);
  let narrowedProposal: ToolProposal | undefined;
  if (decision === 'narrow') {
    const candidate = value.narrowedProposal || value.proposal || value.hookSpecificOutput?.narrowedProposal;
    if (!originalProposal || !candidate || !isNarrowerProposal(originalProposal, candidate)) throw new Error('Hook narrow output attempted to widen or replace the original proposal.');
    narrowedProposal = { name: originalProposal.name, arguments: candidate.arguments };
  }
  if (rejectedClaims.length) throw new Error(`Hook attempted forbidden authority claim(s): ${rejectedClaims.join(', ')}.`);
  return { decision, reason, narrowedProposal, contextCandidates, evidenceCandidates, rejectedClaims };
}

export function hooksForEvent(snapshot: CustomizationSnapshotV1, event: HookEvent, proposal?: ToolProposal): ImportedHook[] {
  return snapshot.hooks.filter(hook => hook.event === event && (!hook.matcher || !proposal || safeMinimatch(proposal.name, hook.matcher)));
}

export function isNarrowerProposal(original: ToolProposal, candidate: any): boolean {
  if (!candidate || String(candidate.name) !== original.name || !candidate.arguments || typeof candidate.arguments !== 'object' || Array.isArray(candidate.arguments)) return false;
  return isNarrowerValue(original.arguments, candidate.arguments);
}

function isNarrowerValue(original: any, candidate: any): boolean {
  if (candidate === original) return true;
  if (Array.isArray(original)) return Array.isArray(candidate) && candidate.every((item, index) => index < original.length && isNarrowerValue(original[index], item));
  if (original && typeof original === 'object') {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    return Object.keys(candidate).every(key => Object.prototype.hasOwnProperty.call(original, key) && isNarrowerValue(original[key], candidate[key]));
  }
  if (typeof original === 'string' && typeof candidate === 'string') return candidate === original || (original.includes(candidate) && candidate.length > 0);
  if (typeof original === 'number' && typeof candidate === 'number') return candidate <= original;
  if (typeof original === 'boolean' && typeof candidate === 'boolean') return candidate === original || (original === true && candidate === false);
  return false;
}

function parseSkill(sourcePath: string, text: string, digest: string): ImportedSkill {
  const { data, body } = parseFrontmatter(text, true);
  const name = boundedIdentifier(data.name, 64, 'skill name');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('skill name must contain lowercase letters, numbers and hyphens');
  const description = boundedText(data.description, 1024, 'skill description');
  if (!body) throw new Error('skill body is empty');
  const tools = mapTools(data['allowed-tools'] || data.allowedTools);
  return { id: `imported-skill-${slug(name)}`, name, description, sourcePath, digest, body: body.slice(0, 24_000), allowedTools: tools.known, unknownTools: tools.unknown, compatibility: data.compatibility ? String(data.compatibility).slice(0, 500) : undefined };
}

function parseAgent(sourcePath: string, text: string, digest: string): ImportedAgent {
  const { data, body } = parseFrontmatter(text, true);
  const name = boundedText(data.name || path.basename(sourcePath).replace(/(?:\.agent)?\.md$/i, ''), 80, 'agent name');
  const description = boundedText(data.description, 1024, 'agent description');
  if (!body) throw new Error('agent instructions are empty');
  const requested = mapTools(data.tools);
  const intent = inferIntent(data, name, description);
  const ceiling = roleCeiling(intent);
  const requestedTools = requested.specified ? requested.known : [...ceiling];
  const effectiveTools = requestedTools.filter(tool => ceiling.includes(tool));
  const missingRequired = intent === 'code' ? REQUIRED_CODE_MODE_TOOLS.filter(tool => !effectiveTools.includes(tool)) : [];
  const compatible = !missingRequired.length && effectiveTools.length > 0;
  return {
    id: `custom-imported-${slug(name)}-${digest.slice(0, 6)}`.slice(0, 71),
    name: name.slice(0, 40),
    description: description.slice(0, 240),
    sourcePath,
    digest,
    instructions: body.slice(0, 1200),
    intent,
    modelRole: intent === 'code' ? 'code' : intent === 'review' ? 'review' : 'plan',
    inference: intent === 'ask' ? 'Instant' : 'Thinking',
    requestedModel: data.model ? String(data.model).slice(0, 200) : undefined,
    requestedTools,
    unknownTools: requested.unknown,
    effectiveTools,
    compatible,
    compatibilityReason: compatible ? 'requested tools intersect Forge authority' : `missing required Forge scaffold: ${missingRequired.join(', ') || 'no effective tools'}`
  };
}

function parseRule(sourcePath: string, text: string, digest: string): ImportedRule {
  const hasFrontmatter = text.startsWith('---');
  const parsed = parseFrontmatter(text, false);
  const body = hasFrontmatter ? parsed.body : text.trim();
  if (!body) throw new Error('rule body is empty');
  const rawPatterns = parsed.data.applyTo ?? parsed.data.paths;
  const patterns = Array.isArray(rawPatterns) ? rawPatterns.map(String) : rawPatterns ? String(rawPatterns).split(',').map(item => item.trim()) : [];
  for (const pattern of patterns) validatePattern(pattern);
  const alwaysOn = !patterns.length || /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(sourcePath) || sourcePath === '.github/copilot-instructions.md';
  return { id: `rule-${sha256(sourcePath).slice(0, 12)}`, sourcePath, digest, body: body.slice(0, 16_000), patterns, alwaysOn };
}

function parseHooks(sourcePath: string, text: string, digest: string): ImportedHook[] {
  const root = JSON.parse(text);
  const hooksRoot = root?.hooks;
  if (!hooksRoot || typeof hooksRoot !== 'object' || Array.isArray(hooksRoot)) return [];
  const hooks: ImportedHook[] = [];
  for (const [rawEvent, entries] of Object.entries(hooksRoot)) {
    const event = EVENT_ALIASES[String(rawEvent).replace(/[^a-z_]/gi, '').toLowerCase()];
    if (!event) continue;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const container: any = entry;
      const definitions = Array.isArray(container?.hooks) ? container.hooks : [container];
      for (const definition of definitions) {
        if (!definition || String(definition.type || 'command') !== 'command') continue;
        const command = boundedText(definition.command, 2000, 'hook command');
        const timeoutSec = Number(definition.timeoutSec ?? definition.timeout ?? 5);
        if (!Number.isFinite(timeoutSec) || timeoutSec < 0.1 || timeoutSec > 30) throw new Error('hook timeout must be 0.1-30 seconds');
        const matcher = container.matcher ? String(container.matcher).slice(0, 200) : undefined;
        hooks.push({ id: `hook-${sha256(`${sourcePath}:${rawEvent}:${command}:${matcher || ''}`).slice(0, 16)}`, sourcePath, digest, event, command, timeoutMs: Math.round(timeoutSec * 1000), matcher });
      }
    }
  }
  return hooks;
}

function discoverCandidateFiles(root: string, limits: CustomizationLimits): Array<{ absolutePath: string; kind: CustomizationKind }> {
  const result: Array<{ absolutePath: string; kind: CustomizationKind }> = [];
  const exact: Array<[string, CustomizationKind]> = [
    ['AGENTS.md', 'rule'], ['CLAUDE.md', 'rule'], ['.claude/CLAUDE.md', 'rule'], ['.github/copilot-instructions.md', 'rule'],
    ['.claude/settings.json', 'hook'], ['.claude/settings.local.json', 'hook']
  ];
  for (const [rel, kind] of exact) if (fs.existsSync(path.join(root, rel))) result.push({ absolutePath: path.join(root, rel), kind });
  walkFor(root, '.agents/skills', file => path.basename(file).toLowerCase() === 'skill.md', 'skill', result, limits.maxFiles);
  walkFor(root, '.github/skills', file => path.basename(file).toLowerCase() === 'skill.md', 'skill', result, limits.maxFiles);
  walkFor(root, '.claude/skills', file => path.basename(file).toLowerCase() === 'skill.md', 'skill', result, limits.maxFiles);
  walkFor(root, '.agents/agents', file => file.toLowerCase().endsWith('.md'), 'agent', result, limits.maxFiles);
  walkFor(root, '.github/agents', file => file.toLowerCase().endsWith('.md'), 'agent', result, limits.maxFiles);
  walkFor(root, '.claude/agents', file => file.toLowerCase().endsWith('.md'), 'agent', result, limits.maxFiles);
  walkFor(root, '.github/instructions', file => file.toLowerCase().endsWith('.instructions.md'), 'rule', result, limits.maxFiles);
  walkFor(root, '.claude/rules', file => file.toLowerCase().endsWith('.md'), 'rule', result, limits.maxFiles);
  walkFor(root, '.github/hooks', file => file.toLowerCase().endsWith('.json'), 'hook', result, limits.maxFiles);
  const deduped = new Map<string, { absolutePath: string; kind: CustomizationKind }>();
  for (const item of result) deduped.set(path.resolve(item.absolutePath).toLowerCase(), item);
  return Array.from(deduped.values()).sort((a, b) => relative(root, a.absolutePath).localeCompare(relative(root, b.absolutePath))).slice(0, limits.maxFiles);
}

function walkFor(root: string, relDir: string, predicate: (file: string) => boolean, kind: CustomizationKind, output: Array<{ absolutePath: string; kind: CustomizationKind }>, maxFiles: number): void {
  const start = path.join(root, relDir);
  if (!fs.existsSync(start)) return;
  const stack = [start];
  while (stack.length && output.length < maxFiles) {
    const current = stack.pop()!;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      output.push({ absolutePath: current, kind });
      continue;
    }
    if (!stat.isDirectory()) {
      if (predicate(current)) output.push({ absolutePath: current, kind });
      continue;
    }
    for (const name of fs.readdirSync(current).sort().reverse()) {
      if (['node_modules', '.git', '.forge', 'out', 'dist'].includes(name)) continue;
      stack.push(path.join(current, name));
    }
  }
}

function parseFrontmatter(text: string, required: boolean): { data: Record<string, any>; body: string } {
  if (!text.startsWith('---')) {
    if (required) throw new Error('YAML frontmatter is required');
    return { data: {}, body: text.trim() };
  }
  const end = text.indexOf('\n---', 3);
  if (end < 0) throw new Error('frontmatter closing delimiter is missing');
  const raw = text.slice(3, end).trim();
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter must be a mapping');
  return { data, body: text.slice(end + 4).trim() };
}

function mapTools(raw: unknown): { known: ToolName[]; unknown: string[]; specified: boolean } {
  const values = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const known: ToolName[] = [];
  const unknown: string[] = [];
  for (const value of values.map(item => item.trim()).filter(Boolean)) {
    const key = value.toLowerCase().replace(/^.*\//, '').replace(/[^a-z0-9_]/g, '_');
    const mapped = TOOL_ALIASES[key] || (ALL_MODE_TOOLS.includes(key as ToolName) ? key as ToolName : undefined);
    if (mapped && !known.includes(mapped)) known.push(mapped);
    else if (!mapped && !unknown.includes(value)) unknown.push(value);
  }
  return { known, unknown, specified: raw !== undefined };
}

function inferIntent(data: Record<string, any>, name: string, description: string): AgentMode['intent'] {
  const raw = `${data.intent || ''} ${data.mode || ''} ${name} ${description}`.toLowerCase();
  if (/review|audit|skeptic|critic/.test(raw)) return 'review';
  if (/architect|plan|design|research/.test(raw)) return 'architect';
  if (/ask|explain|answer|read.only/.test(raw)) return 'ask';
  return 'code';
}

function roleCeiling(intent: AgentMode['intent']): ToolName[] {
  if (intent === 'code') return [...ALL_MODE_TOOLS];
  const read: ToolName[] = ['repo_search', 'symbol_search', 'read_file', 'read_range', 'ask_user'];
  if (intent === 'review') return [...read, 'get_diff'];
  if (intent === 'architect') return [...read, 'update_plan', 'update_tasks'];
  return read;
}

function acceptUnique(identities: Map<string, string>, identity: string, sourcePath: string): void {
  const existing = identities.get(identity);
  if (existing) throw new Error(`duplicate identity already imported from ${existing}`);
  identities.set(identity, sourcePath);
}

function validatePattern(pattern: string): void {
  if (!pattern || pattern.length > 300 || pattern.includes('\0') || path.isAbsolute(pattern) || pattern.includes('..')) throw new Error(`unsafe rule pattern '${pattern.slice(0, 80)}'`);
  minimatch('probe.ts', pattern, { dot: true, nocase: process.platform === 'win32' });
}

function safeMinimatch(value: string, pattern: string): boolean {
  try { return minimatch(String(value).replace(/\\/g, '/'), pattern, { dot: true, nocase: process.platform === 'win32' }); } catch { return false; }
}

function boundedStrings(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values.map(String).map(value => value.trim()).filter(Boolean).slice(0, 8).map(value => value.slice(0, 2000));
}

function boundedText(value: unknown, max: number, label: string): string {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new Error(`${label} must be 1-${max} characters`);
  return text;
}

function boundedIdentifier(value: unknown, max: number, label: string): string {
  return boundedText(value, max, label);
}

function validateLimits(limits: CustomizationLimits): void {
  for (const [key, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 1 || value > 10_000_000) throw new Error(`invalid customization limit ${key}`);
}

function assertContained(root: string, candidate: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return;
  throw new Error('customization path escapes the workspace root');
}

function relative(root: string, candidate: string): string {
  return path.relative(root, candidate).replace(/\\/g, '/');
}

function bySource(a: { sourcePath: string; id: string }, b: { sourcePath: string; id: string }): number {
  return a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'customization';
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
