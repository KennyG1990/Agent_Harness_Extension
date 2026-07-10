# Phase 53.1 Context Budget Design

## Decision

Forge will add deterministic prompt budgeting before model-written compaction or semantic embeddings. Full run history remains on disk in `SCRATCHPAD.md`, `.forge/state.json`, ledgers, and session artifacts. The provider receives a bounded working set assembled by priority.

This is the first Phase 53 slice because the current `compacted` field is observational only: it becomes true after scratchpad/file thresholds but does not alter prompt content. The current `tokenEstimate` also omits the tool contract, role handoff, logs, reflections, and escalation sections, so it cannot enforce a context limit.

## Alternatives Considered

1. Model-written compaction at 90-92% of the window. This matches the research end state, but adds cost, another failure mode, and a summary-quality variable before deterministic budgeting exists.
2. Embedding/semantic retrieval first. This may improve file ranking, but does not prevent stale logs and tool results from consuming the prompt. It also requires an embedding provider/index lifecycle and a keyword-versus-semantic A/B.
3. Deterministic budget scheduler first. This is selected. It is provider-independent, measurable, negative-path testable, and preserves the harness law that deterministic code decides what enters the working context.

## Architecture

A pure `assemblePromptWithinBudget` function accepts named prompt sections with priority and required/optional status. It returns bounded text plus included, cleared, and truncated section IDs, dropped characters, and an estimated token count. Required sections are admitted first and truncated only if they alone exceed the hard budget. Optional sections are then admitted in priority order; sections that do not fit are cleared from the prompt but remain available in filesystem artifacts.

The main loop supplies sections for identity/goal/task, role handoff, tool contract, task guidance, known files, retrieval candidates, open tasks, scratchpad summary, recent logs, reflections, whole-file recovery guidance, and escalations. Goal, active task, role/tool contract, task guidance, and open task state are required. Stale logs, scratchpad, reflections, and escalations are the first clearing candidates.

The resulting accounting is persisted in `ContextBundle`: prompt character budget, actual prompt characters, prompt token estimate, included sections, cleared sections, truncated sections, dropped characters, and compaction reason. `RunStats` counts context compactions and cleared tool-result sections. No disk artifact is deleted or shortened.

## Error Handling

The scheduler must always return text at or below its configured character budget. Invalid or tiny budgets are clamped to a safe minimum. If required content alone exceeds the budget, deterministic truncation markers name the affected section and point to filesystem memory. Optional content is never partially and silently cut: it is either included, explicitly truncated with a marker, or listed as cleared.

## Validation

- Unit/behavioral proof: oversized optional tool/log sections produce prompt text within budget and are listed as cleared.
- Negative proof: required goal and open-task sections remain present after compaction.
- Long-loop proof: a provider that rejects oversized prompts completes a fixture only when scheduling keeps every proposal prompt within budget.
- Persistence proof: `.forge/context-bundle.json` records actual prompt accounting and compaction reason.
- Regression gates: compile, smoke, E2E, visual, package, and existing mocked Tier-3/Tier-4 evaluations.

