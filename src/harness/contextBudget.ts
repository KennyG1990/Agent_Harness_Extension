export interface PromptSection {
  id: string;
  content: string;
  priority: number;
  required?: boolean;
  toolResult?: boolean;
}

export interface PromptBudgetResult {
  text: string;
  budgetChars: number;
  promptChars: number;
  estimatedTokens: number;
  includedSections: string[];
  clearedSections: string[];
  truncatedSections: string[];
  droppedChars: number;
  compacted: boolean;
}

const MIN_PROMPT_BUDGET_CHARS = 1024;
const TRUNCATION_MARKER_RESERVE = 96;

/**
 * Deterministically builds a bounded prompt. Required sections share the
 * budget if they cannot all fit; optional sections are admitted by priority
 * and otherwise cleared from prompt context while remaining on disk.
 */
export function assemblePromptWithinBudget(sections: PromptSection[], requestedBudgetChars: number): PromptBudgetResult {
  const budgetChars = Math.max(MIN_PROMPT_BUDGET_CHARS, Math.floor(Number.isFinite(requestedBudgetChars) ? requestedBudgetChars : MIN_PROMPT_BUDGET_CHARS));
  const normalized = sections.map((section, index) => ({
    ...section,
    index,
    content: String(section.content || '').trim()
  })).filter(section => section.content.length > 0);
  const ids = new Set<string>();
  for (const section of normalized) {
    if (ids.has(section.id)) {
      throw new Error(`Duplicate prompt section id: ${section.id}`);
    }
    ids.add(section.id);
  }

  const required = normalized.filter(section => section.required);
  const optional = normalized
    .filter(section => !section.required)
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const separatorChars = Math.max(0, required.length - 1) * 2;
  const requiredChars = required.reduce((total, section) => total + section.content.length, 0) + separatorChars;
  const selected = new Map<string, string>();
  const truncatedSections: string[] = [];
  let droppedChars = 0;

  if (requiredChars <= budgetChars) {
    for (const section of required) {
      selected.set(section.id, section.content);
    }
  } else if (required.length > 0) {
    const available = Math.max(required.length, budgetChars - separatorChars);
    const initialShare = Math.max(1, Math.floor(available / required.length));
    const allocations = new Map<string, number>();
    for (const section of required) {
      allocations.set(section.id, Math.min(section.content.length, initialShare));
    }
    let remaining = available - Array.from(allocations.values()).reduce((total, value) => total + value, 0);
    while (remaining > 0) {
      const expandable = required.filter(section => (allocations.get(section.id) || 0) < section.content.length);
      if (expandable.length === 0) {
        break;
      }
      const share = Math.max(1, Math.floor(remaining / expandable.length));
      for (const section of expandable) {
        if (remaining <= 0) {
          break;
        }
        const current = allocations.get(section.id) || 0;
        const increment = Math.min(section.content.length - current, share, remaining);
        allocations.set(section.id, current + increment);
        remaining -= increment;
      }
    }
    for (const section of required) {
      const allocation = allocations.get(section.id) || 1;
      if (section.content.length <= allocation) {
        selected.set(section.id, section.content);
        continue;
      }
      const marker = `\n[CONTEXT TRUNCATED: ${section.id}; full detail remains in Forge artifacts]`;
      const markerBudget = Math.min(marker.length, TRUNCATION_MARKER_RESERVE, Math.max(0, allocation - 1));
      const contentBudget = Math.max(1, allocation - markerBudget);
      const truncated = section.content.slice(0, contentBudget) + marker.slice(0, markerBudget);
      selected.set(section.id, truncated.slice(0, allocation));
      truncatedSections.push(section.id);
      droppedChars += Math.max(0, section.content.length - contentBudget);
    }
  }

  let usedChars = Array.from(selected.values()).reduce((total, content) => total + content.length, 0) + Math.max(0, selected.size - 1) * 2;
  const clearedSections: string[] = [];
  for (const section of optional) {
    const separator = selected.size > 0 ? 2 : 0;
    if (usedChars + separator + section.content.length <= budgetChars) {
      selected.set(section.id, section.content);
      usedChars += separator + section.content.length;
    } else {
      clearedSections.push(section.id);
      droppedChars += section.content.length;
    }
  }

  const includedSections = normalized.filter(section => selected.has(section.id)).map(section => section.id);
  const text = normalized
    .filter(section => selected.has(section.id))
    .map(section => selected.get(section.id) || '')
    .join('\n\n')
    .slice(0, budgetChars);
  return {
    text,
    budgetChars,
    promptChars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    includedSections,
    clearedSections,
    truncatedSections,
    droppedChars,
    compacted: clearedSections.length > 0 || truncatedSections.length > 0
  };
}
