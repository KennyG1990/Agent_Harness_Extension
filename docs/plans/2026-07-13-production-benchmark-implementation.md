# Phase 91 Production Benchmark And Release Discipline Implementation Plan

> **For Agent:** Follow `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR` for every batch.

**Goal:** Add a fixed 16-task live weak-model benchmark with immutable evidence and machine-enforced release floors.

**Architecture:** Compose the existing Tier 2/3/4 task definitions, run them through the existing bare/harness evaluator, and wrap the raw report in a versioned production scorecard. Keep spend authorization and release classification host-owned. Treat installed-product evidence as a separate signed-by-facts attestation rather than inferring it from benchmark success.

**Tech Stack:** TypeScript, Node.js, VS Code extension API, existing OpenRouter provider and Tier 2 evaluator, SHA-256 canonicalization, native JSON editors.

## Task 1 - Fixed Production Suite

**Files:** create `src/harness/productionBenchmark.ts`; reuse `weakEvalTier2.ts`, `weakEvalTier3.ts`, and `weakEvalTier4.ts`.

1. Compose exactly 16 unique tasks and validate IDs, task kinds, source files, and held-out judges.
2. Persist a canonical suite digest, per-task input digest, and separate judge digest.
3. Reject task counts outside 16-25 and reject suite drift before provider creation.

Gate: duplicate IDs, missing judge, mutated task input, and mutated judge all fail deterministic validation.

## Task 2 - Scorecard And Release Floors

**Files:** `src/harness/productionBenchmark.ts` and focused smoke tests.

1. Normalize raw bare/harness results into a task scorecard.
2. Compute solve rates, model-driven rate, false-success rate, provider failure rate, total cost, wall-clock duration, and average call latency.
3. Evaluate versioned floors without treating fallback or scripted runs as live success.
4. Keep `benchmark_passed` separate from `release_ready`.

Gate: synthetic pass, no-uplift, false-success, provider-failure, fallback-credit, scripted, and missing-install-attestation reports classify correctly.

## Task 3 - Immutable Evidence

**Files:** `src/harness/productionBenchmark.ts` and tests.

1. Write `.forge/evals/latest-production-benchmark.json` only after an immutable run archive succeeds.
2. Use `wx` for `.forge/evals/runs/production/<runId>.json` and reject duplicates.
3. Record the raw progress report path and final raw archive path without claiming the mutable raw archive is immutable.

Gate: duplicate archive writes reject and cannot alter the first archive bytes.

## Task 4 - CLI And Extension Commands

**Files:** create `scripts/production-benchmark.mjs`; modify `package.json`, `src/extension.ts`, webview types/UI, and extension-host assertions.

1. Add `npm run eval:production -- --model <approved-slug> --live --confirm-credit-spend`.
2. Add `forge-agent.runProductionBenchmark`, `forge-agent.openProductionBenchmarkReport`, and a compact Proof action.
3. Validate consent, exact model, task count, steps, and timeout before provider activity.
4. Open reports in the native editor.

Gate: missing consent/frontier model/out-of-range limits reject before the runner or provider is called.

## Task 5 - Validation And Release Close

1. Run focused production benchmark smoke tests and all no-spend regressions.
2. Run extension-host E2E, visual smoke, and worker stress.
3. Bump/package/inspect/install in VS Code and Antigravity.
4. Invoke the installed open/report command without running a paid live benchmark.
5. Close roadmap, gap analysis, handoff, build log, plan, review, and AAR.

## Task 6 - Fable/Mythos Prompt Compatibility

**Files:** create `src/harness/modelPromptProfile.ts`; modify `src/harness/loop.ts`; add a focused no-provider smoke test.

1. Detect exact Fable 5/Mythos 5 model families from the selected slug.
2. Inject one concise required behavior section without changing tool authority or response schema.
3. Require action readiness, scope discipline, evidence-grounded progress, genuine ask boundaries, autonomous continuation for reversible authorized work, and no reproduced reasoning.
4. Keep all non-Fable/Mythos prompts byte-for-byte free of this addendum.

Gate: family detection positives/negatives, required clauses, no chain-of-thought request, no context-count exposure, and integration into the selected exact model prompt.

No paid provider call is authorized by this plan.

## Document Close

- `IMPLEMENT`: fixed 16-task suite, canonical digests, complete-suite validation, immutable final archives, score math, release floors, live CLI/commands, compact Proof UI, and Fable/Mythos prompt compatibility landed.
- `VALIDATE`: focused benchmark and prompt tests pass; broad no-spend matrix exits 0 in 143.9 seconds; worker stress is 100/100; final extension-host E2E exits 0 in 211.6 seconds; desktop and 520px visual smoke pass.
- `REVIEW`: final archives cannot claim immutability before `wx`; raw partial reports are progress only; wall-clock time is not mislabeled provider-only latency; duplicate/missing/drifted suites reject; false success and scripted runs cannot pass; live spend gates precede readiness/provider work.
- `PACKAGE/INSTALL`: final `forge-agent-0.91.0.vsix` is 3,131,408 bytes with SHA-256 `B98A7AF98D7839C2EA5B0AAECD6F423B0F2BECC9907EFE9AE46C13D35D010FEE`; it packages production benchmark and model-family profile runtime modules and installs in VS Code and Antigravity.
- `INSTALLED PRODUCT`: actual Antigravity after reload exposes both benchmark commands and the collapsed UI. Open Report reaches Forge and honestly reports no report before authorized execution.
- `BOUNDARY`: no paid benchmark ran. `benchmarkPassed` and `releaseReady` remain unclaimed pending explicit spend authorization and exact installed-artifact attestation.

## AAR

- Sustain fixed-suite digests, runner-only judges, one-write final evidence, separate benchmark/release status, independent spend consent, and exact weak-model qualification.
- A first scorecard implementation marked archives immutable before persistence; review corrected the ordering so release floors remain false until `wx` succeeds.
- Aggregate wall time was initially named provider latency; review renamed it to average wall-clock per provider call because test/oracle work is included.
- Extension-host runs recovered from two unresponsive/responsive cycles. Performance remains a release signal and should not be hidden by a zero exit code.
- Current Anthropic Fable guidance supports shorter behavioral steering, not removal of deterministic guardrails. Keep model-family advice concise and host-selected.
- Suggested commit title: `Phase 91: enforce production benchmark release floors`.
