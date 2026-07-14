# Phase 98 Branch-and-Compare Design

Status: PLANNED

## Objective

Run two or three bounded candidates against the same frozen task contract in separate disposable worktrees or workspace copies, then produce a host-owned ranking. A candidate is selectable only when its normal Forge run is terminal-successful, its deterministic oracle and same-run evidence are green, an independent model reviewer approved it, and the result is model-driven rather than fallback-only.

## Frozen Comparison Contract

Forge snapshots one source baseline and creates a canonical comparison contract containing the goal, source identity, execution-contract policy excluding candidate model identity, assurance level, mode/tool ceiling, oracle contract, customization digest, budget, candidate count, and reviewer model. Every candidate receives this same contract and source snapshot. Candidate model identity is recorded as a treatment variable, not allowed to change authority.

The coordinator refuses fewer than two or more than three candidates, duplicate candidate IDs, provider meta-routes, a missing reviewer model, or a reviewer model equal to any candidate model. Provider fallback arrays are disabled for comparison calls so requested candidate and reviewer identities remain exact. Per-candidate and total cost/step bounds remain host-owned.

## Execution

- Prepare every isolation root before any candidate runs so all candidates derive from the same source baseline.
- Run candidates concurrently with separate provider instances and separate Forge session IDs.
- Use the existing `AgentHarnessLoop`; do not add a mutation shortcut or a second success path.
- Never merge during candidate execution. The active source workspace must remain byte-identical.
- Preserve candidate roots for native review until the comparison is explicitly discarded or superseded.

## Eligibility And Ranking

Eligibility is deterministic and conjunctive:

1. terminal state is `success`;
2. the existing assurance gate is ready;
3. a green composite oracle event and same-run green evidence exist;
4. deterministic diff review is approved;
5. an independent configured model review is approved;
6. `actuallyModelDriven` is true and `modelDrivenProposals > 0`;
7. source bytes and frozen comparison contract remain unchanged.

Red, missing-proof, deterministic-review-only, fallback-only, tampered, stale, or failed candidates are ineligible regardless of cost or latency. Eligible candidates rank by lower fallback dependence, lower verified cost, then lower wall-clock latency, with candidate ID as a stable tie-breaker. Cost and latency never outrank correctness.

## Host Authority And Merge

Candidates cannot invoke comparison, selection, approval, or merge tools. Forge writes a canonical report under `.forge/branch-compare/`, opens candidate changes with the native diff editor, and requires a fresh host review digest before selection. A host merge rechecks source baselines, candidate/report identity, eligibility, changed-file bounds, independent review, and a fresh source oracle. Any failure rolls back byte-for-byte and records merge evidence.

## Product Surface

Keep one composer. Add one collapsed `Branch and compare` proof disclosure with run, report, candidate-diff, and merge actions. Detailed contracts, rankings, metrics, reviews, and merge evidence remain native JSON/diff artifacts.

## Risks And Rollback

- Concurrency can magnify provider cost: cap fanout at three and expose aggregate budget before launch.
- Dirty-worktree drift can make candidates incomparable: bind a complete filtered source baseline and refuse stale selection.
- Model review can be self-review: require a distinct configured reviewer model and record provider-backed review evidence.
- Ranking can reward cheap false success: eligibility precedes all cost/latency sorting.
- Partial merge can damage source: reuse bounded backups, rollback, and fresh source oracle behavior.

## Non-Goals

- No candidate-authored merge or winner declaration.
- No model-as-judge ranking without deterministic gates.
- No unrestricted Git branch mutation, checkout, commit, or reset.
- No permanent candidate dashboard or second composer.
- No claim of live-model quality without an authorized paid run.

## Acceptance Evidence

- Causal strong/weak candidates prove green model-driven selection over red and fallback-only candidates.
- Contract, source, report, review, and candidate tamper fail closed.
- Candidate roots are distinct, execute concurrently, and leave source bytes unchanged.
- Host merge requires native diff review, rejects stale source, rolls back on red source oracle, and cannot be initiated by a candidate.
- Compile, static, regression, worker, extension-host, visual, package/install, and actual Antigravity interaction gates pass.
