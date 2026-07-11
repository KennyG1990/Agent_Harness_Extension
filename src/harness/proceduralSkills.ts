import * as crypto from 'crypto';
import { SkillItem } from './types';

export interface SkillBankInput {
  terminalStatus: string;
  goal: string;
  sessionId: string;
  languageExtensions: string[];
  reflectionAttempts: number;
  oracleReflectionAttempts?: number;
  validationFailures: number;
  repairAttempts: number;
  preCommitBlocks: number;
  escalationCount: number;
  resolvedBlockerCategories: string[];
  timestamp?: string;
}

export interface SkillSelection {
  skills: SkillItem[];
  selected: SkillItem[];
}

interface SkillTemplate {
  category: string;
  name: string;
  description: string;
  workflow: string[];
  signals: string[];
}

const TEMPLATES: SkillTemplate[] = [
  {
    category: 'proposal_repair',
    name: 'Repair rejected structured edits',
    description: 'Recover from malformed or inapplicable edit proposals without bypassing the firewall.',
    workflow: [
      'Read the exact target file before proposing another mutation.',
      'Copy the SEARCH block verbatim from the current file and include enough unique context.',
      'If repeated patch formatting fails, switch to one complete write_file proposal.',
      'Run the verification oracle after the accepted edit and preserve its output as evidence.'
    ],
    signals: ['patch_format', 'patch_applicability', 'schema', 'firewall']
  },
  {
    category: 'oracle_recovery',
    name: 'Use red-oracle output as repair context',
    description: 'Turn a deterministic test, typecheck, or lint failure into a bounded corrective iteration.',
    workflow: [
      'Read the latest oracle output and identify the first concrete failing behavior or location.',
      'Inspect only the implicated source and its immediate dependency surface.',
      'Apply the smallest correction consistent with the goal contract.',
      'Rerun the same oracle; do not claim success until green output is recorded.'
    ],
    signals: ['oracle']
  },
  {
    category: 'review_recovery',
    name: 'Recover from reviewer rejection',
    description: 'Address a deterministic or model reviewer block before committing a mutation.',
    workflow: [
      'Read the reviewer reason and identify the exact scope, safety, or correctness objection.',
      'Revise the proposal rather than narrating around the rejection.',
      'Inspect the resulting native diff for unrelated changes.',
      'Run tests and record green evidence before requesting success.'
    ],
    signals: ['precommit_review']
  },
  {
    category: 'escalated_recovery',
    name: 'Decompose before model escalation',
    description: 'Use a stronger model only after preserving the failed attempt and narrowing the unresolved decision.',
    workflow: [
      'Summarize the deterministic blocker and the approaches already rejected.',
      'Reduce the next request to one unresolved technical decision or bounded edit.',
      'Route that request to the configured escalation role with prior evidence attached.',
      'Return the escalated proposal through the same firewall and oracle gates.'
    ],
    signals: ['provider', 'no_progress', 'step_cap']
  }
];

