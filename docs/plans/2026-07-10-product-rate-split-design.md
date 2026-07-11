# Phase 59 Product Architect/Editor Rate Split Design

## Reconciled Gap

The shared eval runner has a real architect lane: one planner call produces premise, target, approach, and ordered subtasks; the Qwen executor receives that plan plus focused file contents. The product `/goal` loop does not currently reproduce that mechanism. It routes the `Architect` and `Editor` task owners to separate model bindings, but `PLAN.md` is not part of the Editor prompt and no plan-named files are focused. Generic task completion also marks any search/read as completion, so the Architect can leave without a plan and the Editor can leave without a mutation.

This means the benchmark has proven DeepSeek-plans/Qwen-executes, while the delivered product has only proven role-based model selection. Phase 59 closes that product gap.

## Approaches Considered

1. Reuse the private eval architect lane directly. Rejected because it operates on generated `Tier2Task` fixtures and bypasses product artifacts, reviewer gates, run controls, and normal task state.
2. Add only `PLAN.md` text to the Editor prompt. Better than today, but it does not focus file contents and still allows read-only task completion.
3. Port the mechanics into the product loop. Selected: harness-authored architect handoff, exact focus-file extraction, plan/focus injection through the existing context scheduler, and role-specific completion gates.

## Architecture

When an Architect commits `update_plan`, the harness builds `.forge/architect-handoff.json` from the committed plan. The artifact contains generation time, source task, plan markdown, exact workspace-relative focus files named in the plan, premise lines, and ordered step lines. Extraction is deterministic: only existing workspace files whose exact normalized relative path appears in the plan qualify. Ambiguous basenames do not qualify.

The Architect prompt requires a final `update_plan` with explicit `## Premise Checks`, `## Focus Files`, and `## Ordered Steps` sections. It may search/read first. The Editor prompt receives the committed plan as a required context section and each exact focus file as its own high-priority required section. Full contents are read directly from the workspace and remain subject to Phase 53.1 budgeting/truncation accounting.

Task advancement becomes role-specific. Explorer completes on successful search/read. Architect completes only after `update_plan`. Editor completes only after `apply_patch` or `write_file`. Read/search proposals remain on the same task. Existing Reviewer behavior, oracle gates, evidence, diff review, and terminal success are unchanged.

## Validation

A scripted product-loop provider receives bindings `Architect=deepseek/deepseek-v4-pro` and `Editor=qwen/qwen-2.5-7b-instruct`. Architect must read first, remain active, then write a plan naming `src/math.js`. Editor must receive the plan and full file, read first, remain active, then patch. The fixture must pass tests and terminal success gates. Assertions cover model IDs per role, persisted handoff contents, task progression, focused prompt content, zero fallback, and model-driven accounting. This proves routing/handoff mechanics, not live model capability; live Qwen/DeepSeek remains a separate required gate.

