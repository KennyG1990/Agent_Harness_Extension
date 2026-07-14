# Phase 94 Background Sessions And Native Notifications Design

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Bounded Objective

Allow a confirmed Forge run to continue in a bounded local process after the IDE window or extension host closes, without giving that process direct merge authority over the active workspace. Reattachment, review, merge, fresh verification and notifications remain host-owned.

## Reconciled Baseline

- `SessionStore` persists run/chat state but resume execution currently requires a live extension host.
- `PersistentSubAgentCoordinator` retains role sessions and isolated per-action staging, but its workers are not detached daemons.
- `runIsolatedAgentGoal` proves detached worktree/copy setup and source preservation, but is an explicit foreground command and has no reviewed merge path.
- `ProcessWorkerExecutor` uses short-lived children and intentionally resolves only after child exit.
- No current process survives IDE closure, no background heartbeat/lease exists, and the sole native notification is support-report messaging.

## Selected Contract

### Background Session V1

Persist `.forge/background-sessions/<sessionId>/session.json` with schema version, source workspace identity, execution-contract digest/revision, isolated root, baseline hashes, exact model bindings, budget, PID, heartbeat, lifecycle status, last error, result paths, notification state and merge state. Writes are atomic and bounded. Symlinks and paths outside the source/isolated roots are rejected.

Statuses are `preparing -> running -> awaiting_input | awaiting_approval | awaiting_review | completed_no_changes | failed | gave_up | cancelled`, plus `stale` derived by the host from PID/heartbeat evidence. Only the host may transition `awaiting_review` into merge states.

### Launch And Continuity

The extension creates a detached Git worktree or filtered copy, overlays current dirty state, copies the active run state and confirmed execution contract into the isolated root, then spawns the packaged `backgroundRunner.js`. The runner receives only a manifest path; API credentials remain process-environment memory and are never written to the manifest or logs. Product launch requires an active nonterminal run, a confirmed and available execution contract, no pending clarification/tool approval, a bounded budget and no competing live background lease for the workspace.

The runner resumes the same session/contract in the isolated root and uses the existing `AgentHarnessLoop`. It writes heartbeat and bounded status after every step. It exits at clarification, approval, pause, terminal state or budget boundary. A later explicit Resume launches a fresh detached runner against the same retained isolated root; no zombie process is resurrected.

### Isolation And Merge

All background mutations land only in the retained isolated root. The source workspace remains byte-identical until an explicit host merge. `awaiting_review` requires terminal green state, same-run evidence, model-driven accounting according to the active assurance level, and a non-empty isolated diff.

Review opens the native diff/artifacts. Merge is an explicit host command and requires:

- matching session, contract revision and digest;
- no live runner lease;
- green isolated composite oracle and assurance success gate;
- independent model Reviewer approval plus deterministic diff approval for changed work;
- unchanged source baseline hashes for every changed/deleted path;
- bounded path/file/byte limits and no symlinks;
- atomic copy/delete with rollback bytes;
- a fresh composite oracle in the active workspace after merge.

Red fresh verification rolls back every merged byte and records failure. The runner cannot invoke merge, approve itself, or write source evidence.

### Native Product Surface

Reuse the session popover. Background rows show one compact state dot, model, elapsed time and cost, with contextual Resume, Review, Merge, Cancel and Open Log actions. Add one composer action to send an eligible confirmed run to Background. Completion/failure/stale states use deduplicated native IDE notifications with Review/Open Log actions. No permanent dashboard or second composer is added.

## Failure And Recovery

- Duplicate launches fail against an atomic lease.
- Stale heartbeat never implies completion; it becomes `stale` and requires explicit Resume or Cancel.
- IDE restart scans manifests, validates workspace identity and reattaches watchers without altering run state.
- Missing isolated roots become failed/abandoned; no merge is attempted.
- Background approval or clarification boundaries notify and remain paused; the detached runner exits.
- Cancellation is cooperative through a control file, then process termination after a bounded grace period. Retained staging is preserved for review unless explicitly discarded.

## Non-Goals

- No cloud runner, remote queue, service installation or startup persistence.
- No simultaneous writers to one source workspace.
- No background browser/computer action or interactive MCP credential prompt.
- No automatic merge, self-review, hidden provider spend or bypass of execution contracts.
- No Phase 95 customization import or Phase 96 attestation work.

## Required Evidence

- Launcher exits while a scripted detached runner continues and reaches a bounded terminal/review state.
- Active source bytes do not change before merge.
- Duplicate lease, stale/tampered manifest, forged contract, missing root and red-oracle paths fail closed.
- Reviewed merge succeeds only with unchanged baselines and fresh green verification; conflict/red verification rolls back.
- IDE-host reload reattaches state and emits one deduplicated native notification.
- Compact desktop/sidebar UI remains contained.
- Full no-spend, worker, extension-host, visual, package, VS Code install and actual Antigravity interaction gates pass.

