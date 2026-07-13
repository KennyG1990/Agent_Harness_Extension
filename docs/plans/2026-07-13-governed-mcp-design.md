# Phase 87 Governed MCP Design

## Objective

Add useful MCP tool interoperability without creating a protocol-shaped bypass around Forge's deterministic authority. MCP servers and their output are untrusted. The model may only propose one generic `external_tool` action; the host resolves it against a trusted server/tool policy, validates its payload, applies approval rules, invokes it, bounds the result, and records evidence.

## Reconciled Current State

Forge 0.86 has a closed native `ToolName` union and `WorkspaceTools` registry. Browser and computer interaction already demonstrate the required pattern: inspected/configured capability, deterministic validation, exact approval where required, bounded execution, and separate evidence. There is no MCP client or external-tool policy layer.

The research requires an MCP plus native tool layer, but does not authorize automatic discovery or direct model execution. The extension pivot means configuration, credentials, commands, and artifact access belong to the extension host and native IDE settings.

## Supported Transport Boundary

- Local stdio servers launched without a shell through the official MCP TypeScript SDK v1.
- Loopback-only Streamable HTTP endpoints.
- No legacy SSE fallback in this phase.
- No unrestricted remote MCP endpoint. Phase 89 must establish network isolation before that authority is considered.

## Configuration Authority

Native `forge.mcpServers` configuration contains non-secret server definitions. Each definition has:

- stable `id`, display `name`, enabled flag, and transport;
- stdio command/argument vector or loopback HTTP URL;
- bounded timeout and output cap;
- an exact `toolPolicies` map.

Credentials never appear in configuration. `forge-agent.setMcpCredential` and `forge-agent.clearMcpCredential` store bearer tokens or one configured stdio environment value in VS Code SecretStorage under a server-bound key.

Workspace/model messages cannot add servers, alter policy, or supply executable commands, URLs, headers, or credentials.

## Per-Tool Policy

An MCP tool is exposed only when its exact discovered name has a valid policy:

- `sideEffect`: `read`, `workspace_write`, `network`, or `external_write`;
- `approval`: `never` or `always`;
- `allowedRoles`: bounded Forge role list;
- `scope`: `workspace` or `external`;
- `workspacePathFields`: payload fields that must resolve inside the workspace;
- `evidenceRequired`: always true for side-effecting tools and configurable for reads.

Deterministic normalization upgrades every non-read policy to `approval: always`. A read tool may use `never`. Missing, malformed, disabled, undiscovered, or role-disallowed policies reject before connection/call.

## Proposal Contract

Add one native proposal:

```json
{
  "name": "external_tool",
  "arguments": {
    "serverId": "local-docs",
    "toolName": "search_docs",
    "payloadJson": "{\"query\":\"checkpoint\"}"
  }
}
```

`payloadJson` preserves a closed structured-output schema while allowing each discovered MCP tool to own a different JSON Schema. The host parses it with size/depth/prototype-key limits and validates it using Ajv against the discovered `inputSchema` before invocation.

## Execution Chain

`external_tool` uses the normal Forge chain:

`PROPOSE -> role/workflow validation -> MCP policy/schema/scope validation -> pre-commit review when side-effecting -> exact approval when required -> checkpoint when workspace-writing -> SDK call -> bounded output -> evidence -> NARRATE`

The MCP gateway cannot declare Forge success, update harness state directly, or satisfy the composite code oracle. Tool output is represented as inert bounded text and never reinterpreted as host instructions.

### Weak-worker compatibility

`external_tool` is intentionally a fixed, shallow structured call so weaker models can use heterogeneous MCP tools without reproducing each remote schema in the provider's top-level constrained decoder. The Architect may name an authorized server/tool and payload contract in the committed handoff, but does not invoke it. A weak Explorer, Editor, or Reviewer receives only the focused handoff plus the sanitized authorized catalog; its `payloadJson` is then parsed and validated against the discovered schema by the host.

The Phase 87 causal proof must use separate Architect and weak-worker provider sessions and demonstrate that the worker can execute an authorized read tool. Raw MCP output stays in the worker/evidence boundary and is represented to later roles only by bounded summaries. This is the first product gate for the coordinator pattern; persistent worker lifetimes, parallel fan-out, and rigor-matched cost comparison remain Phase 88 and Phase 90 work.

## Evidence

Every call writes a record under `.forge/mcp-runs/` and appends `.forge/mcp-interactions.json`. Records include server/tool identity, policy class, input digest, status, duration, output byte count/excerpt, error, and timestamps. Credentials and full sensitive payloads are excluded. Side-effecting calls always create evidence; read calls follow policy.

## UI

Keep MCP configuration behind one collapsed Settings section. Show configured server count and commands to refresh catalog, open sanitized catalog, set/clear credential, and test connection. Do not add permanent server/tool panels to the run console.

## Failure Rules

- Discovery is not authorization.
- Unknown tools and schema-invalid payloads reject before invocation.
- Workspace path fields are realpath-contained.
- Side-effecting tools always ask even when ordinary workspace approval is auto.
- Output over the policy cap is truncated and marked.
- Timeout/close errors are failures, not partial success.
- External evidence cannot impersonate tests, diff review, or terminal success.

## Proof Requirements

Use a disposable official-SDK stdio fixture. Prove allowlisted read success, undisclosed tool rejection, schema rejection, traversal rejection, exact approval, credential redaction, output truncation, timeout, server failure, evidence persistence, no oracle impersonation, and process closure. Add extension-host command/catalog checks, collapsed visual settings proof, packaging, and installed VS Code/Antigravity smoke.

## Document Close - 0.87.0

Implemented as designed. The official SDK gateway, policy/schema/scope firewall, SecretStorage bridge, immutable evidence, weak-worker handoff proof, compact Settings row, native commands, extension-host coverage, package, and installed VS Code/Antigravity gates pass. Remote non-loopback MCP, persistent workers, and per-role economics remain explicitly outside this phase.

## AAR

- Worked: one generic proposal kept provider schemas shallow while the host validated each discovered schema and policy dynamically.
- Failed first: Electron-hosted stdio fixtures did not behave like Node until `ELECTRON_RUN_AS_NODE=1`; bundled worker-host lookup and Playwright runtime data also required explicit bundle-aware resolution.
- Surprise: Antigravity retained the old webview after hot install; installed-file markers were correct, but visual credit required `Developer: Reload Window` and a fresh accessibility/screenshot inspection.
- Causal lesson: weak-worker tool use is only meaningful when separate provider sessions, withheld authority, pre-approval immutability, tool-call counters, and final oracle evidence are asserted together.
- Next boundary: Phase 88 must convert the bounded topology fixture into persistent isolated worker lifecycles without letting workers spawn, route, merge, or self-certify.
