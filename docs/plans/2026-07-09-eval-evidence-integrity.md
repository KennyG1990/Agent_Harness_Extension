# Evaluation Evidence Integrity Implementation Plan
> **For Agent:** REQUIRED SUB-SKILL: Use `planning` or `brainstorming` if context is missing.

**Goal**: Preserve every Tier-2/3/4 evaluation as an immutable, uniquely addressed run artifact while retaining the existing `latest-*.json` compatibility path.

**Architecture**: `Tier2EvalRunner` will allocate one run identity before task execution. Partial and final writes update both the compatibility report and that run's archive file; later runs may replace `latest` but cannot replace an earlier archive. Reports expose `runId`, `startedAt`, and `archivePath` so console output and downstream tooling can cite durable evidence.

**Tech Stack**: TypeScript, Node.js filesystem APIs, existing Tier-2 shared runner, Node smoke/behavioral tests.

### Task 1: Define durable report identity

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/weakEvalTier2.ts`

**Step 1: Write/verify the failing invariant**
- Extend smoke coverage to require `runId`, `startedAt`, and `archivePath` on `Tier2EvalReport`.
- Require archives under `.forge/evals/runs/tier-<n>/`.
- Command: `npm run test` (expect failure before implementation).

**Step 2: Implement report identity**
- Allocate a filesystem-safe run ID once at the start of `run()`.
- Include tier, live/mock mode, timestamp, and a collision-resistant suffix.
- Pass the same identity through every partial and final `buildReport` call.

**Step 3: Verification**
- Command: `npm run compile` (expect pass).
- Command: `npm run test` (expect pass after implementation).

### Task 2: Dual-write latest and immutable archive

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/src/harness/weakEvalTier2.ts`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/smoke-tests.mjs`

**Step 1: Write/verify the negative-path test**
- Run two small scripted evaluations against one report root.
- Assert `latest` points to the second run.
- Assert both distinct archive files exist.
- Assert the first archive still contains the first run ID and was not replaced by the second run.

**Step 2: Implement dual persistence**
- Keep `reportPath` as the existing latest path.
- Add `archivePath` and write the same partial/final payload to it.
- Create parent directories before each write.

**Step 3: Verification**
- Command: `npm run compile` (expect pass).
- Command: `npm run test` (expect pass).
- Focused Node proof: two runs produce two archives and one latest pointer.

### Task 3: Surface durable evidence from every CLI

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/weak-model-eval-tier2.mjs`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/weak-model-eval-tier3.mjs`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/scripts/weak-model-eval-tier4.mjs`

**Step 1: Implementation**
- Include `runId` and `archivePath` in each CLI summary.

**Step 2: Verification**
- Run mocked Tier-3 architect and mocked Tier-4 architect evaluations.
- Confirm console JSON names a durable archive and both archive files exist.

### Task 4: Close workflow evidence

**Files**:
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/BUILD_LOG.md`
- Modify: `F:/DEV_ENV/projects/Agent_Harness_Extension/HANDOFF_OPUS.md`

**Step 1: Review**
- Check every Phase 58 requirement against implementation and test output.
- Keep live-repeat status open because `OPENROUTER_API_KEY` is not present in the current shell.

**Step 2: Document**
- Record exact commands, outcomes, archive paths, and the credential-limited live gate.
- Bank the AAR lesson: a mutable `latest` path is a convenience pointer, not evidence retention.

**Step 3: Commit**
- No agent commit. The project workflow reserves Git commits for the user.

