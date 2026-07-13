import { ProviderCapabilities } from './provider';
import { assemblePromptWithinBudget, PromptSection } from './contextBudget';

export type ContextProfileSource = 'provider-catalog' | 'provider-estimate' | 'deterministic-fallback';

export interface ModelContextProfile {
  modelId: string;
  role: string;
  contextTokens: number;
  promptTokenBudget: number;
  outputReserveTokens: number;
  promptCharBudget: number;
  hardCharCap: number;
  source: ContextProfileSource;
  generatedAt: string;
}

const MIN_CONTEXT_TOKENS = 8_192;
const DEFAULT_CONTEXT_TOKENS = 32_000;
const MIN_PROMPT_TOKENS = 4_096;
const MAX_PROMPT_CHARS = 256_000;
const CHARS_PER_TOKEN = 4;

export function createModelContextProfile(
  modelId: string,
  role: string,
  capabilities?: Partial<ProviderCapabilities>,
  source: ContextProfileSource = 'provider-estimate'
): ModelContextProfile {
  const reported = Math.floor(Number(capabilities?.contextLength || 0));
  const contextTokens = Math.max(MIN_CONTEXT_TOKENS, reported || DEFAULT_CONTEXT_TOKENS);
  const outputReserveTokens = Math.max(2_048, Math.min(16_384, Math.floor(contextTokens * (role === 'Architect' ? 0.18 : 0.12))));
  const usable = Math.max(MIN_PROMPT_TOKENS, contextTokens - outputReserveTokens);
  const roleShare = role === 'Architect' ? 0.62 : role === 'Explorer' ? 0.48 : role === 'Reviewer' ? 0.52 : 0.56;
  const promptTokenBudget = Math.max(MIN_PROMPT_TOKENS, Math.min(usable, Math.floor(contextTokens * roleShare)));
  const promptCharBudget = Math.min(MAX_PROMPT_CHARS, promptTokenBudget * CHARS_PER_TOKEN);
  return {
    modelId: String(modelId || 'unknown'),
    role: String(role || 'Orchestrator'),
    contextTokens,
    promptTokenBudget: Math.floor(promptCharBudget / CHARS_PER_TOKEN),
    outputReserveTokens,
    promptCharBudget,
    hardCharCap: MAX_PROMPT_CHARS,
    source: reported ? source : 'deterministic-fallback',
    generatedAt: new Date().toISOString()
  };
}

export function sanitizeContextProfile(profile: ModelContextProfile) {
  return { ...profile };
}

export interface CompactionAbReport {
  generatedAt: string;
  modelId: string;
  scripted: boolean;
  deterministic: { promptChars: number; droppedChars: number; compacted: boolean };
  modelWritten: { promptChars: number; optionalSourceChars: number; summaryChars: number; sourceCompressionChars: number; droppedChars: number; compacted: boolean };
  requiredSectionsPreserved: boolean;
  charDelta: number;
}

export async function compareCompactionStrategies(
  sections: PromptSection[],
  profile: ModelContextProfile,
  summarizeOptional: (text: string, maxChars: number) => Promise<string>,
  scripted = false
): Promise<CompactionAbReport> {
  const deterministic = assemblePromptWithinBudget(sections, profile.promptCharBudget);
  const required = sections.filter(section => section.required);
  const optional = sections.filter(section => !section.required);
  const optionalText = optional.map(section => `[${section.id}]\n${section.content}`).join('\n\n').slice(0, 128_000);
  const summaryLimit = Math.max(512, Math.min(16_000, Math.floor(profile.promptCharBudget * 0.2)));
  const summary = String(await summarizeOptional(optionalText, summaryLimit) || '').trim().slice(0, summaryLimit);
  const modelSections: PromptSection[] = [
    ...required,
    ...(summary ? [{ id: 'model-written-optional-summary', content: summary, priority: 1 }] : [])
  ];
  const modelWritten = assemblePromptWithinBudget(modelSections, profile.promptCharBudget);
  const requiredSectionsPreserved = required.every(section => deterministic.includedSections.includes(section.id) && modelWritten.includedSections.includes(section.id));
  if (!requiredSectionsPreserved) throw new Error('Compaction A/B rejected because a required section was not preserved in both lanes.');
  return {
    generatedAt: new Date().toISOString(),
    modelId: profile.modelId,
    scripted,
    deterministic: { promptChars: deterministic.promptChars, droppedChars: deterministic.droppedChars, compacted: deterministic.compacted },
    modelWritten: { promptChars: modelWritten.promptChars, optionalSourceChars: optionalText.length, summaryChars: summary.length, sourceCompressionChars: Math.max(0, optionalText.length - summary.length), droppedChars: modelWritten.droppedChars, compacted: modelWritten.compacted },
    requiredSectionsPreserved,
    charDelta: deterministic.promptChars - modelWritten.promptChars
  };
}
