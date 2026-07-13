# Phase 92 Prompt Enhancement And MCP Onboarding Implementation Plan

## Lifecycle

`PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Reconciled Baseline

- `src/webview/src/App.tsx` currently wraps the draft in fixed prose entirely in the webview.
- `src/harness/provider.ts` already supports exact model IDs, session IDs, usage and strict JSON schema responses.
- `src/harness/mcpGateway.ts` already validates transport, loopback scope, secret references and explicit tool policies.
- `forge.mcpServers` is functional but only practical through manual settings JSON.
- Installed Kilo 7.4.5 uses a dedicated small model for prompt enhancement and exposes server management; its permissive authority model is not copied.

## Tasks

1. Add a pure prompt-enhancement service with strict schema, bounded parser and deterministic renderer.
2. Add host bridge/command, persisted enhancement-model setting, usage response and no-auto-submit UI state.
3. Add searchable prompt-model selection to the collapsed Model Routing settings.
4. Export MCP configuration normalization and add pure upsert/remove helpers.
5. Add native Add/Remove MCP commands and compact buttons under the existing collapsed External Tools settings.
6. Add bounded `forge.mcpTimeoutMs` and wire it into the existing gateway.
7. Add focused/adversarial tests and extension-host/static assertions.
8. Run full applicable release gates, review against this contract, close documents and record AAR.

## Review Checklist

- No prompt enhancement path reaches `AgentHarnessLoop`, `WorkspaceTools`, approval, evidence or success state.
- The webview cannot select an unpersisted model for a call or auto-send the returned draft.
- MCP configuration never implies discovered/authorized status until the existing gateway proves both.
- No secret values are accepted in MCP server configuration.
- No existing Kilo parity claim is credited without code or executed evidence.

## Document Close

- `PLAN/RECONCILE/DOCUMENT`: inspected all 15 installed Kilo 7.4.5 settings categories plus Agents, MCP Servers, Rules, Workflows and Skills sub-surfaces in actual Antigravity; recorded dispositions in `docs/KILO_FEATURE_SETTING_AUDIT.md` before product edits.
- `IMPLEMENT`: strict prompt enhancement, host-owned model setting/commands, exact usage status, no-auto-submit bridge, native MCP add/replace/remove onboarding, stronger config normalization and bounded timeout landed.
- `VALIDATE`: focused/adversarial, static, governed MCP, conversation, model-profile, 100-worker, desktop/sidebar visual, extension-host, package, VS Code install and actual Antigravity interaction gates pass without a paid provider call.
- `REVIEW`: fixed three defects found during review: generic loop-profile language was removed from the rewrite prompt, cancelled MCP policy input can no longer create an empty config, and stale catalogs now display the persisted exact enhancement slug. Visual review also removed an unrelated checkpoint overlay from the proof screenshot.
- `DOCUMENT CLOSE`: release evidence is recorded in `BUILD_LOG.md`; roadmap, gap analysis and handoff match the installed `0.92.0` state.
- Suggested commit title: `Phase 92: add governed prompt enhancement and MCP onboarding`.
- Final artifact: `forge-agent-0.92.0.vsix`, 3,140,076 bytes, SHA-256 `B59C5999D4D505EFA1BFB46EA9C2F8AA94699165C07919E96E6A0A8845D11E02`. VS Code registered `kennyg.forge-agent@0.92.0`; Antigravity printed successful installation before its CLI crashed during shutdown with exit `134`, so the actual IDE remains the installed-interaction proof surface.

## AAR

- **Sustain:** actual-product comparison, host-owned settings, strict structured parsing, no-auto-submit semantics and reuse of existing MCP validation.
- **Improve:** visual tests must inspect screenshots, not only selectors; a passing selector test initially hid a stale-model label and inherited popover.
- **Surprise:** Kilo's “small model” explicitly owns prompt enhancement, which exposed that Forge's wand was cosmetic despite the existing Fable system profile.
- **Next boundary:** Phase 91's paid fixed 16-task benchmark remains the only roadmap release floor awaiting external authorization. Live prompt-rewrite quality is also unmeasured but is not required to prove deterministic integration.
