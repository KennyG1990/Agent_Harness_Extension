# Phase 100 Governed Agent Gateway Implementation Plan

## PLAN

1. Add a reusable loopback gateway core with strict schemas, authentication, replay/rate/concurrency controls, sanitized views, and audit persistence.
2. Add an explicit external-proposal entrypoint to the existing harness loop; do not add an executor or success path.
3. Make the active Forge webview provider own gateway-managed runs and preserve external stepping across native contract, clarification, and approval decisions.
4. Add extension lifecycle, SecretStorage token, native commands, configuration, artifact access, and one collapsed Settings disclosure.
5. Add the separately bundled four-tool stdio MCP forwarding facade.
6. Prove causal harness behavior, transport negatives, MCP surface limits, static invariants, extension-host behavior, visuals, packaging, installation, and actual Antigravity interaction.

## RECONCILE

- `ForgeStudioWebviewProvider` already owns the conversational harness, native ask/approval flow, run publication, session storage, and terminal attestation. Reuse it instead of creating a gateway-only run manager.
- `AgentHarnessLoop.runStep` already owns schema repair, uncertainty, role/workflow/firewall validation, customization hooks, pre-commit review, human approval, checkpoints, transactions, oracles, evidence, and terminal truth. The only required core change is a validated submitted-envelope source.
- `mcpGateway.ts` is outbound Forge-to-tool infrastructure and cannot satisfy inbound agent access. Its explicit policy, bounded payload, SecretStorage, loopback, and evidence patterns are reusable.
- Phase 93 execution contracts already bind assurance, budget, model, mode, tool, workspace, approval, and customization authority. Gateway requests must carry the current digest rather than inventing authority.
- The webview already uses collapsed Settings disclosures and native artifact commands. Add no permanent gateway dashboard.

## DOCUMENT

- Design: `docs/plans/2026-07-13-governed-agent-gateway-design.md`.
- `ROADMAP.md` and `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md` record Phase 100 as planned/partial before product edits.
- Validation and package identities are recorded only after their gates execute.

## IMPLEMENT

### Task 1 - Harness proposal source

**Files:** `src/harness/loop.ts`, `src/harness/types.ts`, `scripts/agent-gateway-smoke.mjs`.

- Add a typed submitted proposal envelope and `runSubmittedProposal` method.
- Reuse the complete run-step implementation after deterministic envelope/schema validation.
- Record gateway proposal/rejection counts and model-driven provenance without Forge provider/fallback inflation.
- Prove malformed, out-of-scope, approval, red-oracle, and false-success paths in disposable fixtures.

### Task 2 - Loopback transport

**Files:** `src/harness/agentGateway.ts`, `scripts/agent-gateway-smoke.mjs`.

- Implement the authenticated five-route API and sanitized response schema.
- Add loopback/Host/Origin/content/body/schema/token/rate/replay/concurrency checks.
- Persist bounded replay and JSONL audit artifacts with request/body digests only.
- Prove disabled behavior, token rotation, duplicate retry, collision, forbidden routes, and redaction.

### Task 3 - Extension-host lifecycle

**Files:** `src/extension.ts`, `package.json`, `src/test/suite/index.ts`.

- Add start/stop/status/rotate/copy/open commands and SecretStorage token lifecycle.
- Delegate goal/proposal/status/cancel to the active provider and force human approval for gateway-managed consequential actions.
- Prevent native decisions from switching gateway-managed sessions to internal provider stepping.
- Add disabled-by-default configuration and extension-host authenticated read-only interaction proof.

### Task 4 - Optional MCP facade

**Files:** `src/harness/agentGatewayMcp.ts`, `package.json`, `scripts/agent-gateway-smoke.mjs`.

- Bundle `out/agentGatewayMcp.js` with the extension.
- Register exactly four forwarding tools.
- Read connection data only from environment variables and return bounded HTTP results.
- Prove tool absence and real stdio forwarding against the disposable loopback fixture.

### Task 5 - Compact product surface

**Files:** `src/webview/src/App.tsx`, `src/webview/src/types.ts`, `scripts/visual-smoke.mjs`, `scripts/smoke-tests.mjs`.

- Add one collapsed `Agent gateway` Settings disclosure with off/running status and start/stop/copy/open actions.
- Keep token values and request details out of webview messages.
- Add stable test IDs and desktop/sidebar screenshot proof.

## VALIDATE

- `npm run test:agent-gateway`
- `npm run compile`
- `npm test`
- affected causal suites including execution-contract, MCP, background, and attestation where changed
- `npm run test:visual`
- `npm run test:workers`
- `npm run test:e2e`
- `git diff --check`
- `npm run package`, `vsce ls`, SHA-256, exact VS Code/Antigravity install/list checks
- Actual Antigravity reload, collapsed Settings interaction, authenticated loopback status/goal/read-proposal proof on a disposable workspace, and screenshot
- No provider calls or OpenRouter spend

## REVIEW

- Attempt direct approval, clarification answer, evidence creation, oracle selection, merge, signing, key access, and success routes/tools; all must be absent.
- Attempt token leakage through status, errors, audit, replay, webview, MCP output, and support artifacts.
- Attempt Host rebinding, Origin requests, oversized/nested/unknown JSON, request replay collision, stale session/contract, parallel proposals, and post-rotation token use.
- Confirm native approval remains required and external stepping remains active after the decision.
- Confirm gateway-derived proposal credit is not fallback credit and does not fabricate Forge provider calls.
- Confirm no duplicate composer, permanent dashboard, raw state dump, or unrestricted inbound tool execution was added.

## DOCUMENT CLOSE / AAR

- Update `ROADMAP.md`, `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`, `HANDOFF_OPUS.md`, and `BUILD_LOG.md` only after evidence exists.
- Record exact command results, durations, screenshots, package identity, install state, known warnings, and live-provider boundary.
- Supply a suggested commit title without running Git commit commands.

### Close Result

- Focused gateway smoke, static invariants, extension-host E2E, visual smoke, packaging, dual install, and actual Antigravity interaction passed.
- Live fixture `C:\Users\Moshi\Desktop\Forge-Gateway-Live-Proof-2` terminaled success with green tests, required diff review, two green evidence entries, six gateway proposals, zero provider calls, zero fallbacks, and no model-driven credit.
- Native approval remained mandatory for both writes. The first red staged write left active files unchanged; the second bounded repair produced a green staged oracle and transactional merge.
- A live forbidden approval route returned HTTP 404. The gateway was stopped, disabled in native settings, and the copied configuration was cleared from the clipboard.

### AAR

- **Sustain:** external clients remain proposal sources only; execution-contract identity, deterministic validation, native approval, transactional staging, host oracles, diff review, evidence, and terminal truth stay in one normal harness path.
- **Corrected defect:** the first installed run revealed that approval accepted current webview model bindings, widening an empty gateway contract and making two unintended reviewer calls. The run was cancelled before merge. Approval now uses only confirmed contract bindings; a hostile-binding regression proves zero provider calls.
- **Tooling lesson:** transport-schema failures must be distinguished from harness rejections. Two malformed live PowerShell envelopes were rejected at the HTTP boundary because `$args` is reserved; they did not increment harness gateway rejection accounting or mutate state.
- **Boundary:** the gateway does not attest external model identity or quality. Paid Qwen 9B proof remains a separate experiment requiring explicit action-time authorization.
- Suggested commit title: `Phase 100: add the governed external agent gateway`.
