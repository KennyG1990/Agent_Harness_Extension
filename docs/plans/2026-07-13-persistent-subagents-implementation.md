# Phase 88 Persistent Isolated Sub-Agents Implementation Plan

> **For Agent:** Follow `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR` for every batch.

**Goal:** Convert role labels and short-lived transactions into durable task-scoped workers with typed handoffs, isolated staged edits, independent review-before-merge, and honest per-role/model accounting.

**Architecture:** `AgentHarnessLoop` remains the sole coordinator and terminal authority. A new deterministic sub-agent coordinator owns worker topology, staging roots, diff/merge transactions, limits, and metrics; models only receive focused assignments and propose existing tools.

**Tech Stack:** TypeScript, Node child processes, Git detached worktrees/filtered copies, existing project adapters/oracles, VS Code extension host, React webview.

## Task 1 - State And Coordinator Limits

**Files:** create `src/harness/subAgentCoordinator.ts`; modify `src/harness/types.ts` and `src/harness/loop.ts`.

1. Add versioned worker/topology/handoff/merge/metric types and deterministic caps.
2. Initialize topology with the run and create task-scoped worker identities only from the host coordinator.
3. Reject nesting, parent spoofing, role/tool/model mutation, excess fan-out/count/depth/retry/lifetime.
4. Persist sanitized topology artifacts.

Gate: focused test proves stable task worker IDs across steps/resume and every cap/authority negative.

## Task 2 - Focused Context And Honest Metering

**Files:** modify `src/harness/loop.ts`, `src/harness/provider.ts` only if required, and focused smoke fixtures.

1. Record selected exact model, calls, prompt/completion tokens, cost, latency, failures, fallback use, and tools per task worker.
2. Build typed handoffs at role transitions.
3. Remove raw recent logs/scratchpad/coordinator chat from worker prompts; retain required workflow, oracle, clarification, focused plan/source, bounded blockers/reflections/evidence, and authorized catalog.
4. Keep Reviewer and pre-commit Reviewer sessions independent from Editor.

Gate: sentinels prove allowed focused content is present and raw coordinator/other-worker content is absent; role/model metrics reconcile with run totals.

## Task 3 - Persistent Staged Workspace

**Files:** implement staging/merge in `src/harness/subAgentCoordinator.ts`; modify dispatch in `src/harness/loop.ts`.

1. Create one retained detached worktree for a Git-backed Editor/Escalation worker or one filtered copy otherwise; overlay dirty source and record baseline hashes.
2. Execute validated native file mutation in the retained root through `ProcessWorkerExecutor`.
3. Run the full composite project oracle against the staged root.
4. Generate bounded staged diff/change metadata.
5. Keep active workspace unchanged on red oracle or any staging failure.

**Review reconciliation before close:** The first implementation draft tracked only the current proposal path and abandoned the staging root when its immediate oracle was red. That is not a persistent worker workspace and makes ordinary multi-file repairs impossible. Phase 88 therefore requires cumulative staging: preserve the root across red intermediate oracles, retain immutable active-workspace baselines for every touched path, let later Editor proposals build on the staged bytes, and atomically merge or roll back the complete reviewed file set. The 200-file/20-MiB bounds apply to the cumulative set, not one proposal.

Gate: Git and non-Git fixtures prove retained staging, dirty overlay, red non-merge, cleanup, and source immutability.

## Task 4 - Independent Review And Host Merge

**Files:** modify `src/harness/loop.ts` and `src/harness/subAgentCoordinator.ts`.

1. Send staged diff/oracle summary to an independent Reviewer session.
2. Treat `blocked` critique as a real merge/success block; stop counting the base diff record alone as approval.
3. Merge only staged-green/reviewer-approved changes after all-path optimistic concurrency checks.
4. Roll back an injected partial merge failure.
5. Run fresh active-workspace composite verification after merge; only this result may feed normal green evidence/success.

Gate: reviewer-block, concurrent-edit conflict, partial-merge rollback, active-oracle-red, and approved-green controls pass.

## Task 5 - Product And Native Artifacts

**Files:** modify `src/extension.ts`, `src/webview/src/App.tsx`, `package.json`, and extension-host tests.

1. Add native commands to open topology, handoffs, merges, and metrics.
2. Add only a compact worker/model/activity summary in existing conversation/proof surfaces; keep details collapsed/native.
3. Add a no-spend proof command for the causal topology fixture if needed by E2E.

Gate: no permanent panel/persona UI, native artifacts open, webview receives summaries only.

## Task 6 - Release Validation

1. Run focused causal and adversarial sub-agent tests.
2. Run compile, static, all no-spend regressions, worker 100/100, MCP, browser/computer, visual desktop/sidebar, and extension-host E2E.
3. Review false success, fallback accounting, context leakage, stale staging roots, process/worktree cleanup, and reviewer bypass.
4. Bump to `0.88.0`, package, inspect, install in VS Code and Antigravity, and interact with the actual Antigravity view.
5. Close ROADMAP, gap analysis, handoff, BUILD_LOG, plans, and AAR with exact evidence.

No paid provider call is authorized by this plan.

## Document Close

Status: **PASS - release-closed in 0.88.0**.

- Implemented all six tasks, including the review-required cumulative staging correction and distinct Escalation-worker transfer.
- Focused proof covers strong-Architect/weak-Editor sessions, transcript isolation, two-file cumulative repair, retained red stages, reviewer denial, conflicts, rollback, missing/expired roots, and fresh active-oracle success.
- Broad no-spend regressions, reflection A/B, worker 100/100, visual smoke, and bundled extension-host E2E pass.
- Packaged and installed `forge-agent-0.88.0.vsix` in VS Code and Antigravity. Actual Antigravity interaction evidence: `artifacts/installed-persistent-subagents-088.jpg`.
- Boundary retained: workspace-writing MCP tools are governed by the Phase 87 transaction path, not the persistent native staging coordinator.

## AAR

- Sustain: host-owned worker creation, immutable role/model/tool routes, typed handoffs, staged-green plus independent review before merge, and fresh active verification before success.
- Improve: extension-host E2E produced two recovered unresponsive/profiling warnings; Phase 89 should add measurable process/resource ceilings and collect timing evidence around worker and oracle boundaries.
- Lesson: persistent edit isolation must be cumulative. Abandoning a stage after each red oracle makes normal multi-file repair impossible even when every individual mutation is safe.
- Lesson: escalation is a worker transfer, not an in-place model change; route identity must remain immutable for trustworthy accounting.
- Lesson: reviewer provider calls and staged-red oracle evidence must reconcile into run totals without being allowed to satisfy active-workspace success.
- Suggested commit title: `Phase 88: add persistent isolated sub-agents`.
