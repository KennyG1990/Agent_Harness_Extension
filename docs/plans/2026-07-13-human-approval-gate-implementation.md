# Human Approval Gate Implementation Plan

> **For Agent:** Preserve the exact `PROPOSE -> VALIDATE -> COMMIT -> NARRATE` ordering and prove every negative boundary.

**Goal:** Make the composer approval shield authoritative, persistent, and low-friction.

**Architecture:** The harness persists and resolves exact validated proposals. The extension host owns policy and decision commands. The React webview renders state and sends only policy/decision intent.

### Task 1: State and harness boundary

**Files:** `src/harness/types.ts`, `src/harness/loop.ts`

1. Add approval policy, pending approval, history, progress kinds, and counters.
2. Gate consequential actions after pre-commit review and before COMMIT.
3. Add host-callable decision resolution with ID/digest/task validation.
4. Reuse one commit continuation for automatic and approved paths.
5. Persist approval evidence under `.forge/human-approvals.json`.

### Task 2: Host authority

**Files:** `src/extension.ts`, `package.json`

1. Add native `forge.humanApprovalPolicy` configuration.
2. Publish policy to the webview and accept bounded policy requests.
3. Resolve decisions against `latestState`; never trust webview state or proposals.
4. Stop autonomous loops at `awaiting_approval` and resume after approval.

### Task 3: Compact UX

**Files:** `src/webview/src/App.tsx`, `src/webview/src/types.ts`

1. Replace local `autoApprove` state with host-published policy.
2. Show active policy in the shield tooltip and selected styling.
3. Render one pending approval card in chat with Approve and Reject.
4. Keep the composer layout usable at narrow sidebar width.

### Task 4: Proof and delivery

**Files:** `src/test/suite/index.ts`, `scripts/smoke-tests.mjs`, `scripts/visual-smoke.mjs`, release documentation

1. Add causal harness tests for pause, approve, reject, replay, forged ID, and auto/firewall behavior.
2. Add extension-host authority tests.
3. Capture and inspect desktop/sidebar screenshots.
4. Run compile, static, targeted, extension-host, visual, package, diff, and install gates.

