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

Status: **PASS - implemented, adversarially tested, release-validated, packaged, installed, and interactively proven in 0.93.0**

- Selected contracts: `docs/plans/2026-07-13-execution-contract-assurance-design.md` and `docs/plans/2026-07-13-execution-contract-assurance-implementation.md`.
- Add a host-owned `ExecutionContractV1` and `standard | verified | audited` assurance levels without creating a second run loop.
- Standard preserves the current full harness. Verified requires digest confirmation, model-driven fallback-free completion, independent review, composite-green oracle and same-run evidence. Audited adds proven isolation, oracle calibration and signed attestation and fails closed until those later-phase prerequisites exist.
- Bind confirmation and revisions to session/contract/revision/digest. Authority widening invalidates confirmation before provider or mutation work.
- Product surface remains one compact assurance chip plus an inline pending-contract card and native artifact access.
- Release gate: focused/adversarial, broad no-spend, worker, extension-host, desktop/sidebar visual, package, VS Code install and actual Antigravity interaction evidence.
- Implemented result: host-canonical `ExecutionContractV1` artifacts bind objective, constraints, acceptance criteria, non-goals, workspace scope, tool ceiling, expected files, composite oracles, budget, exact role-model bindings, approval policy and assurance requirements to a SHA-256 digest and immutable revision history. Verified pauses before provider work; rejection and stale/forged decisions are non-mutating; steering or rebinding that widens authority creates a fresh confirmation gate.
- Assurance truth: Standard preserves the existing full harness and one-time legacy first-step model binding. Verified additionally requires model-driven completion, zero fallback actions, composite-green same-run evidence and independent model/diff review for changed work. Audited is visible but fails closed because signed attestations and calibrated oracles do not exist until Phases 96-97; no Audited execution claim is made.
- Release evidence: focused negative suite, static invariants, full extension-host regression, worker stress 100/100, desktop and 520px visual inspection, 63-file VSIX inspection, VS Code/Antigravity install and actual reloaded Antigravity assurance-menu interaction all pass without provider spend. Exact commands and artifact hash are recorded in `BUILD_LOG.md`.

### Phase 94 - Background Sessions And Native Notifications

Status: **PASS**

- Selected contracts: `docs/plans/2026-07-13-background-sessions-design.md` and `docs/plans/2026-07-13-background-sessions-implementation.md`.
- Continue confirmed runs in a bounded detached local process over a retained isolated worktree/copy. Credentials remain process-memory only; heartbeat, budget and contract identity persist for reattachment.
- Background work never mutates or merges into the active workspace. A host-owned reviewed merge requires unchanged baselines, independent review, assurance gates and fresh active-workspace verification with rollback on red.
- Reuse the session popover and one composer action; expose compact status/actions and deduplicated native notifications rather than a dashboard.
- Release gate: launcher-exit causal proof, lease/tamper/conflict/red-oracle negatives, full no-spend/worker/extension-host/visual/package gates, dual install and actual Antigravity interaction.
- Implemented result: a packaged detached runner resumes the exact confirmed execution contract in a retained isolated worktree/copy. Atomic manifests, one-writer workspace leases, heartbeat/PID recovery, bounded cancellation, contract/root identity checks and host-only review/merge keep background work outside the active workspace.
- Merge truth: model review and deterministic diff review must approve the exact opened digest; source baselines must remain unchanged; bounded transactional copy/delete is followed by fresh source-workspace oracles. A red oracle restores source bytes, and rollback failure is reported as blocked rather than mislabeled restored.
- Product result: one composer background action and the existing session popover expose status and contextual actions. Ask/approval/review boundaries return to the host through native prompts, diffs and deduplicated notifications. Browser, computer and external interactive tools are denied in detached execution.
- Release evidence: detached launcher-exit, stale recovery, forged contract, missing root, ask/approval resume, source preservation, stale review, green merge and red-oracle rollback all pass with a scripted provider and zero provider spend. Static, extension-host, worker 100/100, visual, package/install and actual Antigravity command/UI gates pass; exact evidence is in `BUILD_LOG.md`.

### Phase 95 - Skills, Agents, Rules, And Hooks Compatibility

Status: **PASS**

