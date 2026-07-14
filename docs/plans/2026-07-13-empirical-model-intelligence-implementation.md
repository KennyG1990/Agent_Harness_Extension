# Phase 99 Empirical Model Intelligence Implementation Plan

## PLAN

1. Add a canonical empirical sample and profile compiler with strict source validation, cohort isolation, deduplication, confidence intervals, and digest-bound persistence.
2. Add deterministic production-benchmark and branch-comparison adapters. Unsupported legacy reports fail closed.
3. Register rebuild/get/open commands and artifact routes in the extension host.
4. Add a compact collapsed Proof control and pass validated empirical summaries into the searchable model picker.
5. Replace unqualified `best`, `strong`, and rank labels derived from model names with explicit heuristic wording.
6. Add focused, static, visual, extension-host, package, install, and actual Antigravity validation.

## RECONCILE

- Existing reports already record solve, fallback, provider, cost, and evidence facts, but not under one schema.
- Production benchmark has the strongest comparable per-task contract: fixed suite digest plus input and judge digests.
- Branch comparison has exact model bindings, common authority, report/candidate digests, assurance, oracle, review, fallback, cost, and latency.
- Legacy weak-eval reports do not consistently bind task inputs and judges, so treating them as comparable would overstate evidence.
- Current picker `reasoning rank`, `coding rank`, `best`, and `strong` labels are name-pattern heuristics. They are not measured ranks.

## DOCUMENT

- Design: `docs/plans/2026-07-13-empirical-model-intelligence-design.md`.
- Roadmap and research-gap analysis mark Phase 99 planned before implementation.
- Validation outputs and final package identity will be recorded only after gates run.

## IMPLEMENT

- New host module: `src/harness/modelIntelligence.ts`.
- New focused proof: `scripts/model-intelligence-smoke.mjs` and `npm run test:model-intelligence`.
- Extension commands: `rebuildModelIntelligence`, `getModelIntelligence`, and `openModelIntelligence`.
- Native artifact routes for JSON and Markdown summary.
- Compact webview message/state and heuristic/measured label separation.

## VALIDATE

- Compile and focused causal smoke.
- Static invariants and full test suite.
- Desktop and narrow visual smoke.
- 100-worker stress and extension-host smoke.
- Package inspection, exact VSIX hash, VS Code/Antigravity install, and actual Antigravity interaction.
- No provider calls or credit spend.

## REVIEW

- Verify report loads fail after tampering.
- Verify duplicate samples cannot inflate counts.
- Verify unlike cohorts cannot produce a head-to-head ranking.
- Verify fallback-dependent and false-success samples never count as model-driven solves.
- Verify scripted evidence cannot produce a `measured` badge.
- Verify picker heuristics are labeled as estimates.

## DOCUMENT CLOSE / AAR

- Complete. Focused causal/adversarial proof, Phase 98 regression, compile/static, desktop/sidebar visual, 100-worker stress, extension-host E2E, package inspection, dual install, and actual Antigravity interaction passed without provider spend.
- Review found and closed the critical evidence boundaries: duplicate aliases cannot inflate counts; source/report tamper and identity collisions reject; unlike cohorts and scripted/live provenance never pool; unverified live samples cannot satisfy the measured threshold; fallback and false-success samples cannot become model-driven solves.
- Picker language now distinguishes measured, provisional, heuristic, and catalog-only evidence. Catalog names and metadata never produce a measured badge.
- AAR: comparable identity is part of the metric, not metadata around it. Recompute derived rankings on load, keep source artifacts independently verifiable, and treat an empty empirical store as an honest product state rather than filling it with heuristics.
- Remaining boundary: no accepted live comparable reports exist in the installed workspace, so model quality and economics remain unmeasured until explicitly authorized runs produce sufficient evidence.
