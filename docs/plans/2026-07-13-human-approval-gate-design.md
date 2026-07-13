# Human Approval Gate Design

## Goal

Replace the cosmetic composer shield with a host-owned approval policy that can pause a validated consequential action before COMMIT without weakening Forge's deterministic controls.

## Decision

Forge exposes two policies:

- `ask`: pause `write_file`, `apply_patch`, and `run_command` after deterministic validation and pre-commit review, before checkpoint creation or workspace mutation.
- `auto`: skip only the human pause. Role capabilities, workflow governance, schema/path/command validation, pre-commit review, checkpoints, transaction isolation, oracles, and evidence gates still run.

The extension host owns the policy through native configuration. The webview can request a policy change but cannot supply approval state, a proposal, or a commit payload.

## Persisted Contract

Each gated proposal creates a `PendingHumanApproval` in the harness state with a host-generated ID, session/task identity, role, exact structured proposal, SHA-256 digest, summary, and timestamps. The state enters `awaiting_approval`. No checkpoint, worker process, command, edit transaction, oracle, or second provider call occurs while pending.

Approval resolves only the current pending ID and commits the exact persisted proposal through the normal COMMIT path. Rejection records the decision, adds bounded scratchpad context for the next proposal, performs no mutation, and returns the run to `idle`. A forged, stale, duplicate, or mismatched decision is rejected.

## UX

The composer shield displays `Ask before changes` or `Auto approve`. When an action is pending, one compact in-chat approval card shows role, tool, bounded target/command summary, and `Approve` / `Reject` actions. The composer remains at the bottom and no permanent permission panel is added.

## Validation

- Ask mode pauses after validation with zero mutation and zero checkpoint.
- Approval commits the exact persisted action without another provider call.
- Rejection performs no mutation and cannot be replayed.
- Forged and duplicate IDs reject.
- Auto mode proceeds without a human pause but an invalid action still fails the deterministic firewall.
- Extension-host tests prove webview-supplied state cannot spoof approval.
- Visual smoke captures ask mode and the compact pending card at desktop and sidebar widths.