export function bankProceduralSkills(existing: SkillItem[], input: SkillBankInput): { skills: SkillItem[]; bankedIds: string[] } {
  if (input.terminalStatus !== 'success') return { skills: normalizeSkills(existing), bankedIds: [] };
  const categories = new Set(input.resolvedBlockerCategories);
  const templates = TEMPLATES.filter(template => {
    if (template.category === 'proposal_repair') return input.validationFailures > 0 || input.repairAttempts > 0 || template.signals.some(signal => categories.has(signal));
    if (template.category === 'oracle_recovery') return (input.oracleReflectionAttempts || 0) > 0 || categories.has('oracle');
    if (template.category === 'review_recovery') return input.preCommitBlocks > 0 || categories.has('precommit_review');
    return input.escalationCount > 0;
  });
  if (!templates.length) return { skills: normalizeSkills(existing), bankedIds: [] };

  const now = input.timestamp || new Date().toISOString();
  const goalTokens = tokenize(input.goal).slice(0, 16);
  const languageTokens = input.languageExtensions.map(value => value.replace(/^\./, '').toLowerCase()).filter(Boolean);
  const skills = normalizeSkills(existing);
  const bankedIds: string[] = [];
  for (const template of templates) {
    const triggerTokens = Array.from(new Set([...template.signals, ...languageTokens, ...goalTokens])).slice(0, 24);
    const id = `skill-${crypto.createHash('sha1').update(`${template.category}:${languageTokens.sort().join(',')}`).digest('hex').slice(0, 12)}`;
    const prior = skills.find(skill => skill.id === id);
    if (prior) {
      prior.occurrences = (prior.occurrences || 1) + 1;
      prior.successfulRuns = (prior.successfulRuns || 1) + 1;
      prior.confidence = Math.min(0.98, Number(((prior.confidence || 0.7) + 0.04).toFixed(2)));
      prior.updatedAt = now;
      prior.triggerTokens = Array.from(new Set([...(prior.triggerTokens || []), ...triggerTokens])).slice(0, 32);
      prior.sourceSessionIds = Array.from(new Set([...(prior.sourceSessionIds || []), input.sessionId])).slice(-10);
    } else {
      skills.push({
        id,
        name: template.name,
        description: template.description,
        workflow: template.workflow,
        category: template.category,
        triggerTokens,
        confidence: 0.7,
        occurrences: 1,
        successfulRuns: 1,
        useCount: 0,
        sourceSessionIds: [input.sessionId],
        appliedSessionIds: [],
        createdAt: now,
        updatedAt: now
      });
    }
    bankedIds.push(id);
  }
  return { skills: skills.slice(-50), bankedIds };
}

export function selectProceduralSkills(existing: SkillItem[], query: string, blockerCategories: string[], sessionId: string, limit = 3): SkillSelection {
  const queryTokens = new Set(tokenize(`${query} ${blockerCategories.join(' ')}`));
  const blockerSet = new Set(blockerCategories);
  const skills = normalizeSkills(existing);
  const ranked = skills.map(skill => {
    const overlap = (skill.triggerTokens || []).filter(token => queryTokens.has(token)).length;
    const categoryBoost = blockerSet.has(skill.category || '') ? 8 : 0;
    const score = overlap * 3 + categoryBoost + (skill.confidence || 0) + Math.min(3, Math.log2((skill.successfulRuns || 1) + 1));
    return { skill, score, overlap, categoryBoost };
  }).filter(item => item.overlap > 0 || item.categoryBoost > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, Math.max(0, limit));
  const selected = ranked.map(item => item.skill);
  const now = new Date().toISOString();
  for (const skill of selected) {
    const sessions = skill.appliedSessionIds || [];
    if (!sessions.includes(sessionId)) {
      skill.useCount = (skill.useCount || 0) + 1;
      skill.appliedSessionIds = [...sessions, sessionId].slice(-20);
    }
    skill.lastUsedAt = now;
  }
  return { skills, selected };
}

export function renderProceduralSkills(skills: SkillItem[]): string {
  if (!skills.length) return '';
  return skills.map(skill => [
    `Skill: ${skill.name} [${skill.category || 'general'}; confidence=${(skill.confidence || 0).toFixed(2)}; verified-runs=${skill.successfulRuns || 0}]`,
    ...skill.workflow.map((step, index) => `${index + 1}. ${step}`)
  ].join('\n')).join('\n\n');
}

function normalizeSkills(existing: SkillItem[]): SkillItem[] {
  if (!Array.isArray(existing)) return [];
  return existing.filter(skill => skill && typeof skill.id === 'string' && Array.isArray(skill.workflow)).map(skill => ({
    ...skill,
    workflow: skill.workflow.map(String).filter(Boolean).slice(0, 8),
    triggerTokens: Array.isArray(skill.triggerTokens) ? skill.triggerTokens.map(String).map(token => token.toLowerCase()).filter(Boolean).slice(0, 32) : [],
    sourceSessionIds: Array.isArray(skill.sourceSessionIds) ? skill.sourceSessionIds.map(String).slice(-10) : [],
    appliedSessionIds: Array.isArray(skill.appliedSessionIds) ? skill.appliedSessionIds.map(String).slice(-20) : []
  }));
}

function tokenize(text: string): string[] {
  return Array.from(new Set(String(text || '').toLowerCase().split(/[^a-z0-9_]+/).filter(token => token.length >= 3)));
}
