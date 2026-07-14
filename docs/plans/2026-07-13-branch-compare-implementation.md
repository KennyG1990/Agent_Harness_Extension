# Phase 98 Branch-and-Compare Implementation Plan

Status: COMPLETE

## 1. Contract And Coordinator

- Add canonical comparison/candidate/report types and digest verification.
- Build a bounded coordinator around existing isolation and `AgentHarnessLoop` primitives.
- Freeze source/task authority before concurrent candidate launch.
- Record model-driven, fallback, provider, cost, latency, oracle, review, and assurance facts from authoritative state.

## 2. Deterministic Selection

- Implement conjunctive eligibility with explicit rejection reasons.
- Sort only eligible candidates by fallback dependence, verified cost, latency, and stable ID.
- Persist immutable run reports plus `.forge/branch-compare/latest.json` and a concise native diff summary.

## 3. Host Review And Merge

- Create native source/candidate review copies and bind their digest.
- Require host approval of the current eligible candidate.
- Recheck report, candidate state, source baseline, changed-file bounds, and review identity before merge.
- Run fresh source verification and roll back all paths on failure.

## 4. Extension And Compact UI

- Register run/status/open-diff/approve/merge commands.
- Add artifact routing and machine-readable webview messages.
- Add one collapsed Proof-tab disclosure; no second composer or persistent dashboard.

## 5. Validation

- Add a no-spend scripted causal suite for green/red/fallback-only/cost/latency ranking and all tamper/stale/rollback paths.
- Extend static, extension-host, and visual invariants.
- Run broad regressions and worker stress.
- Package version `0.98.0`, inspect contents, install in VS Code and Antigravity, and interact with the installed compact surface.

## Review Checklist

- Candidate cannot merge itself.
- Reviewer is independent and provider-backed.
- Red/missing/fallback-only result cannot rank selectable.
- Model identity cannot alter the frozen authority contract.
- Source is unchanged before host merge and exactly restored after failed merge.
- Cost/latency labels are measured, not heuristic.

## Validation Close

- Causal coordinator proof: three 250 ms candidates overlapped; green model-driven beat cheaper red and cheapest fallback-only outcomes; fallback/cost/latency ordering, exact source preservation, report/candidate tamper, source drift, red-oracle rollback, and green host merge passed.
- Reviewer/candidate routes use exact concrete slugs with provider fallback arrays disabled. Meta-routes and candidate-as-reviewer are rejected.
- `npm run compile`, `npm test`, `npm run test:branch-compare`, `npm run test:visual`, worker stress 100/100, and `npm run test:e2e` passed without provider spend.
- `forge-agent-0.98.0.vsix` packaged with `out/harness/branchCompare.js`; VS Code and Antigravity install/list 0.98.0.
- Actual Antigravity shows the installed collapsed comparison surface, Qwen 9B candidates, distinct reviewer, unchecked spend gate, disabled Compare, and native review/approve/merge actions.

## AAR

- Worked: composing existing isolation, harness, reviewer, baseline, native diff, and rollback primitives avoided a second execution engine.
- Failed during implementation: initial compile exposed a helper/local identifier collision; it was corrected before extension wiring.
- Surprises: reviewer calls inherited general OpenRouter fallback routing, which weakened exact independence. Comparison now disables fallback arrays and rejects meta-routes.
- Re-plan: host selection was widened from only the top-ranked candidate to any deterministically eligible candidate; ranking remains advisory while eligibility remains authoritative.
- Reusable lesson: comparison identity must bind exact routes and recompute ranking, state, contract, candidate, source, and review digests at the action boundary.
- Next boundary: Phase 99 must turn comparable reports into local empirical model profiles without presenting catalog heuristics as measured performance.
