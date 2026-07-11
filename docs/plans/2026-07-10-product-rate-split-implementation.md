# Product Architect/Editor Rate Split Implementation Plan
> **For Agent:** REQUIRED SUB-SKILL: Use `planning` or `brainstorming` if context is missing.

**Goal**: Make the installed `/goal` loop execute a stronger Architect's plan through a cheaper Editor with deterministic handoff, focused context, and role-correct task progression.

**Architecture**: Architect `update_plan` commits produce a harness-authored handoff artifact. Editor prompts include the plan and exact plan-named files through the existing context scheduler. Role-specific completion rules prevent inspection from masquerading as planning or editing.

**Tech Stack**: TypeScript, existing `AgentHarnessLoop`, Phase 53.1 context scheduler, filesystem artifacts, existing host/E2E tests.

### Task 1: Define and persist architect handoff

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/types.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/loop.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/smoke-tests.mjs`

**Step 1: Failing invariants**
- Require `ArchitectHandoff`, exact focus extraction, and `.forge/architect-handoff.json` persistence.
- Command: `npm run test` (expect failure).

**Step 2: Implementation**
- Parse exact existing relative paths, premise lines, and ordered steps from committed plan markdown.
- Persist artifact on every Architect `update_plan`.

**Step 3: Verification**
- Compile and smoke.
- Negative proof: ambiguous/nonexistent plan paths do not enter focus files.

### Task 2: Inject plan and focus files into Editor prompt

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/loop.ts`

**Step 1: Implementation**
- Require structured Architect plan headings in Architect guidance.
- Add required Editor plan and per-focus-file sections to Phase 53.1 scheduling.
- Preserve prompt-budget accounting.

**Step 2: Verification**
- Capture Editor provider prompt and assert plan, exact focus path, and current file contents are present.

### Task 3: Enforce role-specific completion

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/loop.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/test/suite/index.ts`

**Step 1: Failing behavior proof**
- Architect read must keep Architect task running.
- Editor read must keep Editor task running.

**Step 2: Implementation**
- Replace generic progress completion with an owner/proposal completion policy.
- Architect completes on `update_plan`; Editor on successful file mutation.

**Step 3: Verification**
- Causal scripted end-to-end product loop with distinct planner/executor model IDs.

### Task 4: Full workflow close

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/BUILD_LOG.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/HANDOFF_OPUS.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/package.json`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/package-lock.json`

**Verification commands**:
- `npm run compile`
- `npm run test`
- mocked Tier-3 architect
- mocked Tier-4 architect
- `npm run test:e2e`
- `npm run test:visual`
- `npm run package`
- install/list/compiled-marker checks in Antigravity

No agent Git commit; project commits remain user-owned.

