import { ModelDescriptor, ProviderCapabilities } from './provider';

export type TaskTerrain = 'exploration' | 'planning' | 'simple-edit' | 'complex-edit' | 'review' | 'escalation';

export interface ModelRouteCandidate {
  modelId: string;
  accepted: boolean;
  reason: string;
  promptPrice?: number;
  completionPrice?: number;
  contextLength: number;
  configuredPriority: number;
}

export interface ModelRouteDecision {
  taskId: string;
  role: string;
  terrain: TaskTerrain;
  selectedModelId: string;
  source: 'explicit-role' | 'configured-pool' | 'default-role';
  requiredContextTokens: number;
  candidates: ModelRouteCandidate[];
  decidedAt: string;
}

export interface RouteInput {
  taskId: string;
  taskTitle: string;
  role: string;
  explicitModelId: string;
  defaultModelId: string;
  pool: string[];
  catalog: ModelDescriptor[];
  capabilityFor: (modelId: string) => ProviderCapabilities;
  enabled: boolean;
  retrievalCandidateCount?: number;
  openBlockerCount?: number;
}

export function classifyTaskTerrain(input: Pick<RouteInput, 'taskTitle' | 'role' | 'retrievalCandidateCount' | 'openBlockerCount'>): TaskTerrain {
  const role = String(input.role || '');
  if (role === 'Architect') return 'planning';
  if (role === 'Reviewer') return 'review';
  if (role === 'Escalation') return 'escalation';
  if (role === 'Explorer') return 'exploration';
  const text = String(input.taskTitle || '').toLowerCase();
  const complex = Number(input.openBlockerCount || 0) > 0
    || Number(input.retrievalCandidateCount || 0) > 8
    || /multi[- ]file|architecture|migration|refactor|concurrent|distributed|causal/.test(text);
  return complex ? 'complex-edit' : 'simple-edit';
}

export function chooseModelRoute(input: RouteInput): ModelRouteDecision {
  const terrain = classifyTaskTerrain(input);
  const requiredContextTokens = terrain === 'complex-edit' || terrain === 'exploration' ? 32_000 : 16_000;
  const decidedAt = new Date().toISOString();
  const explicitModelId = String(input.explicitModelId || '').trim();
  const pool = [...new Set((input.pool || []).map(item => String(item || '').trim()).filter(Boolean))];
  const eligibleRole = input.role === 'Explorer' || input.role === 'Editor';
  if (!input.enabled || !eligibleRole || pool.length === 0) {
    return {
      taskId: input.taskId,
      role: input.role,
      terrain,
      selectedModelId: explicitModelId || input.defaultModelId,
      source: explicitModelId ? 'explicit-role' : 'default-role',
      requiredContextTokens,
      candidates: [],
      decidedAt
    };
  }

  const byId = new Map(input.catalog.map(model => [model.id, model]));
  const candidates: ModelRouteCandidate[] = pool.map((modelId, configuredPriority) => {
    const model = byId.get(modelId);
    const capabilities = model
      ? {
        structuredOutput: model.capabilities.includes('structured_output'),
        toolCalls: model.capabilities.includes('tool_calls'),
        vision: model.capabilities.includes('vision'),
        contextLength: model.contextLength
      }
      : input.capabilityFor(modelId);
    const reasons: string[] = [];
    if (!capabilities.structuredOutput) reasons.push('structured output unavailable');
    if (!capabilities.toolCalls) reasons.push('tool calls unavailable');
    if (capabilities.contextLength < requiredContextTokens) reasons.push(`context ${capabilities.contextLength} < ${requiredContextTokens}`);
    return {
      modelId,
      accepted: reasons.length === 0,
      reason: reasons.join('; ') || (model ? 'capability and context requirements pass' : 'provider capability estimate passes; catalog price unavailable'),
      promptPrice: model?.promptPrice,
      completionPrice: model?.completionPrice,
      contextLength: capabilities.contextLength,
      configuredPriority
    };
  });
  const accepted = candidates.filter(candidate => candidate.accepted).sort(compareCandidates);
  const selected = accepted[0];
  return {
    taskId: input.taskId,
    role: input.role,
    terrain,
    selectedModelId: selected?.modelId || explicitModelId || input.defaultModelId,
    source: selected ? 'configured-pool' : explicitModelId ? 'explicit-role' : 'default-role',
    requiredContextTokens,
    candidates,
    decidedAt
  };
}

function compareCandidates(a: ModelRouteCandidate, b: ModelRouteCandidate): number {
  const aKnown = Number.isFinite(a.promptPrice) && Number.isFinite(a.completionPrice);
  const bKnown = Number.isFinite(b.promptPrice) && Number.isFinite(b.completionPrice);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (aKnown && bKnown) {
    const aBlended = Number(a.promptPrice) * 3 + Number(a.completionPrice);
    const bBlended = Number(b.promptPrice) * 3 + Number(b.completionPrice);
    if (aBlended !== bBlended) return aBlended - bBlended;
  }
  return a.configuredPriority - b.configuredPriority || a.modelId.localeCompare(b.modelId);
}

export function configuredWorkerPool(): string[] {
  const value = configValue<unknown>('workerModelPool', []);
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 20) : [];
}

export function costAwareRoutingEnabled(): boolean {
  const value = configValue<unknown>('costAwareRoutingEnabled', false);
  return value === true || String(value).toLowerCase() === 'true';
}

function configValue<T>(key: string, fallback: T): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    return vscode.workspace.getConfiguration('forge').get<T>(key, fallback);
  } catch {
    const envKey = `FORGE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    const raw = process.env[envKey];
    if (raw === undefined) return fallback;
    if (Array.isArray(fallback)) return raw.split(',').map(item => item.trim()).filter(Boolean) as T;
    return raw as T;
  }
}

