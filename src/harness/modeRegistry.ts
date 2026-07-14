import * as crypto from 'crypto';
import { ToolName } from './types';

export type ModeIntent = 'code' | 'architect' | 'ask' | 'review';
export type ModeModelRole = 'code' | 'plan' | 'review';

export interface AgentMode {
  id: string;
  name: string;
  description: string;
  instructions: string;
  intent: ModeIntent;
  modelRole: ModeModelRole;
  inference: 'Instant' | 'Thinking';
  allowedTools: ToolName[];
  builtIn: boolean;
  imported?: boolean;
}

export interface ModeStorage {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: any): PromiseLike<void>;
}

export const MODE_STORAGE_KEY = 'forge.agentModes.v1';
export const ALL_MODE_TOOLS: ToolName[] = ['repo_search', 'symbol_search', 'read_file', 'read_range', 'write_file', 'apply_patch', 'run_command', 'run_tests', 'browser_validate', 'browser_inspect', 'browser_action', 'computer_inspect', 'computer_action', 'external_tool', 'get_diff', 'update_tasks', 'update_plan', 'record_evidence', 'ask_user', 'declare_success'];
export const REQUIRED_CODE_MODE_TOOLS: ToolName[] = ['update_plan', 'run_tests', 'get_diff', 'record_evidence', 'ask_user', 'declare_success'];

const READ_TOOLS: ToolName[] = ['repo_search', 'symbol_search', 'read_file', 'read_range', 'ask_user'];
const FULL_CODE_TOOLS: ToolName[] = [...ALL_MODE_TOOLS];

export const BUILT_IN_MODES: AgentMode[] = [
  builtIn('code', 'Code', 'Default governed coding agent.', 'Implement the user goal through the full Forge workflow.', 'code', 'code', 'Instant', FULL_CODE_TOOLS),
  builtIn('architect', 'Architect', 'Analyze architecture and produce implementation-ready guidance.', 'Inspect and reason about the codebase without making changes.', 'architect', 'plan', 'Thinking', [...READ_TOOLS, 'update_plan', 'update_tasks']),
  builtIn('ask', 'Ask', 'Answer questions without changing the workspace.', 'Explain clearly and do not request mutation tools.', 'ask', 'plan', 'Instant', READ_TOOLS),
  builtIn('code-reviewer', 'Code Reviewer', 'Review code and diffs without implementing changes.', 'Prioritize correctness, regressions, and missing tests.', 'review', 'review', 'Thinking', [...READ_TOOLS, 'get_diff']),
  builtIn('code-simplifier', 'Code Simplifier', 'Simplify code while preserving verified behavior.', 'Prefer bounded refactors and prove behavior with tests.', 'code', 'code', 'Instant', FULL_CODE_TOOLS.filter(tool => tool !== 'browser_validate')),
  builtIn('code-skeptic', 'Code Skeptic', 'Stress-test plans and code before implementation.', 'Surface weak assumptions and concrete failure modes without mutation.', 'review', 'review', 'Thinking', [...READ_TOOLS, 'get_diff']),
  builtIn('debug', 'Debug', 'Diagnose and repair failures systematically.', 'Use concrete diagnostics, bounded edits, and verification feedback.', 'code', 'code', 'Thinking', FULL_CODE_TOOLS),
  builtIn('plan', 'Plan', 'Produce a bounded implementation plan without source edits.', 'Inspect the workspace and explain an implementation-ready plan.', 'architect', 'plan', 'Thinking', [...READ_TOOLS, 'update_plan', 'update_tasks']),
  builtIn('test-engineer', 'Test Engineer', 'Add and repair tests through the governed coding loop.', 'Focus on reproducible failures, coverage, and honest oracle results.', 'code', 'review', 'Thinking', FULL_CODE_TOOLS)
];

export class ModeRegistry {
  private importedModes: AgentMode[] = [];
  public constructor(private readonly storage: ModeStorage) {}

  public list(): AgentMode[] {
    return [...BUILT_IN_MODES.map(cloneMode), ...this.customModes(), ...this.importedModes.map(cloneMode)];
  }

  public setImportedModes(modes: readonly AgentMode[]): void {
    const reserved = new Set([...BUILT_IN_MODES, ...this.customModes()].map(mode => mode.id));
    this.importedModes = modes.filter(mode => !reserved.has(mode.id)).map(cloneMode);
  }

  public resolve(id: string): AgentMode {
    const mode = this.list().find(item => item.id === String(id || '').trim());
    if (!mode) throw new Error(`Unknown Forge mode '${String(id || '').slice(0, 80)}'.`);
    return cloneMode(mode);
  }

