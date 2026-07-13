# Phase 88 Persistent Isolated Sub-Agents Design

## Bounded Objective

Make the existing Explorer, Architect, Editor, Reviewer, and Escalation roles real host-governed sub-agents: durable task-scoped sessions, narrow context/tools, typed handoffs, bounded lifecycles, per-role/model accounting, and a persistent isolated edit workspace whose result cannot enter the active workspace until staged verification and independent review are green.

## Acceptance Criteria

- A host-owned coordinator creates task-scoped workers; workers cannot spawn workers, change role/model routing, widen tools, or merge.
- Architect uses the configured planning model, cannot mutate, and emits a typed committed handoff.
- Explorer/Editor/Reviewer/Escalation provider sessions are isolated by worker identity, not only role name.
- Worker prompts contain the focused brief, committed plan slice, focus-file content, bounded blockers/reflections/evidence, and authorized tools. They exclude coordinator chat, raw shared logs, and raw scratchpad dumps.
- Native Editor mutations run in one persistent detached worktree for Git roots or filtered workspace copy otherwise. The active workspace remains byte-identical until staged composite verification and an independent Reviewer critique approve the staged diff.
- Merge checks every changed active path against its baseline hash, is bounded to 200 files/20 MiB, rolls back partial merge failures, and then requires a fresh active-workspace composite oracle.
- Reviewer `blocked` prevents merge and cannot count as reviewed success. Workers cannot self-review or self-certify.
- Fan-out, depth, retries, lifetime, tool calls, and worker count are deterministic caps. Phase 88 starts with sequential bounded edit workers; read workers may coexist but do not receive mutation authority.
- Calls, input/output tokens, cost, latency, tool calls, failures, staged oracle result, merge result, and solved status persist per worker/model.
- Resume rehydrates logical workers and either reuses a valid retained staging root or records deterministic abandonment; it never silently treats a missing worker root as merged.
- Product UI remains one conversation. Only compact activity/status and native artifacts expose worker state; no agent dashboard or personas are added.

## Existing Components To Reuse

- `AgentHarnessLoop` remains the only product loop and terminal authority.
- Role ceilings in `allowedToolsForRole` and `validateRoleCapability` remain authoritative.
- `ProcessWorkerExecutor` remains the sanitized tool subprocess boundary.
- `VerificationOracles` supplies staged and active composite checks.
- Existing checkpoints and human approval still occur before consequential worker execution.
- `ArchitectHandoff`, `RoleHandoff`, reflection, blocker, evidence, and session artifacts remain inputs; Phase 88 adds typed task-worker handoffs rather than replacing them.

## Coordinator State

Persist `.forge/subagent-topology.json`, `.forge/subagent-handoffs.json`, `.forge/subagent-merges.json`, and `.forge/subagent-metrics.json`.

The topology records:

- schema version, run/coordinator identity, limits, and status;
- task-scoped worker ID, role, model slug, provider session ID, parent=`coordinator`, depth=1, lifecycle status, retry/lifetime counters, allowed tools, focused task, and staging mode;
- typed handoffs with source/target worker, task, plan excerpt, focus files, bounded evidence digests, and `rawTranscriptIncluded=false`;
- staged workspace baseline, changed paths, staged oracle, reviewer decision, merge/conflict/rollback/cleanup results;
- role/model usage and solved-work counters.

Only deterministic code writes these records. The model sees a bounded sanitized worker assignment, never filesystem staging roots or coordinator controls.

## Plan Big, Execute Small Topology

1. Explorer performs bounded retrieval and returns a typed summary.
2. Architect receives the goal plus Explorer handoff, performs bounded judgment, and commits the plan/handoff. It cannot mutate.
3. Editor receives only its task, exact plan/focus slice, bounded prior evidence, and role-authorized native/MCP catalog. A cheaper model may own this worker.
4. Native mutations execute in the retained worker staging workspace after normal schema/workflow/firewall/pre-commit/human approval gates.
5. The staged workspace runs the project adapter's complete composite oracle.
6. Reviewer receives the staged diff and staged oracle summary in an independent session. `blocked` returns work to repair without merge.
7. The host coordinator merges only approved, staged-green bytes after optimistic concurrency checks.
8. Active-workspace oracles, final diff review, evidence, and terminal success remain ordinary harness gates.

This follows the Anthropic coordinator pattern without importing its authority model: the strong planner spends tokens on judgment, cheaper workers spend tokens on reading/tool execution, and the coordinator receives typed summaries rather than raw worker context.

## Limits

- Maximum active workers: 5.
- Maximum fan-out: 3.
- Maximum depth: 1.
- Maximum retries per worker: 2.
- Maximum worker lifetime: 10 minutes.
- Maximum staged changed files: 200.
- Maximum staged merge bytes: 20 MiB.
- Workers never spawn workers and never call merge APIs.

## Risks And Mitigations

- Dirty Git state: overlay current source bytes into detached staging and hash the actual dirty baseline.
- Concurrent user edits: reject before merge when any changed active path hash differs.
- Partial merge: retain byte backups and roll back all touched paths.
- Stale retained root on resume: validate root identity/baseline; abandon explicitly if invalid.
- Reviewer theater: a blocked model critique is authoritative for merge denial; deterministic review may approve only after schema/scope/staged-oracle checks and remains identified as deterministic.
- Context leakage: prompt-section tests use sentinels in chat, logs, scratchpad, unrelated source, and credentials.
- False economics: deterministic fallback and deterministic review are separately counted; no live savings claim without Phase 90 A/B.

## Non-Goals

- No nested workers, unbounded background autonomy, or silent provider spending.
- No remote MCP expansion, socket/kernel/container sandbox, or resource cgroups; those are Phase 89.
- No claim that a scripted weak worker proves live model uplift.
- No parallel mutating branch merges in the first implementation; bounded sequential merges avoid conflict ambiguity.
- No new permanent worker dashboard.

## Rollback Strategy

The feature is additive state plus a coordinator dispatch path. If staged execution fails, the active workspace is unchanged and the retained staging root is abandoned/cleaned. If merge fails, byte backups restore all touched active paths. Existing checkpoints remain a second recovery layer after a successful merge. Removing the coordinator path returns execution to existing per-action transactions without changing state schemas already persisted.

## Required Evidence

- Causal strong-Architect/weak-Editor fixture with separate session/model IDs and prompt-leak sentinels.
- Active workspace unchanged before staged green + Reviewer approval.
- Red staged oracle, blocked Reviewer, path conflict, missing retained root, cap, nesting, role widening, routing mutation, and injected partial-merge failure negatives.
- Resume/retry and immutable artifact checks.
- Full static/regression, worker stress, browser/computer/MCP regressions, extension-host E2E, desktop/sidebar visual, VSIX inspection, VS Code install, and actual Antigravity interaction.
- No paid provider call without explicit action-time approval.
