# Forge Agent Product Roadmap

## Product Direction

Forge is a conversational coding agent for VS Code and Antigravity whose execution is governed by deterministic infrastructure. The user should interact with one familiar bottom-anchored chat composer. The model may reason, ask questions, explain progress, and propose actions, but it never owns mutation, authorization, verification, or terminal success.

The product contract is:

`conversation -> intent routing -> governed run -> compact narration`

Every consequential action inside a governed run remains:

`PROPOSE -> VALIDATE -> APPROVE when required -> COMMIT -> NARRATE`

Every implementation task remains:

`PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

Kilo-style interaction is the UX target. Forge's research-backed harness is the execution authority. These are complementary layers, not competing product directions.

## Non-Negotiable Invariants

- The model emits structured proposals; deterministic code decides whether they are valid.
- Chat text, narration, progress text, and model confidence never mutate state directly.
- User acceptance criteria add to mandatory verification gates and cannot remove them.
- Material uncertainty triggers a bounded `ask_user` gate before consequential work.
- File, command, browser, and computer authority remains host-owned and scope-bounded.
- Human approval occurs after deterministic validation and before the exact approved action executes.
- Terminal success requires a green same-run oracle, required review, completed workflow gates, and durable evidence.
- Deterministic fallback work is reported separately and never counted as model-driven success.
- Sessions preserve conversation, run state, cost, evidence, approvals, and resumability under one identity.
- Native IDE editors, terminals, diffs, settings, and file explorer remain the primary host surfaces.
- Installed-product proof is distinct from source, compile, automated, and packaged proof.

## Current Baseline

Implemented through installed version `0.86.0`:

- Compact chat/composer extension UI with model, role, inference, context, index, approval, run control, evidence, and settings actions.
- OpenRouter catalog/routing, role models, provider readiness, secret storage, budgets, and fallback provider interface.
- Structured agent loop, tool registry, firewall, workflow governance, project adapters, oracles, reflection, escalation, reviewer gates, checkpoints, transactions, evidence, and AAR.
- Workspace search/index, `@file` and `@folder`, active file/selection/diagnostic attachments, durable sessions, progress streaming, and native artifact access.
- Weak-model, reflection, tiered, isolated, proof-matrix, and difficult-live evaluation surfaces with honest model-driven/fallback accounting.

Phase 85 is release-closed:

- Loopback `browser_inspect` and state-bound `browser_action` through Playwright.
- Allowlisted Windows `computer_inspect` and state-bound `computer_action` through UI Automation.
- External actions always require exact digest-bound human approval.
- Focused browser, WPF/UIA, approval, static, broad regression, visual, and VS Code extension-host tests pass.
- `forge-agent-0.85.0.vsix` packages 155 files, installs in Antigravity as `kennyg.forge-agent@0.85.0`, and opens the real compact Forge Studio panel.

Phase 86 is release-closed:

- A deterministic `ConversationController` routes one composer into read-only answers, governed runs, continuation, steering, clarification, exact approval, controls, status, and research.
- Natural implementation requests enter the existing `AgentHarnessLoop`; no second mutation loop or direct tool authority was added.
- The product webview emits only `submit-message` and exposes one send action. Legacy `chat` and `run-agent-loop` messages remain host compatibility aliases only.
- Causal, negative, static, visual, and extension-host gates pass with no paid provider call. The same VSIX is installed in VS Code and Antigravity as `0.86.0`.
- A fresh Antigravity window visibly submitted an ambiguous message and received the host-authored ask gate in the same timeline.

## Phase 86 - Unified Conversational Agent

Status: **IMPLEMENTED AND RELEASE-CLOSED in 0.86.0**

### Problem

Forge currently exposes two artificial agents:

- **Send** invokes a tool-less advisory chat completion.
- **Run** starts the governed `AgentHarnessLoop` through a separate control.

The split protects the harness but makes the product appear non-agentic. It forces users to understand internal execution modes and prevents a natural conversation from becoming, steering, clarifying, and completing a governed coding task.

### User Contract

The user talks to one Forge agent in one continuous conversation. Examples:

- “Explain how authentication works” produces a grounded, non-mutating answer.
- “Add password reset with expiring tokens” starts a governed run automatically.
- “Use PostgreSQL, not Redis” steers the active run at the next safe boundary.
- “Yes, use the existing migration framework” answers the pending clarification and resumes the same run.
- “Approve” or the approval card authorizes only the displayed persisted proposal.
- “Stop” pauses or cancels before the next bounded action.
- “What changed?” narrates current authoritative run state and evidence.

The user does not need to choose between Send and Run or understand PLAN files, task graphs, tool calls, or workflow-stage mechanics to obtain useful behavior.

### Architecture

Add a host-owned `ConversationController` in front of chat and `AgentHarnessLoop`.

For each user message, deterministic host state and a bounded structured intent classifier select exactly one route:

| Route | Meaning | Authority |
|---|---|---|
| `answer` | Explain or answer without mutation | Read-only context; no mutating tools |
| `start_run` | New implementation/debug/refactor/test task | Initialize governed harness |
| `continue_run` | Continue the active autonomous task | Existing run state and remaining budget |
| `steer_run` | Change scope, constraint, priority, or acceptance criterion | Merge at safe step boundary; preserve history/cost |
| `answer_clarification` | Resolve the pending `ask_user` gate | Match active clarification identity |
| `resolve_approval` | Approve/reject pending exact proposal | Match approval ID and digest |
| `pause` / `resume` / `cancel` | Run control | Host-owned control state |
| `inspect_status` | Explain progress, blockers, artifacts, or evidence | Read authoritative state only |

Ambiguous routing defaults to a focused clarification, not silent mutation. Explicit commands remain available as deterministic overrides, but normal language is the primary interface.

### Conversation And Run State

- One session ID owns the bounded transcript and at most one active governed run.
- Starting work from chat creates the goal contract, workflow, task graph, plan, scratchpad, and evidence artifacts under that session.
- Progress events, questions, approvals, tool summaries, oracle results, reflection, and final outcomes render in the same timeline.
- Follow-up messages never create an untracked second run when one is active.
- Steering is appended as durable user authority and applied before the next provider/tool step.
- Opening or resuming a session rehydrates both conversation and harness authority.
- Terminal sessions remain conversational but require an explicit new-task transition before further mutation.

### UX Specification

- Retain one bottom composer and one send affordance.
- Remove the user-facing semantic distinction between Send and Run.
- In Code/Debug/Test modes, Enter submits to the controller; agentic intent starts or continues the governed run.
- In Ask/Architect/Review modes, the route ceiling remains non-mutating unless the user explicitly switches to an agentic mode or confirms a controller-proposed transition.
- Keep compact model, mode, inference, context, index, approval, voice, and evidence icons attached to the composer.
- Render harness activity as concise chat timeline events, collapsed by default when verbose.
- Render clarification and approval as inline cards at the point where execution paused.
- Show current task, phase, oracle, and spend in one compact active-run row.
- Open plans, evidence, diffs, screenshots, and logs in native IDE surfaces.
- Do not add a second prompt box, permanent task dashboard, fake terminal, fake editor, or mandatory artifact panel.

### Harness Integration

- Replace the tool-less chat system rule with route-specific capability policies.
- Route `start_run` through `initializeHarness`; do not invent a parallel chat tool loop.
- Route `continue_run` through bounded `runStep` scheduling with pause/budget checks between steps.
- Reuse existing `ask_user`, approval digest, mode-policy intersection, workflow governance, firewall, checkpoints, transactions, reviewer, oracle, evidence, and terminal gates unchanged.
- Use harness-authored progress events for the visible activity stream. Model narration may summarize but cannot overwrite status.
- Background continuation must remain bounded by steps, wall clock, cost, pending input, pending approval, no-progress detection, and terminal state.

### Migration

1. Introduce controller types and pure routing tests without changing UI behavior.
2. Route existing `/goal`, clarification answers, approvals, pause/resume, and status questions through the controller.
3. Replace `send-chat` and `run-agent-loop` with one `submit-message` host bridge while retaining compatibility aliases during migration.
4. Render controller and harness events in the existing conversation timeline.
5. Remove the separate Send/Run mental model and obsolete advisory-only system copy.
6. Preserve explicit mode ceilings and advanced command APIs for automation and testing.

### Validation Gates

- **Intent matrix:** explanation stays read-only; implementation starts a run; steering modifies the same run; ambiguity asks; approval/clarification bind to active identities.
- **No bypass:** no conversation route may call `WorkspaceTools` directly or skip workflow/firewall/approval/review/oracle/evidence gates.
- **Causal build fixture:** one natural-language message creates files, repairs a failure through reflection, runs verification, and returns a compact evidence-backed result.
- **Weak-model proof:** the same approved weak model and task inputs run through the unified conversation path; results preserve model-driven/fallback accounting.
- **Continuity:** start, clarify, approve, steer, pause, reload, resume, and finish within one durable session without duplicate provider calls or lost cost/evidence.
- **Negative paths:** advisory request causes zero mutation; ambiguous consequential request pauses; forged/replayed approval rejects; terminal run cannot resurrect; red oracle cannot produce success.
- **Visual:** desktop and narrow sidebar show one composer, inline activity/question/approval, native artifact links, and no permanent dashboard.
- **Extension host:** invoke the real registered message/command path against disposable fixtures.
- **Installed product:** install the VSIX in VS Code and Antigravity, complete one conversational fixture, and capture visible plus machine-readable evidence.

### Acceptance Criteria

- A user can request a program or code change through ordinary conversation without pressing a separate Run control.
- The resulting work uses the existing governed harness, not a second less-restricted chat agent.
- The conversation remains responsive during work and accurately narrates authoritative state.
- Clarifications, approvals, steering, pause/resume, and results remain in one session and timeline.
- All existing blueprint safety and success invariants continue to pass.
- No source mutation occurs through the advisory answer route.
- No terminal success occurs without same-run green evidence.
- The packaged extension completes the conversational fixture in VS Code and opens/runs at smoke level in Antigravity.

### Non-Goals

- Exposing hidden chain-of-thought or raw model reasoning.
- Letting the model classify its own authority or bypass deterministic routing.
- Unbounded background autonomy or silent provider spend.
- Replacing native IDE editors, terminals, explorer, diffs, or settings.
- Treating narration or chat approval text as evidence without host identity checks.
- Removing explicit modes, commands, or advanced proof APIs used by tests and automation.

## Subsequent Priorities

### Phase 87 - External Tool Ecosystem

Status: **PASS - implemented and release-closed in 0.87.0**

- Add governed MCP client support with per-server/tool capability policy.
- Validate schemas, scope, credentials, side effects, approval class, and evidence before exposing a tool to a model.
- Keep external tool output untrusted and bounded.
- Phase boundary: official SDK v1 over local stdio and loopback Streamable HTTP only. Remote MCP waits for Phase 89 network isolation.
- Product surface: one collapsed Settings section plus native commands/artifacts; no permanent run-console panel.
- Prove that a scripted weak Editor model can consume an Architect handoff and successfully call an authorized MCP tool through `external_tool`; the strong planner never receives raw MCP output or gains direct tool authority.
- Release proof: official SDK stdio and loopback transports, bounded catalog/schema/policy enforcement, SecretStorage credentials, exact approval, immutable evidence, separate strong-Architect/weak-worker sessions, full extension-host E2E, desktop/sidebar visual smoke, package inspection, VS Code and Antigravity installation, and installed Antigravity interaction all pass without a paid provider call.
- Honest boundary: configured local/loopback servers only. Persistent workers, parallel fan-out, per-role economics, persistent worktrees, and unrestricted remote MCP remain Phases 88-90 work.

### Phase 88 - Persistent Isolated Sub-Agents

Status: **PASS - implemented and release-closed in 0.88.0**

- Selected contract: `docs/plans/2026-07-13-persistent-subagents-design.md` and `docs/plans/2026-07-13-persistent-subagents-implementation.md`.
- Merge authority is stricter than the pre-Phase-88 loop: a native worker edit must remain outside the active workspace until its retained staging root is composite-green and an independent Reviewer approves the staged diff; active verification runs again after merge.
- Logical workers are task-scoped and resumable. Mutating workers use retained Git worktrees or filtered copies; read-only workers remain context/tool isolated without unnecessary filesystem duplication.
- Review correction: retained staging is cumulative across intermediate red oracles. Per-path active baselines are immutable, the worker may repair multiple files before review, and the host merges or rolls back the complete reviewed set atomically.

- Give Explorer, Architect, Editor, Reviewer, and Escalation isolated context and constrained tools.
- Make **plan big, execute small** a first-class product topology: a configurable stronger Architect performs bounded judgment and emits a typed plan/handoff; cheaper worker models perform the token-heavy reading and tool execution in isolated contexts.
- Spawn weak workers with role-specific native and MCP tool ceilings. A worker receives only its focused brief, required source slice, committed plan section, and prior bounded evidence; it never inherits the coordinator transcript or unrestricted tool catalog.
- Keep the Architect out of direct mutation. Worker results return as distilled typed handoffs and immutable evidence, not raw context dumps; Reviewer independently gates merge and success.
- Meter calls, input/output tokens, cost, latency, tool calls, failures, and solved work per role/model. Compare against a rigor-matched single-frontier control so savings are measured rather than assumed.
- Bound fan-out, depth, retries, and worker lifetime. Workers cannot spawn workers, widen their own tools, alter model routing, or merge their own changes.
- Use persistent role worktrees or equivalent isolated edit branches where Git is available.
- Merge only reviewed, oracle-green results through deterministic coordination.
- Release proof: focused causal/adversarial staging tests, cumulative multi-file repair, blocked-review/conflict/rollback/missing-root negatives, reflection A/B, broad no-spend regressions, bundled extension-host E2E, visual inspection, package inspection, VS Code/Antigravity installation, and actual Antigravity interaction all pass.
- Installed artifact: `forge-agent-0.88.0.vsix` (1,816,851 bytes; SHA-256 `604E14C36202AF1C37052B668BB1937BE82215E852D5D8F199650FB2574D4006`) with interaction evidence at `artifacts/installed-persistent-subagents-088.jpg`.
- Honest boundary: Phase 88 stages native `apply_patch`/`write_file` work persistently. Workspace-writing MCP tools retain the Phase 87 checkpoint/approval path rather than persistent worker staging. Parallel mutating branch merges, kernel/container isolation, and live paid role-economics claims remain out of scope.

### Phase 89 - Stronger Runtime Isolation

Status: **PASS - release-closed in 0.89.0**

- Selected contract: `docs/plans/2026-07-13-runtime-isolation-design.md` and `docs/plans/2026-07-13-runtime-isolation-implementation.md`.
- Isolation grades must be explicit: sanitized process, Node permission cage, proven OS/container backend, or strict-unavailable rejection. Missing socket containment cannot be relabeled as sandboxing.
- Command authority is host-classified as read, verify, workspace-write, network-read, network-write, or unknown; a model cannot downgrade it.
- On hosts without a proven OS backend, unattended network/unknown commands fail closed while local bounded work remains available.
- Implemented host-owned command authority classification, mismatch rejection, Node permission cages for non-command workers, child-process denial, memory/output/time/process-tree ceilings, backend capability probes, and `.forge/runtime-isolation.json` evidence.
- Focused bypass/resource tests, all no-spend regressions, extension-host E2E, packaging, VS Code/Antigravity installation, and actual Antigravity command interaction pass.
- Installed artifact: `forge-agent-0.89.0.vsix` (3,102,603 bytes; SHA-256 `A72FBE24F9905F9C11808D069F1919289AC76CE6428E84FDB11AB611505D84BD`).
- Honest boundary: this host has Node permission support but no configured/proven socket-isolating backend. Known local verification commands receive process/resource limits, not socket containment. Network-read and unknown commands therefore fail closed; network-write remains denied. Browser/computer tools retain their separate exact-policy and approval boundaries.

### Phase 90 - Context And Model Optimization

Status: **PASS - implemented and release-closed in 0.90.0**

- Added host-revalidated `@symbol` context with bounded declaration/reference neighbors and governed PNG/JPEG/WebP attachments whose raw bytes remain transient.
- Added exact-model/role/context prompt profiles, required-section-preserving compaction measurement, and sanitized `.forge/context-optimization.json` evidence.
- Added opt-in task/terrain-aware routing for Explorer and Editor from an explicit worker pool. Capability, context, and known-price filters run before immutable route selection; Architect and Reviewer bindings remain authoritative.
- Added a same-rigor plan-big/execute-small product A/B with exact per-role model, calls, tokens, latency, cost, fallback, model-driven, green-evidence, and diff-review accounting.
- Release proof: all focused and no-spend regressions, worker stress 100/100, extension-host E2E, desktop/sidebar visual inspection, package inspection, VS Code/Antigravity installation, and actual installed Antigravity run/open interaction pass.
- Installed artifact: `forge-agent-0.90.0.vsix` (3,119,583 bytes; SHA-256 `9B3F84B0BBA3144F07BCD294AB6DD88702A491A3410AE1D82E96550EAF7F7B48`).
- Honest boundary: model-written compaction and live OpenRouter role-economics uplift are not claimed. The topology A/B is scripted causal/accounting proof; Phase 91 owns 15-25 task live benchmark discipline.

### Phase 91 - Production Benchmark And Release Discipline

Status: **IMPLEMENTED AND INSTALLED IN 0.91.0 - live release-floor run pending explicit spend authorization**

- Added a fixed 16-task suite composed from Tier 2, Tier 3, and Tier 4: multi-file bugs, missing-test work, features, large files, haystacks, interface seams, symptom-only failures, coordinated edits, and spec-bound behavior.
- Added canonical suite/task/judge digests, equal lane-input evidence, complete-suite enforcement, runner-only judges, and one-write final production archives. Raw Tier reports remain progress artifacts and are not mislabeled immutable.
- Added exact cost and wall-clock accounting, model-driven solve rate, false-success rate, provider-failure rate, no-fallback credit, and versioned release floors. `benchmarkPassed` and `releaseReady` are separate; installed-product evidence is mandatory for the latter.
- Added live-only CLI and extension commands with exact weak-model allowlist, 16-task anti-cherry-pick rule, bounded steps/timeouts, and explicit action-time credit consent before readiness/provider work.
- Added a compact collapsed Proof control plus native report opening. No permanent benchmark dashboard was added.
- Added a host-selected Claude Fable 5/Mythos 5 prompt profile following current Anthropic guidance: act when evidence is sufficient, stay scoped, ground status in tools, pause only at genuine ask gates, continue reversible authorized work, and never reproduce hidden reasoning. Deterministic Forge authority is unchanged.
- Offline release proof: focused benchmark/prompt negatives, all no-spend regressions, worker stress 100/100, final extension-host E2E, desktop/sidebar visual inspection, package inspection, VS Code/Antigravity installation, and actual installed Antigravity command/UI preflight pass.
- Honest boundary: no paid 16-task production benchmark ran. Therefore no live solve-rate, cost, uplift, `benchmarkPassed`, or `releaseReady` claim is made. The phase cannot move to full `PASS` until an explicitly authorized live run produces immutable evidence and the exact installed artifact is attested.

### Phase 92 - Prompt Enhancement And MCP Onboarding

Status: **PASS - implemented, release-validated, packaged, and installed in 0.92.0**

- Selected contracts: `docs/KILO_FEATURE_SETTING_AUDIT.md`, `docs/plans/2026-07-13-prompt-enhancement-mcp-onboarding-design.md`, and `docs/plans/2026-07-13-prompt-enhancement-mcp-onboarding-implementation.md`.
- Replace the client-only wand wrapper with a bounded host-owned structured prompt enhancer using a dedicated inexpensive model. The enhanced draft remains user-reviewable and is never auto-submitted or granted execution authority.
- Add native add/remove onboarding for validated local/loopback MCP servers and explicit tool policies, plus a bounded MCP timeout setting. Existing discovery, schema, role, side-effect, approval, SecretStorage and evidence gates remain authoritative.
- Record a category-by-category Kilo 7.4.5 settings disposition so native-host features and rejected authority regressions are not mislabeled missing Forge functionality.
- Release gate: focused/adversarial, broad no-spend, extension-host, desktop/sidebar visual, package, VS Code install and actual Antigravity interaction evidence. No paid provider call is required to prove the deterministic integration.
- Implemented result: the wand invokes one exact host-configured model with strict JSON schema, deterministic rendering, usage/cost status and no fallback escalation. Empty, oversized, malformed and unexpected-field responses preserve the original draft; enhancement only populates the composer for review and never emits `submit-message`.
- MCP onboarding now has native Add/Remove commands and compact collapsed Settings actions. Configurations pass the existing loopback/stdio, secret-key, bounded-argument, exact-tool-policy and role validation before persistence; onboarding itself performs no server invocation or tool authorization by discovery.
- Release evidence: focused and broad no-spend suites, 100/100 worker stress, desktop/sidebar visual inspection, extension-host E2E, 62-file VSIX packaging, VS Code/Antigravity install, and actual Antigravity command/settings/empty-draft interaction pass.
- Honest boundary: no paid prompt-enhancement call was made during release validation, and the Phase 91 production benchmark still awaits explicit provider-credit authorization. Phase 92 proves deterministic integration and installed behavior, not live rewrite quality or benchmark uplift.

### Phase 93 - Execution Contracts And Assurance Levels

Status: **PLANNED**

- Selected contracts: `docs/plans/2026-07-13-execution-contract-assurance-design.md` and `docs/plans/2026-07-13-execution-contract-assurance-implementation.md`.
- Add a host-owned `ExecutionContractV1` and `standard | verified | audited` assurance levels without creating a second run loop.
- Standard preserves the current full harness. Verified requires digest confirmation, model-driven fallback-free completion, independent review, composite-green oracle and same-run evidence. Audited adds proven isolation, oracle calibration and signed attestation and fails closed until those later-phase prerequisites exist.
- Bind confirmation and revisions to session/contract/revision/digest. Authority widening invalidates confirmation before provider or mutation work.
- Product surface remains one compact assurance chip plus an inline pending-contract card and native artifact access.
- Release gate: focused/adversarial, broad no-spend, worker, extension-host, desktop/sidebar visual, package, VS Code install and actual Antigravity interaction evidence.

## Roadmap Governance

- `ROADMAP.md` owns forward product sequencing and acceptance contracts.
- `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md` owns research-to-code status and gaps.
- `BUILD_LOG.md` owns executed commands and proof; plans are never recorded as passes.
- `HANDOFF_OPUS.md` owns current operational state and immediate continuation instructions.
- A phase moves from `PLANNED` to `IMPLEMENTED` only after code exists.
- A phase moves to `PASS` only after every applicable causal, negative, extension-host, visual, package, and installed-product gate is recorded with real output.