- Selected contracts: `docs/plans/2026-07-13-customization-compatibility-design.md` and `docs/plans/2026-07-13-customization-compatibility-implementation.md`.
- Import bounded workspace customizations from compatible `.agents`, `.github` and `.claude` locations with strict parsing, provenance, canonical snapshot digests and deterministic precedence.
- Skills use progressive disclosure; imported agents become constrained Forge modes; path rules are untrusted context; isolated command hooks may deny, ask, narrow or emit untrusted candidates but never grant authority, approve, author trusted evidence, merge or declare success.
- Requested tools intersect Forge role/mode ceilings. Customization drift invalidates resumed/background authority before provider or mutation work.
- Preserve one composer and native IDE surfaces: one collapsed Settings summary, existing mode/skill selectors and native report commands.
- Release gate: format/location fixtures, parser/bounds/escape negatives, hook authority and source-preservation proofs, digest-drift continuity, broad no-spend/worker/extension-host/visual/package gates, dual install and actual Antigravity interaction.
- Implemented result: bounded structured discovery produces `.forge/customizations.json`; skills activate progressively, path rules enter bounded prompt context, compatible agents appear as constrained imported modes and hooks remain disabled by default unless the user opts in.
- Authority result: requested tools intersect Forge ceilings; coding agents missing mandatory proof tools are rejected. Hook outputs cannot approve, grant tools, author trusted evidence, merge or declare success; narrowing is revalidated and active-source mutation is restored and denied.
- Continuity result: the canonical customization digest is part of the execution contract. Foreground and background drift invalidates prior authority before provider or mutation work.
- Release evidence: focused customization, execution-contract and detached-background suites, static regression, 100-worker stress, extension-host, visual, package/install and actual Antigravity UI gates pass with zero provider spend. Exact evidence is in `BUILD_LOG.md`.

### Phase 96 - Proof Graph And Signed Attestations

Status: **PASS**

- Selected contracts: `docs/plans/2026-07-13-proof-graph-attestation-design.md` and `docs/plans/2026-07-13-proof-graph-attestation-implementation.md`.
- Derive a canonical privacy-preserving DAG from existing contract, requirement, proposal, validation, approval, mutation, diff, oracle, review, evidence and terminal facts.
- Persist graph completeness and digest without allowing the graph to create evidence or terminal truth.
- Generate SecretStorage-backed Ed25519 keys in the extension host; sign bounded run attestations and verify them independently from public data.
- Tampered graph/payload/signature/key/contract material must fail. Old attestations remain verifiable after explicit key rotation.
- Keep detailed proof in native artifacts and expose only one collapsed summary/actions surface.
- Release gate: graph causality/acyclic/privacy fixtures, red/missing-proof and tamper negatives, SecretStorage/key-rotation host proof, broad regression/worker/extension-host/visual/package gates, dual install and actual Antigravity interaction.
- Implemented result: every persisted run now derives `.forge/proof-graph.json` plus a session archive with canonical nodes/edges from requirements through governed proposals, validation, changes, oracles, reviews, evidence and terminal truth. Graphs report missing proof but cannot alter state or manufacture success.
- Signing result: terminal runs are signed by an extension-host Ed25519 key held in SecretStorage. The signer rebuilds the graph from persisted state before signing; public verification recomputes graph, payload, contract, terminal, completeness, key and signature identities. Explicit key rotation leaves old embedded-key attestations verifiable.
- Release evidence: focused causality/privacy/tamper/rotation/false-success proof, execution-contract/background/customization regressions, static invariants, worker stress 100/100, extension-host commands, visual smoke, package inspection, VS Code/Antigravity installation and actual reloaded Antigravity proof-surface interaction pass without provider spend. Exact evidence is in `BUILD_LOG.md`.
- Honest boundary: local signatures prove integrity under a local key, not third-party identity or trusted time. Audited remains unavailable because calibrated oracles and a proven socket-isolating runtime are independent later gates.

### Phase 97 - Oracle Calibration

Status: **PASS**