  public async upsert(input: Partial<AgentMode>): Promise<AgentMode> {
    const custom = this.customModes();
    const requestedId = String(input.id || '').trim();
    if (this.importedModes.some(mode => mode.id === requestedId)) throw new Error('Imported workspace agents cannot be overwritten; edit the source file and refresh customizations.');
    if (BUILT_IN_MODES.some(mode => mode.id === requestedId)) throw new Error('Built-in modes cannot be overwritten.');
    const id = requestedId || createModeId(String(input.name || 'custom-mode'));
    const existingIndex = custom.findIndex(mode => mode.id === id);
    if (existingIndex < 0 && custom.length >= 20) throw new Error('Custom mode limit reached (20).');
    const mode = validateMode({ ...input, id, builtIn: false });
    const duplicate = custom.find(item => item.id !== id && item.name.toLowerCase() === mode.name.toLowerCase());
    if (duplicate || BUILT_IN_MODES.some(item => item.name.toLowerCase() === mode.name.toLowerCase())) throw new Error(`A mode named '${mode.name}' already exists.`);
    if (existingIndex >= 0) custom[existingIndex] = mode;
    else custom.push(mode);
    await this.storage.update(MODE_STORAGE_KEY, custom);
    return cloneMode(mode);
  }

  public async delete(id: string): Promise<boolean> {
    const normalized = String(id || '').trim();
    if (BUILT_IN_MODES.some(mode => mode.id === normalized)) throw new Error('Built-in modes cannot be deleted.');
    if (this.importedModes.some(mode => mode.id === normalized)) throw new Error('Imported workspace agents cannot be deleted; edit the source file and refresh customizations.');
    const custom = this.customModes();
    const filtered = custom.filter(mode => mode.id !== normalized);
    if (filtered.length === custom.length) return false;
    await this.storage.update(MODE_STORAGE_KEY, filtered);
    return true;
  }

  private customModes(): AgentMode[] {
    const stored = this.storage.get<any[]>(MODE_STORAGE_KEY, []);
    if (!Array.isArray(stored)) return [];
    const valid: AgentMode[] = [];
    for (const candidate of stored.slice(0, 20)) {
      try {
        valid.push(validateMode({ ...candidate, builtIn: false }));
      } catch {
        // Invalid persisted records never enter the trusted registry.
      }
    }
    return valid;
  }
}

export function validateMode(input: Partial<AgentMode>): AgentMode {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const instructions = String(input.instructions || '').trim();
  if (!/^custom-[a-z0-9][a-z0-9-]{2,63}$/.test(id)) throw new Error('Custom mode ID must start with custom- and contain 4-71 lowercase letters, numbers, or hyphens.');
  if (name.length < 2 || name.length > 40) throw new Error('Mode name must be 2-40 characters.');
  if (!description || description.length > 240) throw new Error('Mode description must be 1-240 characters.');
  if (!instructions || instructions.length > 1200) throw new Error('Mode instructions must be 1-1200 characters.');
  if (!['code', 'architect', 'ask', 'review'].includes(String(input.intent))) throw new Error('Mode intent is invalid.');
  if (!['code', 'plan', 'review'].includes(String(input.modelRole))) throw new Error('Mode model role is invalid.');
  if (!['Instant', 'Thinking'].includes(String(input.inference))) throw new Error('Mode inference setting is invalid.');
  if (!Array.isArray(input.allowedTools)) throw new Error('Mode allowedTools must be an array.');
  const allowedTools = Array.from(new Set(input.allowedTools.map(tool => String(tool) as ToolName)));
  const unknown = allowedTools.filter(tool => !ALL_MODE_TOOLS.includes(tool));
  if (unknown.length) throw new Error(`Unknown mode tool(s): ${unknown.join(', ')}.`);
  if (input.intent === 'code') {
    const missing = REQUIRED_CODE_MODE_TOOLS.filter(tool => !allowedTools.includes(tool));
    if (missing.length) throw new Error(`Agentic code modes require proof/workflow tools: ${missing.join(', ')}.`);
  }
  return { id, name, description, instructions, intent: input.intent as ModeIntent, modelRole: input.modelRole as ModeModelRole, inference: input.inference as AgentMode['inference'], allowedTools, builtIn: false };
}

function builtIn(id: string, name: string, description: string, instructions: string, intent: ModeIntent, modelRole: ModeModelRole, inference: AgentMode['inference'], allowedTools: ToolName[]): AgentMode {
  return { id, name, description, instructions, intent, modelRole, inference, allowedTools, builtIn: true };
}

function createModeId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mode';
  return `custom-${slug}-${crypto.randomBytes(3).toString('hex')}`;
}

function cloneMode(mode: AgentMode): AgentMode {
  return { ...mode, allowedTools: [...mode.allowedTools] };
}
