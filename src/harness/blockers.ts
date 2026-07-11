import { BlockerCategory, BlockerSource } from './types';

export interface BlockerClassification {
  category: BlockerCategory;
  retryable: boolean;
  suggestedAction: string;
}

export function classifyBlocker(source: BlockerSource, details: string): BlockerClassification {
  const normalized = String(details || '').toLowerCase();
  if (source === 'provider') return result('provider', true, 'Retry with the configured fallback or escalation model.');
  if (source === 'schema') return result('schema', true, 'Repair the structured response to match the tool schema exactly.');
  if (source === 'precommit') return result('precommit_review', true, 'Address the reviewer concerns and propose a narrower mutation.');
  if (source === 'oracle') return result('oracle', true, 'Use the failing oracle output to revise the implementation before rerunning tests.');
  if (source === 'budget') return result('budget', false, 'Pause and request an explicit budget or time extension.');
  if (source === 'progress') return result('no_progress', false, 'Stop repeating the same action and surface the unresolved blocker.');
  if (source === 'step_cap') return result('step_cap', false, 'Resume explicitly with additional bounded steps after reviewing evidence.');
  if (source === 'tool') {
    if (/worker process|timed out|exited before/.test(normalized)) {
      return result('worker_process', true, 'Retry once in a fresh worker process, then escalate with the captured process error.');
    }
    return result('tool_failure', true, 'Inspect the concrete tool output and propose a corrected action.');
  }
  if (/\[role_capability_blocked\]/.test(normalized)) return result('role_capability', true, 'Use only tools allowed for the active role or wait for the owning role.');
  if (/\[network_intent_blocked\]/.test(normalized)) return result('network_policy', true, 'Replace outbound mutation with an auditable local operation or explicit user-controlled workflow.');
  if (/outside the workspace|lies outside|path must be workspace-relative|access denied/.test(normalized)) return result('workspace_scope', true, 'Use an existing workspace-relative path contained by the active root.');
  if (/command policy|blocked token/.test(normalized)) return result('command_policy', true, 'Use a non-destructive command allowed by deterministic policy.');
  if (/malformed patch|expected search\/replace/.test(normalized)) return result('patch_format', true, 'Emit the exact SEARCH/REPLACE format or use a complete write_file recovery.');
  if (/applicability|search block|patch target|context not found|ambiguous/.test(normalized)) return result('patch_applicability', true, 'Reread the target and emit unique current context for the patch.');
  return result('firewall', true, 'Repair the proposal using the deterministic rejection reason.');
}

function result(category: BlockerCategory, retryable: boolean, suggestedAction: string): BlockerClassification {
  return { category, retryable, suggestedAction };
}
