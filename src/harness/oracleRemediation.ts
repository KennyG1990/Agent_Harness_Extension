import * as crypto from 'crypto';
import { CompositeOracleResult, OracleResult } from './oracles';
import { OracleFailureEntry, TaskItem } from './types';

export interface OracleFailureUpdate {
  entries: OracleFailureEntry[];
  captured: number;
  repeated: number;
  resolved: number;
}

export function updateOracleFailures(entries: OracleFailureEntry[], composite: CompositeOracleResult, activeTask?: TaskItem, role = 'Oracle'): OracleFailureUpdate {
  const now = new Date().toISOString();
  const current = [...(entries || [])];
  let captured = 0;
  let repeated = 0;
  let resolved = 0;
  if (composite.pass) {
    for (const entry of current) {
      if (entry.status === 'open') {
        entry.status = 'resolved';
        entry.resolvedAt = now;
        entry.resolution = 'Every required project-adapter oracle passed in the same composite verification run.';
        resolved += 1;
      }
    }
    return { entries: current, captured, repeated, resolved };
  }

  for (const result of Object.values(composite.results).filter(item => item.required && !item.pass)) {
    const signature = failureSignature(result);
    const existing = current.find(entry => entry.status === 'open' && entry.signature === signature);
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = now;
      existing.outputExcerpt = boundedOutput(result.output);
      repeated += 1;
      continue;
    }
    current.push({
      id: `oracle-failure-${signature.slice(0, 12)}`,
      signature,
      kind: result.kind,
      category: classifyOracleFailure(result),
      command: result.command,
      source: result.source,
      required: result.required,
      status: 'open',
      occurrences: 1,
      taskId: activeTask?.id || '',
      taskTitle: activeTask?.title || '',
      role,
      outputExcerpt: boundedOutput(result.output),
      guidance: remediationGuidance(result),
      firstSeenAt: now,
      lastSeenAt: now
    });
    captured += 1;
  }
  return { entries: current, captured, repeated, resolved };
}

export function renderOpenOracleFailures(entries: OracleFailureEntry[], limit = 4): string {
  const open = (entries || []).filter(entry => entry.status === 'open').slice(-limit);
  if (!open.length) return '- none';
  return open.map(entry => [
    `- ${entry.kind}/${entry.category} occurrences=${entry.occurrences}`,
    `  Command: ${entry.command || 'missing required command'}`,
    `  Guidance: ${entry.guidance}`,
    `  Output: ${entry.outputExcerpt}`
  ].join('\n')).join('\n');
}

export function failureSignature(result: OracleResult): string {
  const normalized = `${result.kind}|${result.command || 'missing'}|${boundedOutput(result.output)}`
    .toLowerCase().replace(/[a-z]:\\[^\s:]+/g, '<path>').replace(/\/[^\s:]+/g, '<path>').replace(/\d{4}-\d{2}-\d{2}t[^\s]+/g, '<time>').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function classifyOracleFailure(result: OracleResult): OracleFailureEntry['category'] {
  if (result.kind === 'test' && !result.command) return 'missing_test_contract';
  if (result.kind === 'test') return 'test_failure';
  if (result.kind === 'lint') return 'lint_failure';
  if (result.kind === 'typecheck') return 'typecheck_failure';
  return 'build_failure';
}

function remediationGuidance(result: OracleResult): string {
  if (result.kind === 'test' && !result.command) return 'Inspect the project manifest and existing test files. Add the smallest repository-native test contract and meaningful test coverage; do not declare success until the adapter detects and passes it.';
  if (result.kind === 'test') return 'Use the first concrete assertion or stack trace to identify the production defect. Preserve test intent; do not delete, skip, weaken, or rewrite assertions merely to obtain green.';
  if (result.kind === 'lint') return 'Fix the reported files and rules at their source. Do not disable the linter, add blanket ignores, or reduce configured strictness.';
  if (result.kind === 'typecheck') return 'Start from the first compiler diagnostic, trace the violated type contract, and make the smallest compatible source correction. Do not suppress errors with broad any/ignore directives.';
  return 'Reproduce the exact build command, address the first module/configuration/compilation failure, and preserve the configured build. Do not remove or bypass the build script.';
}

function boundedOutput(output: string): string {
  return String(output || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim().slice(0, 1600) || '(no process output)';
}
