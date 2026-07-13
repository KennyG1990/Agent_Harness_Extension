# Phase 84: Indexed @File And @Folder Mentions Implementation Plan

> **For Agent:** Follow PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE.

**Goal:** Let users attach indexed files and folders directly while writing a task through familiar `@` mentions.

**Architecture:** The host searches validated index metadata and captures selections through the existing deterministic context service. React owns only transient query/navigation state and renders metadata suggestions.

### Task 1: Context And Search Domain

**Files:**
- Modify `src/harness/composerContext.ts`
- Modify `src/harness/workspaceIndex.ts`
- Modify `src/harness/types.ts`

Add folder-manifest attachments and deterministic bounded candidate search.

### Task 2: Host Bridge

**Files:**
- Modify `src/extension.ts`
- Modify `src/harness/sessionStore.ts`

Add mention-search and attach-selection commands. Revalidate paths and publish metadata-only results.

### Task 3: Composer Interaction

**Files:**
- Modify `src/webview/src/App.tsx`
- Modify `src/webview/src/types.ts`

Add token-boundary parsing, result rendering, keyboard/mouse selection, and revised placeholder copy.

### Task 4: Proof And Delivery

**Files:**
- Modify `scripts/composer-context-smoke.mjs`
- Modify `scripts/smoke-tests.mjs`
- Modify `scripts/visual-smoke.mjs`
- Modify `src/test/suite/index.ts`
- Modify `package.json`, `package-lock.json`
- Update `BUILD_LOG.md`, `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`, `HANDOFF_OPUS.md`

Run focused/context/static/host/visual/release/package/install gates and capture the installed mention UI in Antigravity.
