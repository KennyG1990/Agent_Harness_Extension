# Phase 87 Governed MCP Implementation Plan

## Workflow

Every batch follows `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`.

## Batch 1 - Policy And Gateway

1. Add official MCP SDK v1, Zod, and Ajv runtime dependencies.
2. Create `src/harness/mcpGateway.ts` with strict server/policy normalization, stdio and loopback HTTP transports, discovery filtering, schema/scope validation, bounded calls, connection closure, and sanitized evidence.
3. Add pure policy and payload validation tests plus an official-SDK stdio fixture server.

Gate: configured tools discover; undeclared tools never expose; invalid policy/payload/path/transport/credential data rejects before calls.

## Batch 2 - Harness Integration

1. Add `external_tool` to the closed proposal schema and mode/tool ceilings.
2. Inject one configured gateway into `WorkspaceTools`, `Firewall`, and `AgentHarnessLoop`.
3. Make dynamic MCP policy determine mutation, approval, role, scope, checkpoint, dispatch, result capture, counters, and evidence persistence.
4. Add bounded MCP catalog context to provider prompts.

Gate: a scripted model can call an allowlisted fixture tool only through the ordinary firewall and exact approval path. MCP output cannot set oracle green or terminal success.

Add a causal Architect-to-weak-worker fixture: Architect writes the required external-tool action into its handoff, a separate scripted weak Editor session emits `external_tool`, and the governed gateway returns evidence without granting the Architect tool authority. Assert separate provider session IDs and role tool ceilings; the fixture must fail without the handoff or explicit discovery and authorization.

## Batch 3 - Extension Host And Compact Settings

1. Add native configuration schema and SecretStorage commands.
2. Add commands to list sanitized tools, test a configured server, open the catalog, and set/clear a server credential.
3. Add one collapsed MCP section in Forge Settings with server/catalog status and native-settings/artifact actions.

Gate: no credential reaches webview state, support artifacts, catalog artifacts, logs, or evidence.

## Batch 4 - Validation And Review

1. Run causal stdio read and side-effect lanes.
2. Run undisclosed/schema/traversal/role/approval/replay/output/timeout/failure negative lanes.
3. Run full static, harness, browser/computer, worker, visual, and extension-host regressions.
4. Review process cleanup, transport bounds, policy authority, and evidence claims.

## Batch 5 - Release Close

1. Bump to `0.87.0`.
2. Package and install the same VSIX in VS Code and Antigravity.
3. Open Forge in a fresh Antigravity window and verify the collapsed MCP settings surface.
4. Update `ROADMAP.md`, `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`, `HANDOFF_OPUS.md`, and `BUILD_LOG.md` with exact proof, limitations, document close, and AAR.

No paid OpenRouter call is required or authorized for this phase.

## Document Close - PASS

All five batches completed in `0.87.0`. Focused MCP causal/negative tests, full static/regression tests, desktop/sidebar visual smoke, bundled extension-host E2E, package inspection, VS Code install, Antigravity install, and actual Antigravity interaction pass. The final VSIX is `forge-agent-0.87.0.vsix`, 1,795,285 bytes, SHA-256 `172C064AC826C3D9CDB69C2C9DC6EFAEA1A5EC80B0A021C982773632F65000B2`. Installed evidence: `artifacts/installed-governed-mcp-087.jpg`. No paid provider call ran.