- Selected contracts: `docs/plans/2026-07-13-oracle-calibration-design.md` and `docs/plans/2026-07-13-oracle-calibration-implementation.md`.
- Calibrate only the selected test oracle by applying bounded syntax-preserving source-token mutants in a disposable copy. Never mutate tests or the active workspace.
- Require green baselines before/after, exact byte restoration, adapter/test-suite identity and immutable report digests.
- Audited availability requires a supported policy, at least five applied mutants and sensitivity at or above the fixed 80% floor. Missing, stale, weak, truncated or tampered calibration fails closed.
- Keep detail in native artifacts and add only one status/action row to the existing collapsed Proof integrity disclosure.
- Release gate: strong/weak/red/unsupported/stale/tamper/preservation fixtures, affected regressions, worker/extension-host/visual/package gates, dual install and actual Antigravity interaction.
- Implemented result: Node test oracles can now be calibrated against bounded boolean, equality, boundary and logical-token mutants in a disposable filtered copy. Unsupported/truncated projects execute no calibration command; red/flaky baselines, too few candidates, weak sensitivity, drift and tampering fail closed.
- Authority result: current calibration is part of harness state, Audited contract availability and every terminal assurance gate. `.forge` is now a host-owned namespace for model file tools, and an Audited signing failure demotes persisted terminal success to failure.
- Product result: native run/status/open commands and one compact Calibration row/actions pair live inside the existing collapsed Proof integrity disclosure. Detailed reports open in the native editor.
- Focused evidence: 8/8 semantic mutants killed by the strong fixture, 0/8 by the weak fixture; baseline-red, unsupported nonexecution, stale/tamper rejection, source/test preservation, regex/comment/string exclusion and host-namespace protection pass.
- Release evidence: compile/static, execution-contract, attestation, background, customization, worker 100/100, extension-host, visual, package inspection, VS Code/Antigravity installation and actual reloaded Antigravity interaction pass without provider spend. Antigravity's CLI printed successful installation and listed 0.97.0 before its known native shutdown crash.
- Review result: the first lexical policy falsely treated the `>` in JavaScript arrows as a semantic mutation, so ambiguous standalone angle mutations were removed. Installed interaction also exposed misleading unsupported-status ordering; report status now precedes adapter drift checks.
- Honest boundary: policy v1 is Node-only sampled sensitivity. It does not certify exhaustive test quality or source correctness, and Audited still requires a proven socket-isolating runtime backend independent of calibration/signing.

### Phase 98 - Branch-and-Compare Execution

Status: **PASS**

- Selected contracts: `docs/plans/2026-07-13-branch-compare-design.md` and `docs/plans/2026-07-13-branch-compare-implementation.md`.
- Run two or three candidates from one frozen source/task/authority contract in distinct isolated worktrees or workspace copies.
- Candidate model identity is an explicit treatment variable and cannot widen the common tool, scope, oracle, approval, budget, customization, or assurance contract.
- Eligibility requires terminal success, green deterministic oracle and same-run evidence, approved deterministic diff review, approved independent model review, and model-driven work. Red, missing-proof, fallback-only, stale, or tampered candidates are never selectable.
- Rank eligible candidates by lower fallback dependence, measured cost, measured latency, and stable identity. Correctness gates always precede efficiency.
- Candidates cannot select or merge themselves. Native diff review and a fresh host-owned source verification gate any bounded transactional merge.
- Keep one composer and expose only one collapsed Proof-tab comparison surface plus native artifacts.
- Release gate: causal candidate/ranking/tamper/stale/rollback proof, broad regression/worker/extension-host/visual/package gates, dual install, and actual Antigravity interaction without unauthorized provider spend.
- Implemented result: `branchCompare.ts` prepares two or three frozen-baseline worktrees/copies before concurrent launch, runs the existing governed loop with exact candidate/reviewer routes, derives conjunctive eligibility from terminal/oracle/evidence/diff/model-review/model-driven facts, and persists canonical latest plus immutable reports.
- Ranking result: only eligible candidates enter deterministic ordering by fallback dependence, measured cost, measured latency, and stable identity. A cheaper red candidate and a cheapest fallback-only candidate both lose to the green model-driven candidate in causal proof.
- Merge result: candidates have no selection or merge tool. The extension host opens native diffs, binds explicit approval to report/candidate/source identities, accepts any eligible host-selected candidate, and performs bounded merge plus fresh source oracle with byte rollback.
- Release evidence: compile/static/focused/desktop/sidebar, worker 100/100, extension-host, package inspection, dual install, and actual Antigravity interaction pass in 0.98.0 with no provider spend. The installed Compare action remains disabled until its own explicit credit-use checkbox is selected.
- Honest boundary: candidate economics and ranking mechanics are scripted/automated proof. No live branch-comparison quality claim exists until a user-authorized provider run supplies real measured outcomes.

### Phase 99 - Empirical Model Intelligence

Status: **PASS - implemented, release-validated, packaged, installed, and interactively proven in 0.99.0**

