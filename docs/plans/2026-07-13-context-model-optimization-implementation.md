# Phase 90 Context And Model Optimization Implementation Plan

> **For Agent:** Follow `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR` for every batch.

**Goal:** Add bounded symbol/image/neighbor context, selected-model-aware prompt budgets, cost-aware worker routing, and causal plan-big/execute-small measurement to the existing governed loop.

**Architecture:** Extend the validated workspace index and composer context store for host-owned task context. Add pure context-profile and route-policy modules consumed by the current loop before worker creation. Persist sanitized decisions and prove the topology with scripted providers and disposable workspaces.

**Tech Stack:** TypeScript, VS Code extension API, existing OpenRouter/OpenAI-compatible provider interface, workspace index, deterministic prompt scheduler, persistent sub-agent coordinator, Node smoke/eval scripts.

## Task 1 - Symbol And Neighbor Context

**Files:** modify `src/harness/workspaceIndex.ts`, `src/harness/composerContext.ts`, `src/extension.ts`, `src/webview/src/App.tsx`, and focused context/index tests.

1. Add ranked symbol mention candidates with stable file/line/name identity.
2. Revalidate the selected symbol against the current index and filesystem.
3. Capture a bounded declaration window plus exact-name reference windows from at most four contained indexed files.
4. Persist provenance and expose only summaries to the webview.

Gate: exact ranking and neighbor positives plus stale, forged line, traversal, symlink, oversized, and metadata-leak negatives.

## Task 2 - Governed Image Context

**Files:** modify `src/harness/composerContext.ts`, `src/harness/provider.ts`, `src/harness/loop.ts`, `src/extension.ts`, and context tests.

1. Add native image selection for PNG/JPEG/WebP with contained regular-file, MIME, and byte limits.
2. Persist path/digest/metadata, not raw image bytes, in session artifacts/webview messages.
3. Build a transient provider image part at call time after revalidation.
4. Reject before provider invocation when the selected exact model is not vision-capable.

Gate: supported image reaches a scripted vision provider; non-vision, tampered, outside, symlink, oversized, and unsupported-format inputs never call the provider.

## Task 3 - Model-Aware Context Profiles

**Files:** create `src/harness/contextOptimization.ts`; modify `src/harness/loop.ts`, `src/harness/types.ts`, provider/catalog cache, and tests.

1. Derive bounded prompt/output budgets from exact selected model capabilities/context and role.
2. Record required/optional section allocation, source, dropped bytes, and effective model in `.forge/context-optimization.json`.
3. Add deterministic compact extracts and an opt-in bounded model-written compaction A/B that never replaces required source.
4. Add native artifact command and compact sanitized status.

Gate: 16K/32K/128K/1M model fixtures prove monotonic bounded budgets, required-section survival, output reserve, deterministic fallback, and no raw source in UI state.

## Task 4 - Least-Expensive-Capable Routing

**Files:** create `src/harness/modelRouting.ts`; modify `src/harness/loop.ts`, `src/harness/subAgentCoordinator.ts`, `package.json`, Settings UI, and tests.

1. Accept an explicit configured worker model pool and optional mandatory per-role bindings.
2. Classify terrain from host-owned task/state signals.
3. Filter for structured output/tool/context requirements and rank by estimated blended price, capability fit, and configured priority.
4. Persist exact candidates, rejection reasons, selection, escalation, and immutable worker route.

Gate: cheap simple-task selection, architect-required terrain, insufficient-context rejection, no-price honesty, explicit-binding preservation, and post-first-call route immutability.

## Task 5 - Product Topology A/B

**Files:** create focused disposable fixture runner/script; modify report commands and `BUILD_LOG.md` only after execution.

1. Run one same-rigor solo-frontier lane and one strong-Architect/cheap-Editor lane through the product loop.
2. Use fixed held-out oracle and identical firewall/reviewer/evidence/step policies.
3. Record role calls/tokens/cost/latency, fallback, model-driven solve, and prompt-compaction data.
4. Mark no uplift honestly; never infer savings from configured prices without usage.

Gate: scripted causal A/B passes offline; live OpenRouter A/B remains opt-in and requires explicit spend authorization.

## Task 6 - Release Validation

1. Run focused context/routing/topology tests and all no-spend regressions.
2. Run worker 100/100, MCP, browser/computer, sub-agent, runtime isolation, visual, and extension-host E2E.
3. Review every Phase 90 claim against artifacts and explicit negative paths.
4. Bump/package/inspect/install in VS Code and Antigravity; interact with actual Antigravity.
5. Close ROADMAP, gap analysis, handoff, BUILD_LOG, plans, and AAR.

No paid provider call is authorized by this plan.

## Document Close

- `IMPLEMENT`: all six tasks landed, including symbol/image context, model profiles, opt-in worker routing, topology A/B, native commands, and focused tests.
- `VALIDATE`: focused and broad no-spend tests pass; worker stress is 100/100; extension-host E2E exits 0; visual smoke is inspected at desktop/sidebar widths.
- `REVIEW`: image bytes remain transient, non-vision rejection occurs before provider use, routing cannot replace Architect/Reviewer authority, worker routes are immutable after first call, and fallback cannot masquerade as model-driven success.
- `PACKAGE/INSTALL`: `forge-agent-0.90.0.vsix` is 3,119,583 bytes with SHA-256 `9B3F84B0BBA3144F07BCD294AB6DD88702A491A3410AE1D82E96550EAF7F7B48`; VS Code and Antigravity both report `kennyg.forge-agent@0.90.0`.
- `INSTALLED PRODUCT`: actual Antigravity ran the topology command, wrote `.forge/evals/latest-plan-big-execute-small.json`, and opened it in a native editor.
- `BOUNDARY`: no paid provider call ran. Scripted accounting is causal wiring proof, not a live savings or solve-rate claim.

## AAR

- Sustain transient image handling, host-owned routing inputs, immutable exact model slugs, mandatory Architect/Reviewer bindings, and same-rigor comparisons.
- The E2E host recovered from two unresponsive/responsive cycles. Phase 91 should keep benchmark work outside the extension repo and avoid multiplying host resource load.
- Installed command selection must be filtered to the exact command name; a fuzzy `Context Optimization` search initially surfaced an unrelated Go command, and a first ambiguous keyboard selection created no report. Neither attempt is proof.
- Use report existence, timestamp, content, and native open state together for installed-command claims.
- Suggested commit title: `Phase 90: optimize context and model routing`.
