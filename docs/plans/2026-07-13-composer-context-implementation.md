# Phase 83: Host-Owned Composer Context Implementation Plan

> **For Agent:** Follow PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE.

**Goal:** Make task entry explicit by attaching trusted workspace context to chat and agent runs without adding a cloned file surface.

**Architecture:** A new deterministic context service validates and persists bounded snapshots. The extension host exposes intent-only webview commands and injects validated snapshots into chat and harness initialization. React renders only metadata and invokes native host selection.

**Tech Stack:** TypeScript, VS Code extension API, React webview, Node filesystem APIs, existing Forge session and prompt-budget infrastructure.

### Task 1: Context Domain And Store

**Files:**
- Create `src/harness/composerContext.ts`
- Modify `src/harness/sessionStore.ts`
- Modify `src/harness/types.ts`

1. Define bounded attachment metadata/content schemas.
2. Validate real workspace containment, regular files, symlinks, text content, limits, and persisted identity.
3. Save/load `context.json` atomically with each session.
4. Add a deterministic smoke test for valid and adversarial paths.

### Task 2: Host Capture And Injection

**Files:**
- Modify `src/extension.ts`
- Modify `src/harness/loop.ts`

1. Add host commands for active editor/selection, native file Quick Pick, diagnostics, remove, and clear.
2. Create a chat session before first capture when necessary.
3. Publish metadata-only attachment state to the webview.
4. Inject bounded context into chat and snapshot it into new harness runs.
5. Include run context as a required prompt-budget section and persist it with state.

### Task 3: Compact Composer UX

**Files:**
- Modify `src/webview/src/types.ts`
- Modify `src/webview/src/App.tsx`

1. Add one context icon and compact action popover.
2. Render removable attachment chips above the composer.
3. Restore attachments when sessions load.
4. Keep desktop and 520px layouts free of overlap.

### Task 4: Validation And Delivery

**Files:**
- Create `scripts/composer-context-smoke.mjs`
- Modify `scripts/smoke-tests.mjs`
- Modify `scripts/visual-smoke.mjs`
- Modify `src/test/suite/index.ts`
- Modify `package.json`
- Modify `BUILD_LOG.md`
- Modify `RESEARCH_IMPLEMENTATION_GAP_ANALYSIS.md`
- Modify `HANDOFF_OPUS.md`

1. Run focused context tests and extension-host tests.
2. Run compile, static invariants, release matrix, and diff checks.
3. Capture and inspect desktop/sidebar screenshots.
4. Package and force-install the VSIX into Antigravity.
5. Capture installed-product evidence and record honest remaining boundaries.