- Compile local profiles only from validated, comparable, evidence-backed run artifacts.
- Report sample count, confidence, solve rate, false-success rate, schema reliability, provider failures, cost per verified task, and fallback dependence.
- Keep production benchmarks, branch comparisons, scripted fixtures, and unlike task/judge contracts in explicit cohorts.
- Never present catalog metadata or name-pattern role hints as measured performance.
- Expose rebuild/get/open commands and one compact collapsed Proof surface; rebuilding performs no provider calls.
- Design and implementation contracts: `docs/plans/2026-07-13-empirical-model-intelligence-design.md` and `docs/plans/2026-07-13-empirical-model-intelligence-implementation.md`.
- Implemented result: `modelIntelligence.ts` validates immutable production-benchmark and branch-comparison reports, rejects unsupported legacy evidence, deduplicates source identity, partitions exact-model samples by cohort and provenance, and persists canonical JSON plus a native Markdown summary.
- Measurement truth: only at least three live verified samples under one comparable cohort can become `measured`; scripted evidence remains provisional. Rankings use Wilson lower confidence, false-success, fallback, provider-failure, verified-cost, and stable-identity ordering only within like cohorts.
- Product result: the picker now separates measured confidence, provisional evidence, heuristic role estimates, and catalog-only entries. Rebuild/open controls remain one collapsed Proof disclosure and native artifact commands; rebuild never invokes a provider.
- Release evidence: focused causal/adversarial proof, Phase 98 regression, compile/static, desktop/sidebar visual, 100-worker stress, extension-host E2E, package inspection, dual install, and actual Antigravity interaction pass without provider spend. Installed Antigravity shows 342 live models, empirical-confidence sorting, explicit heuristic labels, and `0 measured / 0 provisional` before live comparable evidence exists.
- Honest boundary: the profile compiler and display semantics are proven, but this workspace currently has no accepted live comparable samples. No model-quality, ranking, solve-rate, or cost superiority claim is made until explicitly authorized live runs produce the required evidence.

### Phase 100 - Governed Agent Gateway

Status: **PASS - implemented, release-validated, packaged, installed, and interactively proven in 1.0.0**

- Expose a disabled-by-default authenticated loopback Agent Gateway plus an optional stdio MCP facade.
- External agents may submit goals and structured proposals only through the existing execution-contract and harness authority path.
- External clients cannot directly mutate, approve, author trusted evidence, select oracle truth, merge, sign attestations, or declare terminal success.
- Bind authentication, request identity, contract digest, replay protection, rate/size ceilings, cancellation, and audit evidence at the extension-host boundary.
- Keep one composer and native IDE surfaces; gateway controls belong in collapsed Settings/native commands rather than a second chat or dashboard.
- Release gate: focused transport/auth/replay/authority negatives, broad no-spend regressions, worker/host/visual/package gates, dual install, and actual Antigravity interaction.
- Implemented result: the extension host now owns a SecretStorage-authenticated `127.0.0.1` HTTP gateway and separately bundled four-tool stdio MCP facade. External clients can submit goals/proposals, read sanitized status, and cancel, while the normal execution contract, role policy, firewall, human approval, transactional staging, oracle, diff review, evidence, and terminal gates remain authoritative.
- Security result: exact Host/Origin/auth/body/schema/depth/rate/replay/concurrency/contract checks fail closed; forbidden approve/evidence/oracle/merge/sign/success routes do not exist. Tokens stay out of webview state, audit, replay, status, and support output.
- Live result: actual Antigravity ran a fresh Desktop fixture through two visible write approvals. The first staged edit left the active workspace unchanged while tests were red; the second repair turned the staged oracle green, merged both files, ran tests, reviewed the diff, and terminaled success with 6 gateway proposals, 2 green evidence entries, 0 provider calls, 0 fallback proposals, and a live forbidden-approve HTTP 404. The gateway was then stopped and restored to disabled-by-default.
- Review correction: the first installed attempt exposed approval-time model-binding widening that made two unintended reviewer provider calls. The run was cancelled before merge, approval now uses only the confirmed contract bindings, and the hostile-binding regression proves zero provider calls.
- Honest boundary: gateway clients are untrusted proposal sources, not verified model identities. Gateway work never counts as Forge model-driven work without a separate attestation design, and the paid hard Qwen 9B demonstration remains separately gated on explicit action-time authorization.

## Roadmap Governance

- `ROADMAP.md` owns forward product sequencing and acceptance contracts.
- `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md` owns research-to-code status and gaps.
- `BUILD_LOG.md` owns executed commands and proof; plans are never recorded as passes.
- `HANDOFF_OPUS.md` owns current operational state and immediate continuation instructions.
- A phase moves from `PLANNED` to `IMPLEMENTED` only after code exists.
- A phase moves to `PASS` only after every applicable causal, negative, extension-host, visual, package, and installed-product gate is recorded with real output.
