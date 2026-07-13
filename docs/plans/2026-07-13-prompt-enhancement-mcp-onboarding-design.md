# Phase 92 Prompt Enhancement And MCP Onboarding Design

## Objective

Close the two useful installed-product gaps found by the Kilo 7.4.5 settings audit: Forge's wand is a hard-coded client rewrite rather than model-assisted prompt engineering, and governed MCP requires hand-editing a complex configuration array.

## Acceptance Criteria

- The wand sends a bounded draft to an extension-host enhancer using a dedicated configured model and strict structured output.
- The host renders a deterministic enhanced prompt containing objective, scope, constraints, acceptance evidence and unresolved user-owned questions.
- Enhancement never auto-submits, starts a run, mutates state, exposes hidden reasoning or grants authority.
- Empty/oversized/malformed/provider-failed enhancement leaves the original draft unchanged and reports a bounded error.
- The selected enhancement model is host-owned, searchable in Settings and defaults to an inexpensive exact slug.
- Native commands can add and remove validated local stdio or loopback HTTP MCP server configurations, including explicit per-tool policies.
- MCP onboarding cannot authorize undeclared tools, store raw secrets in configuration, invoke a server, or bypass normal discovery, approval and evidence gates.
- Existing conversation, firewall, workflow, approvals, reviewer, oracle and success invariants remain green.

## Risks

- A prompt model may invent scope. Mitigation: strict fields, bounded normalization, explicit open questions and user review before submission.
- Webview-supplied model IDs could become authority. Mitigation: the webview may request a settings update, but enhancement resolves the persisted host setting.
- MCP onboarding could become auto-trust. Mitigation: configuration requires exact tool policies and uses the existing gateway validator; onboarding performs no discovery or execution.
- Provider calls cost money. Mitigation: only an explicit wand click invokes enhancement, usage/cost is returned, and no live call occurs in automated tests.

## Non-Goals

- Running the paid Phase 91 benchmark.
- Automatic prompt submission or background enhancement.
- MCP marketplace browsing, remote non-loopback servers, credential entry in configuration, or automatic tool authorization.
- Replacing native IDE completion, notifications, LSP, formatter, notebook, SCM or localization features.

## Rollback

- Remove the Phase 92 bridge/commands and restore the previous inert wand handler.
- Remove the new settings keys; existing MCP configurations and all harness state remain compatible.
- No workspace source file is modified by prompt enhancement or MCP onboarding.

## Required Evidence

- Focused fake-provider enhancement tests and malformed/empty/oversized/provider-failure negatives.
- MCP configuration normalization, secret-key rejection, remote HTTP rejection, duplicate upsert and removal tests.
- Compile/static/full no-spend suite, visual desktop/sidebar proof, extension-host command/bridge proof, VSIX content inspection, VS Code install and actual Antigravity interaction.
- Live enhancement is optional and requires an explicit user click; Phase 91 paid benchmark remains separately consent-gated.
