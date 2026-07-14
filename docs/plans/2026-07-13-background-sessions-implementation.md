# Phase 94 Background Sessions And Native Notifications Implementation Plan

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Implementation Order

1. Add background-session schema, atomic store, workspace identity, lease/heartbeat and lifecycle validation.
2. Extract reusable isolated-workspace creation/diff/baseline primitives without weakening current isolated-run behavior.
3. Add packaged standalone `backgroundRunner.ts` that resumes one confirmed contract in the isolated root and never writes the source workspace.
4. Add extension-host manager commands for Start/List/Get/Resume/Cancel/Review/Merge and startup reattachment.
5. Implement conflict-checked atomic merge, independent-review requirements, fresh source verification and rollback.
6. Add deduplicated native notifications and compact session/composer actions.
7. Add focused detached-process, lease, tamper, source-preservation, merge/rollback, notification, extension-host and visual tests.
8. Run release gates, review authority paths, close documentation and record AAR.

## Acceptance Criteria

- A background run demonstrably continues after its launcher process exits.
- No background process can mutate the active workspace or merge itself.
- The exact confirmed execution contract survives reattachment and is revalidated before every resume/merge.
- Provider credentials never persist to disk or sanitized reports.
- One workspace has at most one live background writer lease.
- Merge requires independent review, unchanged baselines and fresh active-workspace green verification.
- Red verification or partial merge failure restores all source bytes.
- Reloaded VS Code/Antigravity can list and reattach the session; native notifications are deduplicated.
- The installed product remains one compact conversational extension.

## Planned Validation

Focused background causal/adversarial suite, `npm test`, `npm run test:workers`, `npm run test:e2e`, `npm run test:visual`, `npm run package`, VSIX inspection, forced VS Code/Antigravity install and actual Antigravity interaction. No paid provider call is required; detached causal runs use a deterministic scripted fixture provider.

## Document Close

PASS. All eight implementation steps landed. The focused no-spend suite proves a detached worker survives launcher exit, preserves the source workspace, pauses/resumes at ask and approval gates, rejects forged contracts/missing retained roots/stale reviews, recovers stale sessions, merges a reviewed green result and restores source bytes after a red source oracle. Static, worker 100/100, extension-host, visual, package/install and actual Antigravity interaction gates pass.

## Review

- Fixed a real resume defect that widened the confirmed step ceiling on every disk resume; resumed work now remains bounded by the execution contract.
- Kept provider credentials in child-process memory only and denied detached browser, computer and external interactive tools.
- Made review approval digest-specific and merge host-only; background processes have no source merge authority.
- Made rollback claims byte-verifiable. A failed restoration becomes `blocked`, never `rolledBack: true`.

## AAR

Sustain exact-contract revalidation, retained isolated roots, source-preserving pause boundaries and host-owned reviewed merges. The most important defect found was contract drift during resume, demonstrating that persistence tests must assert authority identity as well as state continuity. Keep the one-writer lease and digest-specific review as invariants. Improve extension-host responsiveness in later performance work; recovered stalls remain visible evidence rather than ignored noise.

Suggested commit title: `Phase 94: add durable isolated background sessions`.
