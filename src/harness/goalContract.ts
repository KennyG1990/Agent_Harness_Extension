/**
 * Goal directive parsing — the /goal elicitation surface (Codex-/goal
 * equivalent, firewalled). The user states what success looks like; the
 * parser compiles it into the goal contract. The mandatory oracle gates are
 * ALWAYS appended: user criteria add to the stop condition, they never
 * replace it. The model cannot argue with the oracle.
 */

export interface GoalDirective {
  isDirective: boolean;
  goal: string;
  doneWhen: string[];
  constraints: string[];
  nonGoals: string[];
  budgetUsd?: number;
  maxSteps?: number;
  raw: string;
}

export const MANDATORY_ORACLE_GATES = [
  'run_tests oracle passes',
  'evidence ledger contains the green oracle result'
];

const SECTION_PATTERNS: Array<{ key: 'doneWhen' | 'constraints' | 'nonGoals' | 'budget' | 'maxSteps'; regex: RegExp }> = [
  { key: 'doneWhen', regex: /(?:^|\n)\s*(?:done\s*when|success|success\s*criteria)\s*:\s*([^\n]+)/i },
  { key: 'constraints', regex: /(?:^|\n)\s*constraints?\s*:\s*([^\n]+)/i },
  { key: 'nonGoals', regex: /(?:^|\n)\s*non[- ]?goals?\s*:\s*([^\n]+)/i },
  { key: 'budget', regex: /(?:^|\n)\s*budget\s*:\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i },
  { key: 'maxSteps', regex: /(?:^|\n)\s*max\s*steps\s*:\s*([0-9]+)/i }
];

export function parseGoalDirective(text: string): GoalDirective {
  const raw = String(text || '');
  const trimmed = raw.trim();
  const directiveMatch = trimmed.match(/^\/goal\s+([\s\S]+)$/i);
  if (!directiveMatch) {
    return { isDirective: false, goal: trimmed, doneWhen: [...MANDATORY_ORACLE_GATES], constraints: [], nonGoals: [], raw };
  }
  let body = directiveMatch[1];
  const result: GoalDirective = { isDirective: true, goal: '', doneWhen: [], constraints: [], nonGoals: [], raw };
  for (const section of SECTION_PATTERNS) {
    const match = body.match(section.regex);
    if (!match) {
      continue;
    }
    const value = match[1].trim();
    if (section.key === 'budget') {
      result.budgetUsd = Number(value);
    } else if (section.key === 'maxSteps') {
      result.maxSteps = Number(value);
    } else {
      result[section.key] = value.split(/;|•/).map(item => item.trim()).filter(Boolean);
    }
    body = body.replace(match[0], '\n');
  }
  result.goal = body.replace(/\s+/g, ' ').trim();
  result.doneWhen = dedupe([...result.doneWhen, ...MANDATORY_ORACLE_GATES]);
  return result;
}

export function directiveToGoalOverrides(directive: GoalDirective): {
  doneWhen: string[];
  constraints: string[];
  nonGoals: string[];
  budgetUsd?: number;
  maxSteps?: number;
} {
  return {
    doneWhen: dedupe([...directive.doneWhen, ...MANDATORY_ORACLE_GATES]),
    constraints: directive.constraints,
    nonGoals: directive.nonGoals,
    budgetUsd: directive.budgetUsd,
    maxSteps: directive.maxSteps
  };
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}
