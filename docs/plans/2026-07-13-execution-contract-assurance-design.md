# Phase 93 Execution Contract And Assurance Design

## Objective

Compile every mutating Forge run into a host-owned, versioned execution contract and enforce one of three assurance levels without weakening the current harness.

## Selected Contract

- `standard` is the compatibility default. It preserves the current workflow, firewall, human approval, checkpoint, transaction, reviewer, composite-oracle, evidence and success gates.
- `verified` requires explicit digest-bound contract confirmation before the first provider call, a model-driven run with no fallback actions credited toward completion, independent Reviewer approval for changed work, a full composite green oracle and same-run evidence.
- `audited` includes every Verified gate plus a proven OS/container isolation backend, oracle calibration and signed attestation. Phase 93 must fail closed while calibration is unavailable; Phase 97 will make this level executable.
- Contract confirmation is separate from tool approval. A contract confirmation authorizes the bounded run contract; it never approves a future mutation.

## Execution Contract V1

The host derives a canonical contract from the goal, workflow acceptance contract, mode tool ceiling, composer context, project adapter, budget, model bindings, approval policy and assurance level. It records objective, constraints, non-goals, allowed workspace scopes, allowed tools, expected files when known, required oracles, budget, exact role models and assurance requirements. SHA-256 is calculated over canonical authority-bearing fields only; timestamps and confirmation state are excluded.

Standard contracts are auto-confirmed at initialization. Verified and Audited contracts enter `pending` and stop before provider work. Approval/rejection must match session ID, contract ID, revision and digest. Rejection terminates honestly as `gave_up` without provider or workspace action.

## Revisions And Steering

Goal, constraints, acceptance criteria, non-goals, budget, model bindings, assurance, scope, tools or oracle changes produce a new immutable revision. Narrowing may continue under Standard; any authority widening invalidates confirmation and creates a new ask gate. Pending tool approvals become stale when their proposal no longer fits the active contract.

## Persistence And Compatibility

Persist the active contract to `.forge/execution-contract.json` and revision history to `.forge/execution-contracts.json`. Old sessions normalize to a derived, confirmed Standard contract without rewriting historical files until they are explicitly resumed. Existing commands remain compatible when assurance is omitted.

## UX

Add one compact assurance chip beside role/model/inference. The menu explains effective guarantees and unavailable prerequisites. Pending Verified/Audited contracts render one inline confirmation card with objective, scope, tools, oracles, budget and digest. Detailed JSON opens in the native editor; no permanent dashboard is added.

## Risks And Rollback

- Risk: treating assurance as cosmetic. Mitigation: success and provider-entry gates consume only host state.
- Risk: stale approval replay. Mitigation: session/revision/digest binding and one-time status transitions.
- Risk: legacy session breakage. Mitigation: deterministic normalization to Standard.
- Risk: Audited overclaim. Mitigation: strict-unavailable until all required capabilities produce evidence.
- Rollback: remove the Phase 93 fields and commands; Standard behavior remains the pre-Phase-93 execution path.

## Required Evidence

- Focused causal and adversarial contract tests.
- Zero provider calls before Verified confirmation or after rejection.
- Widening invalidates confirmation; narrowing cannot widen tools or budget.
- Verified cannot succeed with fallback actions, red/missing composite oracle, missing review or missing evidence.
- Audited rejects while calibration or isolation is unproven.
- Legacy sessions normalize and run under Standard.
- Static, full no-spend, worker, extension-host, desktop/sidebar visual, package, VS Code install and actual Antigravity interaction gates.
