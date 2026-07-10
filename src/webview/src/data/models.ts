export type ModelCapability = 'tool_calls' | 'structured_output' | 'vision';

export interface ModelDefinition {
  id: string;
  name: string;
  capabilities: ModelCapability[];
  contextLength: number;
  provider: string;
}

export interface RoleDefinition {
  key: string; // e.g. 'reason', 'code'
  name: string; // e.g. 'Reasoning Agent'
  description: string;
  requiredCapabilities: ModelCapability[];
  isCustom?: boolean;
}

// Master list of standard OpenRouter models with their pre-mapped high-fidelity capability details.
// These are also used as high-fidelity fallbacks when offline or if the API limit is hit.
export const STANDARD_MODELS: ModelDefinition[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Google: Gemini 2.5 Flash',
    capabilities: ['tool_calls', 'structured_output', 'vision'],
    contextLength: 1048576,
    provider: 'Google'
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Google: Gemini 2.5 Pro',
    capabilities: ['tool_calls', 'structured_output', 'vision'],
    contextLength: 2097152,
    provider: 'Google'
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek: DeepSeek V3 (Chat)',
    capabilities: ['tool_calls', 'structured_output'],
    contextLength: 64000,
    provider: 'DeepSeek'
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek: DeepSeek R1 (Reasoning)',
    capabilities: ['structured_output'], // No vision, standard tool call formatting can be unstable
    contextLength: 128000,
    provider: 'DeepSeek'
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Anthropic: Claude 3.5 Sonnet',
    capabilities: ['tool_calls', 'structured_output', 'vision'],
    contextLength: 200000,
    provider: 'Anthropic'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Meta: LLaMA 3.3 70B Instruct',
    capabilities: ['tool_calls', 'structured_output'], // Text-only
    contextLength: 128000,
    provider: 'Meta'
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    capabilities: ['tool_calls', 'structured_output', 'vision'],
    contextLength: 128000,
    provider: 'OpenAI'
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'OpenAI: GPT-4o Mini',
    capabilities: ['tool_calls', 'structured_output', 'vision'],
    contextLength: 128000,
    provider: 'OpenAI'
  },
  {
    id: 'mistralai/codestral-2501',
    name: 'Mistral: Codestral 2501',
    capabilities: ['tool_calls', 'structured_output'], // No native vision
    contextLength: 32000,
    provider: 'Mistral'
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen: Qwen 2.5 72B Instruct',
    capabilities: ['tool_calls', 'structured_output'], // No native vision
    contextLength: 32000,
    provider: 'Alibaba'
  }
];

// Core slots / roles of the agent harness as requested
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    key: 'reason',
    name: 'Reasoning Agent',
    description: 'Executes complex logical lookaheads, self-critique, and algorithmic analysis.',
    requiredCapabilities: ['structured_output', 'tool_calls']
  },
  {
    key: 'code',
    name: 'Coding Editor',
    description: 'Generates patch modifications, writes code blocks, and applies context-anchored updates.',
    requiredCapabilities: ['structured_output']
  },
  {
    key: 'review',
    name: 'Reviewer Auditor',
    description: 'Inspects modified files to enforce firewall safety, rulesets, and constraints check.',
    requiredCapabilities: ['structured_output']
  },
  {
    key: 'plan',
    name: 'Architect Planner',
    description: 'Decomposes primary goal statements into stateful task graphs and todo sequences.',
    requiredCapabilities: ['structured_output']
  },
  {
    key: 'vision',
    name: 'Vision Analyzer',
    description: 'Interprets layout snapshots, diagrams, design styles, and asset dimensions.',
    requiredCapabilities: ['vision']
  },
  {
    key: 'escalate',
    name: 'Recovery Escalate',
    description: 'Acts as fallback for human mediation when bounds are exceeded or loops fail continuously.',
    requiredCapabilities: ['tool_calls']
  }
];

export type ModelBindingsTable = Record<string, string>; // roleKey -> modelId

export const PERSISTED_BINDINGS_KEY = 'forge_model_bindings_v1';
export const PERSISTED_ROLES_KEY = 'forge_custom_roles_v1';

export const DEFAULT_BINDINGS: ModelBindingsTable = {
  reason: 'google/gemini-2.5-pro',
  code: 'deepseek/deepseek-chat',
  review: 'openai/gpt-4o-mini',
  plan: 'google/gemini-2.5-flash',
  vision: 'google/gemini-2.5-flash',
  escalate: 'google/gemini-2.5-pro'
};

// Map role designations safely based on table
export function resolveModelForRole(
  roleKey: string,
  bindings: ModelBindingsTable,
  modelsCatalog: ModelDefinition[]
): ModelDefinition {
  const modelId = bindings[roleKey] || DEFAULT_BINDINGS[roleKey] || 'google/gemini-2.5-flash';
  const match = modelsCatalog.find(m => m.id === modelId);
  return match || {
    id: modelId,
    name: modelId.split('/').pop() || modelId,
    capabilities: ['structured_output'],
    contextLength: 128000,
    provider: 'Unknown'
  };
}

export interface ProbeResult {
  roleKey: string;
  modelId: string;
  testTimestamp: string;
  capabilitiesTested: {
    tool_calls: { checked: boolean; pass: boolean; log: string };
    structured_output: { checked: boolean; pass: boolean; log: string };
    vision: { checked: boolean; pass: boolean; log: string };
  };
  overallPass: boolean;
  warnings: string[];
}

// Check if model fits the role requirements
export function assessModelCapabilities(
  role: RoleDefinition,
  model: ModelDefinition
): { hasRequired: boolean; missing: ModelCapability[] } {
  const missing = role.requiredCapabilities.filter(cap => !model.capabilities.includes(cap));
  return {
    hasRequired: missing.length === 0,
    missing
  };
}
