import { HarnessStatus } from './types';
import { ModeIntent } from './modeRegistry';

export type ConversationRoute =
  | 'answer'
  | 'start_run'
  | 'continue_run'
  | 'steer_run'
  | 'answer_clarification'
  | 'resolve_approval'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'inspect_status'
  | 'research'
  | 'clarify_intent';

export interface ConversationRouteContext {
  message: string;
  modeIntent: ModeIntent;
  runStatus?: HarnessStatus;
  pendingClarificationId?: string;
  pendingApprovalId?: string;
}

export interface ConversationRouteDecision {
  route: ConversationRoute;
  reason: string;
  approvalDecision?: 'approve' | 'reject';
  requiresModeChange?: boolean;
}

const TERMINAL = new Set<HarnessStatus>(['success', 'failed', 'gave_up']);
const ACTIVE = new Set<HarnessStatus>(['idle', 'running', 'paused', 'awaiting_input', 'awaiting_approval']);
const MUTATION_INTENT = /\b(add|build|change|create|delete|fix|implement|install|make|migrate|modify|move|refactor|remove|rename|repair|replace|scaffold|set up|update|upgrade|write)\b/i;
const EXPLANATION_INTENT = /^(how|what|why|where|when|who|which|can you explain|explain|describe|summarize|review|analy[sz]e|inspect)\b/i;
const STATUS_INTENT = /\b(status|progress|what changed|what did you change|where are we|current task|evidence|cost|spent|blocker|still running|are you done)\b/i;
const STEER_INTENT = /^(instead|actually|also|do not|don't|stop using|use\b|prefer\b|make sure|change the requirement|new constraint|exclude\b|include\b)/i;
const CONTINUE_INTENT = /^(continue|carry on|proceed|keep going|go ahead|resume the work)\b/i;
const PAUSE_INTENT = /^(pause|hold|wait|stop for now|stop working)\b/i;
const RESUME_INTENT = /^(resume|unpause|continue now)\b/i;
const CANCEL_INTENT = /^(cancel|abort|end the run|give up|stop permanently)\b/i;
const APPROVE_INTENT = /^(approve|approved|yes,? approve|allow|go ahead with (it|that)|yes,? allow)\b/i;
const REJECT_INTENT = /^(reject|rejected|deny|do not approve|don't approve|no,? reject)\b/i;

export class ConversationController {
  public route(input: ConversationRouteContext): ConversationRouteDecision {
    const message = boundedMessage(input.message);
    const normalized = message.toLowerCase();
    const status = input.runStatus;
    const active = Boolean(status && ACTIVE.has(status));
    const terminal = Boolean(status && TERMINAL.has(status));

    if (!message) return { route: 'clarify_intent', reason: 'The submitted message is empty.' };

    if (input.pendingApprovalId) {
      if (APPROVE_INTENT.test(normalized)) return { route: 'resolve_approval', approvalDecision: 'approve', reason: 'The message explicitly approves the active persisted proposal.' };
      if (REJECT_INTENT.test(normalized)) return { route: 'resolve_approval', approvalDecision: 'reject', reason: 'The message explicitly rejects the active persisted proposal.' };
      return { route: 'inspect_status', reason: 'An approval is pending and unrelated text cannot authorize or replace it.' };
    }

    if (input.pendingClarificationId) {
      return { route: 'answer_clarification', reason: 'The active run is waiting for this user answer.' };
    }

    if (/^\/research\s+/i.test(message)) return { route: 'research', reason: 'Explicit deep-research command.' };
    if (/^\/goal\s+/i.test(message)) return this.agenticOrModeGate('Explicit goal command.', input.modeIntent);
    if (/^\/(status|progress)\b/i.test(message)) return { route: 'inspect_status', reason: 'Explicit status command.' };
    if (/^\/pause\b/i.test(message) || PAUSE_INTENT.test(normalized)) return active ? { route: 'pause', reason: 'Explicit pause request for the active run.' } : { route: 'inspect_status', reason: 'There is no active run to pause.' };
    if (/^\/resume\b/i.test(message) || RESUME_INTENT.test(normalized)) return status === 'paused' ? { route: 'resume', reason: 'Explicit resume request for the paused run.' } : active ? { route: 'continue_run', reason: 'The active run can continue to its next boundary.' } : { route: 'inspect_status', reason: 'There is no paused run to resume.' };
    if (/^\/cancel\b/i.test(message) || CANCEL_INTENT.test(normalized)) return active ? { route: 'cancel', reason: 'Explicit terminal cancellation request.' } : { route: 'inspect_status', reason: 'There is no active run to cancel.' };

    if (STATUS_INTENT.test(normalized)) return { route: 'inspect_status', reason: 'The message asks about authoritative run state.' };

    if (active) {
      if (STEER_INTENT.test(normalized) || MUTATION_INTENT.test(normalized)) return { route: 'steer_run', reason: 'The message changes or constrains the active run.' };
      if (CONTINUE_INTENT.test(normalized)) return { route: 'continue_run', reason: 'The message explicitly continues the active run.' };
      if (EXPLANATION_INTENT.test(normalized)) return { route: 'answer', reason: 'The message asks a read-only question while the run remains active.' };
      return { route: 'clarify_intent', reason: 'The message could steer the active run or be advisory; Forge will not guess.' };
    }

    if (MUTATION_INTENT.test(normalized)) {
      if (terminal) return this.agenticOrModeGate('A new implementation request after a terminal run starts a new governed session.', input.modeIntent);
      return this.agenticOrModeGate('Clear implementation or workspace-change intent.', input.modeIntent);
    }

    if (EXPLANATION_INTENT.test(normalized) || normalized.endsWith('?')) return { route: 'answer', reason: 'Clear read-only question or explanation request.' };

    return { route: 'clarify_intent', reason: 'The message does not establish whether workspace changes are intended.' };
  }

  private agenticOrModeGate(reason: string, modeIntent: ModeIntent): ConversationRouteDecision {
    if (modeIntent === 'code') return { route: 'start_run', reason };
    return {
      route: 'clarify_intent',
      reason: `${reason} The selected ${modeIntent} mode is non-mutating.`,
      requiresModeChange: true
    };
  }
}

function boundedMessage(value: unknown): string {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, 20_000);
}
