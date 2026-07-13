# Phase 86 Unified Conversational Agent Design

## Objective

Make Forge present one continuous agent conversation while preserving the existing deterministic harness as the only mutation authority. A normal implementation request must start the governed run without a separate Run control. Questions remain read-only, and uncertainty about consequential intent must stop at an ask gate.

## Reconciled Current State

The installed 0.85 product has two submission paths:

- `chat` calls a tool-less completion and tells the user to press Run for work.
- `run-agent-loop` initializes and schedules `AgentHarnessLoop`.

The harness already owns goal contracts, workflow stages, schema validation, firewall checks, approvals, clarification identity, checkpoints, reviewer gates, oracles, evidence, cost, no-progress handling, and terminal-state enforcement. Phase 86 must route conversation into that authority, not duplicate it.

## Authority Model

`ConversationController` is a deterministic host component. It may:

1. Inspect trusted session and harness state.
2. Classify one bounded route from a user message.
3. Schedule an existing host operation for that route.
4. Produce host-authored status narration from authoritative state.

It may not invoke workspace mutation tools, manufacture success, weaken a mode ceiling, accept an approval without the pending identity, or create a second active run in a session.

The execution chain remains:

`conversation message -> host route -> AgentHarnessLoop -> PROPOSE -> VALIDATE -> COMMIT -> NARRATE`

## Route Contract

The controller returns one of:

- `answer`: read-only response using bounded workspace and conversation context.
- `start_run`: initialize one new governed run from the message.
- `continue_run`: schedule the current non-terminal run to its next boundary.
- `steer_run`: persist a new constraint or correction and continue at a safe boundary.
- `answer_clarification`: bind the message to the active clarification ID.
- `resolve_approval`: bind an explicit approval or rejection to the active approval ID.
- `pause`, `resume`, `cancel`: deterministic host controls.
- `inspect_status`: summarize trusted run state without a provider call.
- `research`: retain the existing explicit deep-research command.
- `clarify_intent`: ask whether an ambiguous consequential request should change the workspace.

## Deterministic Precedence

1. Pending approval plus an explicit approve/reject phrase.
2. Pending clarification.
3. Explicit slash commands and run controls.
4. Status/progress/evidence questions.
5. Active-run steering or continuation.
6. Clear implementation, repair, refactor, test, or creation intent in a code-capable mode.
7. Clear explanatory intent.
8. Consequential but ambiguous intent becomes `clarify_intent`.
9. Remaining text becomes `answer`.

Ask, Architect, and Review modes impose a non-mutating route ceiling. A mutation request in one of those modes becomes `clarify_intent` with an instruction to switch to a code-capable mode; text alone cannot elevate authority.

## Session Continuity

- One session ID owns the bounded transcript and at most one harness state.
- A chat-only session is promoted into the run session when work begins. Its transcript and composer context are copied into the run session before the chat session becomes inactive.
- Messages during an active run never initialize a second run.
- Clarification, approval, steering, cost, and evidence remain attached to the same run session.
- Terminal runs cannot resume or mutate. A new implementation request creates an explicit new run session.

## Scheduling

All autonomous scheduling uses one `runUntilBoundary` host helper. It calls `runStep` only while the trusted state is non-terminal and not paused, awaiting input, or awaiting approval. Existing max-step, cost, wall-clock, workflow, and no-progress limits remain authoritative.

## UI Contract

- One bottom composer and one send button.
- Enter and the send button post `submit-message`.
- No permanent Play or single-step controls in the normal composer.
- Pause/resume remain contextual controls for an active run.
- Progress, clarification, approval, and evidence stay in the same timeline.
- Explicit command APIs remain for automation and debugging.

## Compatibility

The old `chat` and `run-agent-loop` bridge messages remain temporary aliases during migration, but the product webview must not emit them. Existing command APIs remain available. A new `forge-agent.submitMessage` command exposes the same controller path for extension-host tests and external automation.

## Failure Rules

- Routing failures never fall through to mutation.
- Provider readiness is required only for routes that call a provider.
- Advisory answers cannot call mutating tools.
- A missing or mismatched clarification/approval identity is rejected.
- A red oracle cannot be narrated as success.
- Cancellation is terminal and cannot be silently resumed.

## Proof Requirements

Phase 86 is complete only after pure route tests, controller integration tests, extension-host tests, one-composer visual proof, disposable causal fixture proof, package verification, and installed VS Code plus Antigravity smoke evidence pass without paid provider calls.
