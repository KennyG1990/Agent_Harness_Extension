# Phase 86 Unified Conversational Agent Implementation Plan

## Workflow

Every batch follows `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`.

## Batch 1 - Controller And Route Invariants

Files:

- Create `src/harness/conversationController.ts`.
- Create `scripts/conversation-controller-smoke.mjs`.
- Update `package.json` with the smoke command and public command contribution.

Work:

1. Define bounded route, context, and decision types.
2. Implement deterministic precedence and explicit mode ceilings.
3. Add pure tests for answers, starts, active-run status, steering, continuation, clarification, approval, pause/resume/cancel, terminal-state handling, and ambiguity.

Gate:

- TypeScript compile passes.
- The route matrix passes without VS Code or provider dependencies.

## Batch 2 - Host Conversation Orchestration

Files:

- Update `src/extension.ts`.
- Update `src/harness/sessionStore.ts` only if transcript promotion requires a narrow API.

Work:

1. Add one host `submitConversationMessage` entry point.
2. Factor `runUntilBoundary` from duplicated loops.
3. Route answer, start, continue, steer, clarification, approval, controls, status, and research.
4. Preserve readiness checks and mode policy intersection.
5. Preserve one session identity by transferring chat/context into a newly initialized run.
6. Register `forge-agent.submitMessage` for machine-readable extension-host validation.
7. Keep old bridge messages as compatibility aliases only.

Gate:

- Natural implementation text reaches `initializeHarness`.
- Advisory text causes no harness initialization or mutation.
- Active-run follow-ups reuse the same session and cumulative cost.
- Pending gates bind to the trusted IDs.

## Batch 3 - One-Composer Product UI

Files:

- Update `src/webview/src/App.tsx`.
- Update webview types only as required.

Work:

1. Replace `sendChat` and `startRunFromComposer` with `submitMessage`.
2. Make Enter and the single send icon use `submit-message`.
3. Remove Play and single-step controls from the normal composer.
4. Retain contextual pause/resume and compact model/mode/inference/context controls.
5. Update `/goal` help so submission, not a Run button, starts work.
6. Keep controller responses and harness events in one transcript.

Gate:

- Exactly one submission affordance is visible at desktop and narrow widths.
- No installed-product copy instructs the user to use Send versus Run.

## Batch 4 - Causal And Negative Proof

Files:

- Extend `scripts/conversation-controller-smoke.mjs` or add a focused fixture script.
- Update `scripts/smoke-tests.mjs` and `scripts/visual-smoke.mjs`.
- Update `src/test/suite/index.ts` for the registered command path.

Work:

1. Run a scripted-provider disposable fixture from a natural language message.
2. Prove resulting changes pass through harness state and same-run green evidence.
3. Prove advisory and ambiguous routes do not mutate.
4. Prove red oracle, forged approval, replayed approval, and terminal resurrection fail.
5. Prove start, clarification, approval, steer, pause, reload/resume, and finish retain one session.
6. Update static and visual assertions for one composer.

Gate:

- Unit/static, integration, E2E, and visual suites pass.
- No paid OpenRouter call is made.

## Batch 5 - Release Close

Files:

- Update version to `0.86.0`.
- Update `ROADMAP.md`, `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`, `HANDOFF_OPUS.md`, and `BUILD_LOG.md`.

Work:

1. Run compile, full tests, E2E, visual tests, and package.
2. Install the VSIX in VS Code and Antigravity.
3. Visually verify the one-composer surface and basic interaction.
4. Record exact outputs, package size/hash, limitations, review findings, document close, and AAR.

Release gate:

- Installed VS Code causal fixture passes.
- Installed Antigravity opens the same VSIX and the unified composer responds at smoke level.
- Documentation makes no claim beyond collected evidence.

## Document Close

Status: **PASS - released as 0.86.0**.

All five batches completed. Review found and fixed a pause/cancel concurrency race by persisting cancellation and consuming it at the next governed boundary before another provider call. Compile, static, causal/negative, visual, extension-host, package, VS Code install, Antigravity install, and fresh installed interaction gates pass. No paid provider call ran.

Suggested commit title: `Phase 86: unify conversation with the governed agent loop`.
