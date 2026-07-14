# Phase 100 Governed Agent Gateway Design

## Bounded Objective

Expose a disabled-by-default authenticated loopback API and optional stdio MCP facade that let external agents submit goals, structured Forge proposal envelopes, status requests, and cancellation requests. The extension-host-owned `AgentHarnessLoop` remains the only execution path and retains every authority gate.

## Acceptance Contract

- Bind HTTP only to `127.0.0.1`; reject non-loopback Host headers, browser Origin headers, missing/invalid bearer tokens, oversized bodies, unsupported content types, unknown fields, stale contract digests, replay collisions, concurrency conflicts, and rate-limit excess.
- Generate and rotate a 256-bit token in VS Code SecretStorage. Never persist, log, report, post to the webview, or return the token through an HTTP endpoint.
- Keep the gateway disabled by default. Enabling configuration does not weaken execution contracts, human approvals, mode tools, workspace scope, network policy, or assurance requirements.
- Accept only four external capabilities: submit goal, submit one structured proposal, inspect sanitized status/progress, and request cancellation.
- Do not expose approval, clarification-answer, trusted-evidence authoring, oracle selection, diff acceptance, merge, attestation, key management, or terminal-success control endpoints/tools.
- Route submitted proposals through the normal schema, uncertainty, role, workflow, firewall, hook, review, approval, transaction, oracle, evidence, and terminal gates.
- Keep gateway-managed runs externally stepped. Native contract/approval/clarification decisions may resolve a boundary but must not silently switch the run to Forge's internal proposal provider.
- Persist bounded replay and audit records under `.forge/agent-gateway/` without credentials, source contents, prompts, command output, or raw request bodies.
- Package an optional stdio MCP facade with exactly four matching tools and no authority-bearing tools.
- Preserve one bottom composer and add only one collapsed Settings disclosure plus native commands/artifacts.

## Architecture

### Transport authority

`src/harness/agentGateway.ts` owns the loopback HTTP listener, bearer authentication, host/origin checks, JSON bounds, request schemas, rate limiting, replay identity, serialized dispatch, sanitized audit evidence, and status contract. It receives an `AgentGatewayDelegate`; it cannot touch workspace files except its host-owned `.forge/agent-gateway` records.

### Harness integration

`ForgeStudioWebviewProvider` remains the active run owner. Gateway goal submission initializes its existing `AgentHarnessLoop` with code mode, host configuration, `humanApprovalPolicy: ask`, and the selected assurance level. Gateway proposal submission calls a new explicit submitted-proposal entrypoint on the same loop. That entrypoint validates the envelope and then executes the unchanged run-step pipeline. It records external model provenance without counting a Forge provider call or fallback.

Gateway-managed session identity is retained in the provider. Native user decisions publish state but stop at the resolved boundary; they do not invoke `runUntilBoundary` until the external client supplies the next proposal.

### External API

- `GET /v1/capabilities`
- `POST /v1/goals`
- `GET /v1/sessions/:sessionId`
- `POST /v1/sessions/:sessionId/proposals`
- `POST /v1/sessions/:sessionId/cancel`

Every route requires `Authorization: Bearer <SecretStorage token>`. Mutating HTTP verbs require `application/json`. Requests carry a bounded `requestId`; proposal requests also carry the exact current execution-contract digest. Same-ID/same-digest retries return the prior sanitized response; same-ID/different-digest retries fail closed.

The response contains only gateway/session identity, contract status/digest, harness status/phase, active task, oracle summary, pending-boundary identifiers, latest bounded progress, and deterministic rejection/recovery reasons. It never returns credentials, hidden prompts, chain-of-thought, full state, raw source snapshots, or trusted evidence bodies.

### MCP facade

`src/harness/agentGatewayMcp.ts` is a separately bundled stdio process. It reads the loopback URL and token from `FORGE_AGENT_GATEWAY_URL` and `FORGE_AGENT_GATEWAY_TOKEN`, then exposes:

- `forge_submit_goal`
- `forge_submit_proposal`
- `forge_get_status`
- `forge_cancel`

It forwards to the authenticated HTTP API. It has no local workspace, IDE, approval, evidence, oracle, merge, signing, or success authority.

## Security And Failure Behavior

- Listener startup fails if the requested port is occupied; it does not silently bind broadly or choose a different nonzero port.
- Port `0` is allowed for tests and explicit ephemeral use; the actual bound loopback URL is reported.
- One request dispatch runs at a time. Concurrent state-changing requests return `409` rather than racing the shared harness state.
- Token rotation invalidates old clients immediately because authentication reads current SecretStorage on every request.
- Gateway shutdown closes the listener but does not cancel or alter the current Forge run.
- A transport failure never mutates harness state. A rejected proposal remains an ordinary deterministic Forge rejection and cannot be rewritten by the transport.
- The gateway audit is descriptive evidence only. It cannot satisfy oracle, review, attestation, or terminal-success requirements.

## Compatibility And Non-Goals

- No public-network binding, TLS termination, remote gateway, OAuth, browser CORS, WebSocket stream, autonomous approval daemon, or multi-workspace server in Phase 100.
- No second composer, dashboard, nested IDE, alternate tool executor, alternate evidence ledger, or alternate success path.
- No claim that an external client is trustworthy merely because it possesses the token. The token grants proposal transport access, not Forge authority.
- Existing outbound MCP support remains separate: `mcpGateway.ts` lets Forge call governed external tools; Phase 100 lets external agents call into Forge.

## Rollback

Disable `forge.agentGatewayEnabled` or run the stop command. This closes the listener without deleting run state or weakening any harness contract. Token rotation invalidates copied credentials. Removing the Phase 100 transport leaves the core harness and existing outbound MCP gateway unchanged.

## Required Evidence

- Causal disposable-fixture proof that external read/mutation proposals use normal gates, mutating work pauses for native approval, false success stays impossible, and provider/fallback accounting remains honest.
- Auth, Host, Origin, payload, schema, replay, collision, contract, rate, concurrency, cancellation, audit-redaction, and disabled-start negatives.
- MCP tool-list and forwarding proof with absence of approval/evidence/merge/success tools.
- Compile/static, affected regressions, worker stress, extension-host E2E, desktop/sidebar visual inspection, package inspection, dual installation, and actual Antigravity interaction.
- No provider calls or OpenRouter spend are required for deterministic Phase 100 release proof.
