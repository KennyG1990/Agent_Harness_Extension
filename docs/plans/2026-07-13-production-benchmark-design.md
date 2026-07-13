# Phase 91 Production Benchmark And Release Discipline Design

## Decision

Build one production benchmark wrapper over the existing fixed Tier 2, Tier 3, and Tier 4 suites. The combined suite contains 16 disposable JavaScript tasks: multi-file bugs, missing-test work, features, large files, haystacks, interface seams, symptom-only failures, coordinated edits, and spec-bound behavior. Do not create a second agent loop or weaken the existing held-out judges.

## Evidence Contract

- Canonicalize the task input visible to both lanes and record one SHA-256 input digest per task.
- Hash held-out judges separately and expose only their digests in benchmark metadata. Judge source remains runner-owned and absent from provider prompts.
- Execute bare and harness lanes through `Tier2EvalRunner` with the same model, task fixtures, and task order.
- Record bare/harness solved, model-driven state, workspace-oracle state, calls, failures, steps, cost, and benchmark wall-clock latency.
- Define false success as a model-visible green workspace oracle with a red held-out judge. Never allow report status to hide it.
- Write mutable partial progress only to the existing raw Tier report. Write the final production archive once with `wx`, then update a mutable `latest` convenience report.

## Release Floors

The host owns versioned floors. Initial defaults are:

- 16-25 completed tasks and exact suite digest match.
- zero false successes.
- zero fallback-solved credit.
- at least 40% model-driven harness solve rate.
- harness solve rate strictly greater than bare.
- provider failures at or below 10% of provider calls.
- a complete immutable archive.
- separate installed-product attestation for the exact extension version and VSIX hash.

`benchmark_passed` means benchmark floors passed. `release_ready` additionally requires installed-product evidence. A scripted run may validate mechanics but cannot satisfy the live benchmark floor.

## Spend And Product Boundary

The production runner is live-only in product use. It requires an approved weak-model slug, explicit action-time credit consent, bounded steps, call timeout, and task count 16-25 before provider creation. Tests may inject a fake runner and synthetic raw report without network use. The UI remains compact: one collapsed Proof action and native report opening.

## Non-Goals

- Claiming live uplift from scripted providers.
- Selecting a stronger model to manufacture a pass.
- Revealing held-out judge source to a model.
- Letting benchmark results self-attest installed behavior.
- Running fixtures against the extension repository.
- Replacing the existing Tier runner or product harness.

## Model-Family Prompt Follow-Up

Release discipline also requires the selected frontier model to receive compatible behavioral scaffolding. Add one host-selected, required prompt section for Claude Fable 5 and Mythos 5. Keep it brief and behavioral: act when facts are sufficient, stay within requested scope, ground progress in current-run tool evidence, pause only at deterministic user-owned gates, continue reversible authorized work, and never reproduce hidden reasoning. Do not remove Forge's structured proposal, firewall, approval, reviewer, oracle, evidence, or role ceilings. Other model families retain the existing prompt unchanged.
