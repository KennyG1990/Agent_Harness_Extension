# Kilo Code Feature And Settings Audit

## Evidence Basis

- Inspected the installed Kilo Code `7.4.5` settings UI inside the actual Antigravity IDE on 2026-07-13.
- Prompt behavior was reconciled with Anthropic's current [Claude Fable 5 prompting guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5); the guidance informs model behavior but cannot weaken Forge authority.
- This is a product-fit audit, not a request to reproduce Kilo's architecture. Forge keeps the host IDE surfaces and its deterministic `PROPOSE -> VALIDATE -> APPROVE WHEN REQUIRED -> COMMIT -> NARRATE` authority.
- Dispositions mean: `ADOPT` adds missing value, `EQUIVALENT` credits an existing stronger Forge path, `HOST` deliberately uses VS Code/Antigravity, and `REJECT` would weaken scope or authority.

## Category Matrix

| Kilo category | Observed controls | Forge disposition | Decision |
|---|---|---|---|
| Models | Default, small, sub-agent, autocomplete and speech models; per-mode models; prompt-training filter | `ADOPT` + `EQUIVALENT` | Forge already has searchable/sortable role routing, exact worker routes and cost-aware pools. Phase 92 adds a dedicated host-owned inexpensive prompt-enhancement model. Autocomplete and speech remain host capabilities. |
| Providers | Gateway, environment providers, OpenRouter, direct providers and custom base URL | `EQUIVALENT` | Forge supports OpenRouter plus OpenAI-compatible endpoints, secret-vault credentials and readiness/catalog provenance. It does not add provider-account commerce or silently copy credentials. |
| Agent Behaviour: Agents | Built-ins, custom agents, default agent, sub-agents and marketplace import | `EQUIVALENT` | Forge has host-owned built-in/custom modes and persistent role workers. Marketplace code import is rejected; modes cannot widen deterministic tool authority. |
| Agent Behaviour: MCP | Server list, enable/disable, marketplace and management actions | `ADOPT` + `EQUIVALENT` | Governed MCP execution already exists. Phase 92 adds native custom server/tool-policy onboarding and removal without automatic authorization or remote marketplace trust. |
| Agent Behaviour: Rules | Additional instruction files and Claude configuration compatibility | `EQUIVALENT` | Forge already discovers repository rules and makes required workflow/goal contracts host-owned. Arbitrary external instruction loading is not copied because instruction files cannot grant authority. |
| Agent Behaviour: Workflows | User slash commands from configuration | `EQUIVALENT` | Forge's `/goal`, `/research`, universal lifecycle and trusted modes cover governed workflows. Unvalidated command macros are rejected as an authority bypass. |
| Agent Behaviour: Skills | Discovered skill paths/URLs and marketplace | `EQUIVALENT` | Forge banks and retrieves verified procedural skills. Remote skill URLs and marketplace imports are rejected until they have a signed, policy-reviewed ingestion design. |
| Auto-Approve | Session-cost alert and per-tool/path allow/ask policies | `EQUIVALENT` | Forge has hard cost/step/time budgets, role ceilings, path containment and digest-bound ask/auto approval. It intentionally does not offer blanket allow rules that bypass firewall, review or oracle gates. |
| Browser | Enable automation, system Chrome and headless mode | `EQUIVALENT` | Forge has bounded loopback browser inspect/action/validation plus immutable evidence. Remote or authenticated browsing remains denied without a separate policy. |
| Checkpoints | Enable snapshots | `EQUIVALENT` | Forge creates bounded pre-mutation snapshots, native diffs and proof-invalidating restore history. |
| Display | Username, font size and collapsed reasoning/terminal/edit blocks | `HOST` | Forge follows IDE theme/zoom and keeps verbose activity collapsed. It does not expose hidden reasoning or clone terminal/edit blocks. |
| Autocomplete | Inline completion, inline task keybinding and chat textarea completion | `HOST` | Antigravity/VS Code already own editor completion. Forge keeps composer mentions/slash actions but does not compete with the host completion engine. |
| Notifications | Sound notifications and sound selection | `HOST` | Forge uses inline ask/approval/progress cards and native IDE messages. Custom sounds are nonessential and add no harness capability. |
| Context | Project memory, auto-save, compaction threshold, old-output pruning and watcher ignores | `EQUIVALENT` | Forge has durable sessions, verified procedural memory, prompt budgets, required-section preservation, stale-output clearing, retrieval and bounded watcher exclusions. The model never decides what evidence may be discarded. |
| Commit Message | Language and custom commit prompt | `HOST` | Git commit creation remains outside Forge's mutation contract. Native Source Control or a dedicated user-invoked host command owns commit messages. |
| Indexing | Semantic enablement, provider/model, vector store, thresholds and batching | `EQUIVALENT` | Forge has a deterministic 5,000-file index plus opt-in OpenRouter embeddings, cache, provenance and fail-safe deterministic fallback. |
| Experimental | Remote control, formatter, LSP, tool batching, code search, image generation, notebooks, continue-on-deny, SWE-Pruner and MCP timeout | `EQUIVALENT` + `HOST` + `REJECT` | Formatter/LSP/notebooks remain native IDE surfaces; Forge already has diagnostics, symbol search, image context, code search and prompt pruning. Remote control and continue-on-deny are rejected. Phase 92 exposes bounded MCP timeout; tool batching remains sequentially validated rather than one opaque batch. |
| Language | UI locale | `HOST` | Forge follows the IDE locale and does not maintain a competing translation setting. |
| About | Version, support, telemetry, settings transfer/migration/reset | `EQUIVALENT` + `HOST` | Forge has privacy-minimized support artifacts and native extension/version/settings surfaces. It does not add telemetry or import secrets from another agent. |

## Phase 92 Selected Work

1. Replace the client-only prompt wrapper with a real host-owned structured prompt enhancer.
2. Add a dedicated inexpensive enhancement-model setting and searchable Forge model picker.
3. Enhancement populates the composer for user review; it never submits, starts a run, mutates files, or claims evidence.
4. Add native custom MCP server/tool-policy onboarding and removal, backed by existing validation and SecretStorage boundaries.
5. Add a bounded MCP timeout setting.

## Explicit Non-Goals

- Kilo account, gateway, marketplace, remote-control, telemetry or billing features.
- A second unrestricted tool loop, raw chain-of-thought, blanket per-tool bypass rules, or silent provider spend.
- Replacing native editor autocomplete, formatter, LSP, notebook, terminal, diff, source-control, localization or zoom surfaces.
