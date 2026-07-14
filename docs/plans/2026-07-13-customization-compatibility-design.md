# Phase 95 Skills, Agents, Rules, And Hooks Compatibility Design

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Bounded Objective

Import compatible workspace customizations from common `.agents`, `.github`, and `.claude` locations while preserving Forge as the only authority and mutation loop. Skills provide progressively disclosed procedural context, agents become constrained Forge modes, rules provide path-scoped untrusted instructions, and hooks may deny, ask, narrow, or emit untrusted context/evidence candidates. No imported artifact may grant tools, approve work, author trusted evidence, choose oracle truth, merge, or declare success.

## Reconciled Baseline

- `ModeRegistry` already owns immutable built-ins, validated custom modes, role/model intent and explicit Forge tool allowlists.
- `proceduralSkills.ts` already banks and retrieves Forge-authored oracle-verified lessons. Imported skills must remain a separate provenance class and cannot be mislabeled learned success.
- Role capability boundaries, the firewall, human approval, execution contracts, isolated workers, transactions, reviewer gates and oracle-gated success already own deterministic authority.
- The product already has one bottom composer, a mode picker, compact Settings details and native artifact commands. No permanent customization dashboard is needed.
- The repository currently has no product implementation that imports workspace skills, agents, rules or hooks.

Official compatibility references consulted on 2026-07-13:

