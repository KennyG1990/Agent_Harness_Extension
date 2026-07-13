# Deterministic Workspace Index Implementation Plan

> **For Agent:** Preserve workspace containment and bounded output; do not serialize source bodies.

**Goal:** Build a real repository index, consume it in search tools, and expose it through the existing composer icon.

### Task 1: Index service

**Files:** `src/harness/workspaceIndex.ts`

1. Define report/status/entry schemas and exclusion policy.
2. Implement bounded no-symlink scanning and declaration extraction.
3. Implement atomic persistence and strict load validation.
4. Add status and stale marker behavior.

### Task 2: Tool integration

**Files:** `src/harness/tools.ts`

1. Prefer valid indexed paths in `repo_search`.
2. Prefer indexed declarations in `symbol_search`.
3. Preserve direct bounded fallback and report provenance/coverage.

### Task 3: Extension and compact UI

**Files:** `src/extension.ts`, `src/webview/src/App.tsx`, `src/webview/src/types.ts`, `package.json`

1. Add build/status/open commands and webview messages.
2. Add workspace watcher-driven stale status.
3. Replace cosmetic click behavior with a compact popover.
4. Keep the existing icon and avoid a permanent panel.

### Task 4: Validation and delivery

**Files:** test scripts, extension-host suite, visual smoke, release documentation

1. Add >250-file causal search and adversarial index tests.
2. Verify commands and stale/refresh behavior in extension host.
3. Capture desktop/sidebar popover screenshots and inspect pixels.
4. Run release gates, package `0.82.0`, install, and inspect installed markers/UI.

