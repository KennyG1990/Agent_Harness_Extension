# Phase 85: Governed Browser And Computer Use Implementation Plan

> **For Agent:** Implement in causal slices; browser session first, Windows UI Automation broker second.

**Goal:** Give Forge real browser and desktop interaction while preserving deterministic validation, explicit approval, evidence, and host-native UX.

### Task 1: Browser Session State

Create `src/harness/browserUse.ts`. Persist bounded page states and stable role/text-derived targets. Add inspect/action schema and loopback policy.

### Task 2: Browser Harness Integration

Add `browser_inspect` and `browser_action` to types, schemas, firewall, mode registry, role capabilities, worker tools, progress, approval, and artifacts. Prove one-action approval and stale-target rejection.

### Task 3: Windows Computer Broker

Create `src/harness/computerUse.ts` and a packaged Windows UI Automation worker. Add disabled-by-default native settings and allowlisted exact/substr window titles. Persist bounded UIA tree, target-window screenshot, and state digest.

### Task 4: Computer Harness Integration

Add `computer_inspect` and `computer_action`; action always uses digest-bound human approval. Reject unsupported OS, disabled policy, unlisted windows, stale/cross-window targets, unsupported patterns, replay, and sensitive action categories.

### Task 5: UX And Proof

Use existing activity/approval UI; add only latest-evidence access and collapsed settings. Run purpose-built browser and Windows fixtures, extension-host tests, screenshots, package/install, and update all project records.