- [Agent Skills specification](https://agentskills.io/specification) and [client implementation guidance](https://agentskills.io/client-implementation/adding-skills-support): `SKILL.md` frontmatter, progressive disclosure and `.agents/skills/` convention.
- [VS Code customization concepts](https://code.visualstudio.com/docs/copilot/concepts/customization), [custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), and [hooks](https://code.visualstudio.com/docs/agent-customization/hooks).
- [GitHub custom agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) and [instruction locations](https://docs.github.com/en/copilot/reference/custom-instructions-support).
- [Claude skills](https://code.claude.com/docs/en/skills), [subagents](https://code.claude.com/docs/en/sub-agents), and [hooks](https://code.claude.com/docs/en/hooks).

## Selected Import Surface

Workspace discovery is deterministic and bounded:

- Skills: `.agents/skills/*/SKILL.md`, `.github/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`.
- Agents: `.agents/agents/*.md`, `.github/agents/*.md`, `.github/agents/*.agent.md`, `.claude/agents/*.md`.
- Rules: root `AGENTS.md`, root `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `.claude/rules/**/*.md`.
- Hooks: `.github/hooks/*.json`, `.claude/settings.json`, `.claude/settings.local.json`.

User-home customization import is disabled by default and is out of scope for this phase. Workspace discovery rejects symlink/junction escapes, files outside the root, binary content, duplicate identities, malformed frontmatter/JSON, unsupported hook types, and bounded-size/count overflows. A machine-readable report records every accepted, ignored and rejected artifact with source path, digest, reason and effective capability.

## Normalized Contracts

`CustomizationSnapshotV1` contains a canonical aggregate digest plus normalized skill, agent, rule and hook records. Source content is bounded and hashed. Session state stores the snapshot digest and selected customization IDs, not secret values.

### Skills

- Parse the Agent Skills `name`, `description`, optional compatibility/metadata and `allowed-tools` fields.
- Load only catalog metadata at discovery. Load the bounded body only after explicit invocation or deterministic goal/task matching.
- Referenced resources remain ordinary workspace files; scripts never execute automatically and require a normal governed tool proposal.
- `allowed-tools` maps known aliases to Forge tools and intersects the active role/mode ceiling. Unknown tools are reported and ignored; they never create a capability.

### Agents

- Parse supported Markdown/YAML profile fields: name, description, tools, model and body instructions.
- Normalize into imported Forge modes without modifying built-ins. Requested tools intersect the selected Forge role ceiling.
- Profiles with an explicit coding tool list that omits Forge's mandatory planning/testing/diff/evidence/ask/success scaffold are incompatible as coding modes and are rejected or downgraded to a read-only intent; the importer never silently grants requested-missing tools.
- Imported model names are advisory preferences only. Existing host role bindings and confirmed execution contracts remain authoritative.

### Rules

- Always-on and path-scoped Markdown instructions are untrusted context constraints.
- `applyTo` and Claude `paths` globs are parsed and matched deterministically against the active task files/proposal target.
- Rules can narrow expected behavior but cannot alter tool policy, budgets, approval policy, oracle requirements, role ceilings or terminal success.
- Conflicting rules are surfaced in the report and prompt provenance; deterministic Forge policy wins.

### Hooks

- Support command hooks for compatible lifecycle events: session start, pre-tool use, post-tool use and stop. Prompt/agent hooks and remote hook execution are unsupported in this phase.
- Hook commands run with sanitized environment, bounded timeout/output and no merge authority in a disposable isolated workspace. Source-workspace bytes are compared before/after; source mutation is a hard rejection.
- Normalized output may request `deny`, `ask`, `narrow`, or `allow`, plus bounded untrusted context/evidence candidates.
- `deny` blocks. `ask` enters Forge's digest-bound ask/approval path. `narrow` is accepted only when the tool name is unchanged and arguments are demonstrably no broader than the validated proposal. `allow` adds no authority and still proceeds through Forge validation and approval.
- Hook errors, timeout, malformed output, attempted widening, success claims, approvals or trusted-evidence claims fail closed for pre-tool events. Post/stop candidates are recorded but cannot affect oracle truth.

## Authority And Persistence

- Forge's role/mode allowlist, execution contract, firewall, approval policy, transactions, reviewers and oracles remain the upper bound in that order.
- The exact customization snapshot digest is bound to a run. Removing or changing constraints before resume/retry creates contract drift and requires a fresh execution-contract revision/confirmation before provider or mutation work.
- Persist `.forge/customizations.json` for normalized provenance and `.forge/customization-candidates.json` for untrusted hook context/evidence candidates. Neither file is the trusted evidence ledger.
- Native commands refresh and open the report. The existing mode picker may show imported agents; the slash/command surface may expose imported skills. Settings receives one collapsed summary row only.

## Risks And Rollback

- Parser ambiguity: use a structured YAML parser and strict schemas; reject unsupported fields rather than guessing authority.
- Command hooks are executable project code: run only local command hooks, with explicit global enablement defaulting off, sanitized environment, isolation and no source merge.
- Context injection and prompt bloat: cap files/count/body sizes and use progressive disclosure.
- Stale authority: bind the canonical snapshot digest to run state and revalidate on resume/background continuation.
- Cross-platform command behavior: normalize but do not rewrite shell commands; unsupported commands reject honestly.
- Rollback is removal of the compatibility loader wiring and generated `.forge` reports. Imported source files are never modified.

## Acceptance Contract

- Valid skills, agents, rules and hooks from every selected location are discovered with deterministic precedence and provenance.
- Malformed, oversized, duplicate and escaping artifacts reject without provider calls or workspace mutation.
- Imported tool requests can only reduce existing Forge authority.
- Skill bodies use progressive disclosure and never auto-run scripts.
- Rule globs apply only to matching paths and cannot change deterministic policy.
- Hooks causally deny, ask and narrow, while grant/success/approval/trusted-evidence attempts fail closed.
- Hook execution cannot mutate the active workspace and no hook process survives its bound.
- Customization drift invalidates resume/background authority before provider or mutation work.
- Compact Settings/native commands and imported mode/skill discovery work in packaged VS Code and Antigravity without adding a second composer or dashboard.
- No paid provider call is required for phase acceptance.

## Non-Goals

Marketplace/plugin installation, cloud sync, arbitrary remote hooks, automatic script execution, imported MCP authority, unrestricted user-home scanning, editing third-party customization files, a second agent runtime, and treating imported text as proof.

