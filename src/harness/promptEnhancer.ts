import * as crypto from 'crypto';
import { ChatUsage, Provider } from './provider';

const MAX_DRAFT_CHARS = 12_000;
const MAX_FIELD_CHARS = 4_000;
const MAX_LIST_ITEMS = 12;

export interface PromptEnhancementInput {
  draft: string;
  modelId: string;
  sessionId: string;
  modeName?: string;
}

export interface PromptEnhancementResult {
  enhancedPrompt: string;
  modelId: string;
  originalDigest: string;
  usage?: ChatUsage;
  generatedAt: string;
}

interface StructuredEnhancement {
  objective: string;
  scope: string;
  constraints: string[];
  acceptanceCriteria: string[];
  evidence: string[];
  openQuestions: string[];
}

export const PROMPT_ENHANCEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objective', 'scope', 'constraints', 'acceptanceCriteria', 'evidence', 'openQuestions'],
  properties: {
    objective: { type: 'string', minLength: 1, maxLength: MAX_FIELD_CHARS },
    scope: { type: 'string', minLength: 1, maxLength: MAX_FIELD_CHARS },
    constraints: { type: 'array', maxItems: MAX_LIST_ITEMS, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    acceptanceCriteria: { type: 'array', minItems: 1, maxItems: MAX_LIST_ITEMS, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    evidence: { type: 'array', minItems: 1, maxItems: MAX_LIST_ITEMS, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    openQuestions: { type: 'array', maxItems: MAX_LIST_ITEMS, items: { type: 'string', minLength: 1, maxLength: 1000 } }
  }
} as const;

export async function enhancePrompt(provider: Provider, input: PromptEnhancementInput): Promise<PromptEnhancementResult> {
  const draft = String(input.draft || '').trim();
  if (!draft) throw new Error('Enter a prompt before enhancing it.');
  if (draft.length > MAX_DRAFT_CHARS) throw new Error(`Prompt enhancement is limited to ${MAX_DRAFT_CHARS.toLocaleString()} characters.`);
  const modelId = String(input.modelId || '').trim();
  if (!modelId) throw new Error('Configure a prompt enhancement model first.');
  const sessionId = String(input.sessionId || '').trim() || `forge-enhance-${Date.now()}`;
  const modelFamilyGuidance = /claude-(?:fable|mythos)-5/i.test(modelId)
    ? 'For this Claude model family: act once the draft supplies enough facts, stay tightly scoped, ground the rewrite only in supplied evidence, and do not reproduce hidden reasoning.'
    : '';

  const result = await provider.generateChat({
    modelId,
    sessionId,
    responseFormatSchema: PROMPT_ENHANCEMENT_SCHEMA,
    messages: [
      {
        role: 'system',
        content: [
          'Rewrite the user draft into an implementation-ready task prompt. Do not answer or execute the task.',
          'Preserve the user intent and requested scope. Do not invent repository facts, requirements, files, commands, or success claims.',
          'Resolve only ambiguity supported by the draft. Put genuinely user-owned unresolved decisions in openQuestions.',
          'Prefer concrete objective, bounded scope, explicit constraints, observable acceptance criteria, and exact categories of evidence.',
          'Do not request hidden reasoning, chain-of-thought, context counts, or unrestricted authority.',
          'Return only the required JSON object. The extension host will render it for user review and will not auto-submit it.',
          modelFamilyGuidance
        ].filter(Boolean).join('\n')
      },
      {
        role: 'user',
        content: `Trusted selected mode: ${boundedText(input.modeName || 'Code', 100)}\n\nDraft to enhance:\n${draft}`
      }
    ]
  });

  const structured = parseEnhancement(result.text);
  return {
    enhancedPrompt: renderEnhancement(structured),
    modelId,
    originalDigest: crypto.createHash('sha256').update(draft).digest('hex'),
    usage: result.usage,
    generatedAt: new Date().toISOString()
  };
}

export function parseEnhancement(raw: string): StructuredEnhancement {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The prompt enhancement model returned malformed structured output. The original draft was preserved.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The prompt enhancement response must be an object. The original draft was preserved.');
  const allowedKeys = new Set(['objective', 'scope', 'constraints', 'acceptanceCriteria', 'evidence', 'openQuestions']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) throw new Error('Prompt enhancement returned unexpected fields. The original draft was preserved.');
  const objective = boundedRequired(value.objective, 'objective');
  const scope = boundedRequired(value.scope, 'scope');
  const constraints = boundedList(value.constraints, 'constraints', false);
  const acceptanceCriteria = boundedList(value.acceptanceCriteria, 'acceptanceCriteria', true);
  const evidence = boundedList(value.evidence, 'evidence', true);
  const openQuestions = boundedList(value.openQuestions, 'openQuestions', false);
  return { objective, scope, constraints, acceptanceCriteria, evidence, openQuestions };
}

function renderEnhancement(value: StructuredEnhancement): string {
  const sections = [
    `Objective:\n${value.objective}`,
    `Scope:\n${value.scope}`,
    value.constraints.length ? `Constraints:\n${bullets(value.constraints)}` : '',
    `Done when:\n${bullets(value.acceptanceCriteria)}`,
    `Required evidence:\n${bullets(value.evidence)}`,
    value.openQuestions.length ? `Open questions for the user:\n${bullets(value.openQuestions)}` : ''
  ];
  return sections.filter(Boolean).join('\n\n');
}

function boundedRequired(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_FIELD_CHARS) throw new Error(`Prompt enhancement returned invalid ${field}. The original draft was preserved.`);
  const normalized = boundedText(value, MAX_FIELD_CHARS);
  if (!normalized) throw new Error(`Prompt enhancement omitted ${field}. The original draft was preserved.`);
  return normalized;
}

function boundedList(value: unknown, field: string, required: boolean): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS || value.some(item => typeof item !== 'string' || item.length > 1000)) throw new Error(`Prompt enhancement returned invalid ${field}. The original draft was preserved.`);
  const normalized = value.map(item => boundedText(item, 1000)).filter(Boolean);
  if (required && !normalized.length) throw new Error(`Prompt enhancement omitted ${field}. The original draft was preserved.`);
  return normalized;
}

function boundedText(value: unknown, maxChars: number): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, maxChars);
}

function bullets(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n');
}
