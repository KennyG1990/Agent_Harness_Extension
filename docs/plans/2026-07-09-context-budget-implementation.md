# Context Budget Scheduler Implementation Plan
> **For Agent:** REQUIRED SUB-SKILL: Use `planning` or `brainstorming` if context is missing.

**Goal**: Make main-loop prompt compaction real and measurable so long Qwen 7B runs stay inside a deterministic working-context budget while retaining goal and open-task state.

**Architecture**: A pure scheduler builds the prompt from named priority sections. Full details stay in filesystem artifacts; prompt-only clearing removes stale output first and writes accounting into `ContextBundle` and `RunStats`.

**Tech Stack**: TypeScript, Node.js, existing `AgentHarnessLoop`, existing artifact persistence and smoke/E2E framework.

### Task 1: Add a pure context scheduler

**Files**:
- Create: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/contextBudget.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/smoke-tests.mjs`

**Step 1: Write failing invariants**
- Require a scheduler export, hard budget enforcement, required-section handling, and explicit cleared/truncated accounting.
- Command: `npm run test` (expect failure).

**Step 2: Implement**
- Add section/result types and `assemblePromptWithinBudget`.
- Clamp invalid budgets and preserve deterministic ordering.

**Step 3: Verify**
- Command: `npm run compile`.
- Focused Node proof with oversized optional sections.

### Task 2: Integrate scheduling into the product prompt

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/loop.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/types.ts`

**Step 1: Write failing invariants**
- Require actual prompt chars/tokens, budget, included/cleared/truncated sections, dropped chars, and compaction reason in `ContextBundle`.
- Require `contextCompactions` and `toolResultSectionsCleared` in `RunStats`.

**Step 2: Implement**
- Replace monolithic prompt interpolation with named sections.
- Protect goal/task/role/tool/open-task sections.
- Clear scratchpad/log/reflection/escalation sections before high-priority state.
- Persist accounting on the existing bundle.

**Step 3: Verify**
- Command: `npm run compile`.
- Command: `npm run test`.

### Task 3: Prove the long-context behavior

**Files**:
- Modify only if a reusable fixture is required: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/test/suite/index.ts`

**Step 1: Oversized prompt negative path**
- Construct state with large stale log/scratch/reflection output.
- Assert every emitted system prompt is at or below budget.
- Assert goal and open task remain.
- Assert stale output is absent and named in `clearedSections`.

**Step 2: Completion path**
- Use a scripted provider that rejects over-budget prompts and otherwise drives a disposable fixture to green evidence.
- Assert terminal success and persisted context accounting.

### Task 4: Full workflow close

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/BUILD_LOG.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/HANDOFF_OPUS.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/package.json`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/package-lock.json`

**Step 1: Regression gates**
- `npm run compile`
- `npm run test`
- mocked Tier-3 architect
- mocked Tier-4 architect
- `npm run test:e2e`
- `npm run test:visual`
- `npm run package`

**Step 2: Review and document**
- Review every design requirement against code and output.
- Record any unavailable live-model gate as missing; do not infer uplift from deterministic proofs.
- No agent Git commit; commits remain user-owned under the project workflow.

