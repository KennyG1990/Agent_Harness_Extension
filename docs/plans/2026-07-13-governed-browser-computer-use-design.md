# Phase 85: Governed Browser And Computer Use Design

## Problem

Forge currently has `browser_validate`: a one-shot, loopback-only verification oracle that reads a page and captures evidence. It cannot interact with the browser. Forge has no desktop-computer tool. The requested parity requires interaction across browser and applications, but generic screen driving must not bypass the deterministic harness.

## Decision

Add four explicit tools rather than one unrestricted automation escape hatch:

- `browser_inspect`: non-mutating loopback page inspection with bounded accessible elements, URL/title/text, diagnostics, and screenshot.
- `browser_action`: one validated action against a previously inspected browser state (`click`, `fill`, `press`, `select`, `wait`), followed by a fresh inspection and screenshot.
- `computer_inspect`: Windows-only inspection of one user-allowlisted top-level window through Microsoft UI Automation, returning a bounded accessibility tree and target-window screenshot.
- `computer_action`: one UI Automation action (`invoke`, `set_value`, `focus`) against an element from the latest inspected state, followed by fresh evidence.

Microsoft documents UI Automation as the Windows accessibility/test interface for retrieving and interacting with controls. Playwright recommends resilient role/text locators rather than brittle coordinate selectors. Forge will follow those interfaces and avoid raw model-authored scripts or arbitrary SendInput.

## Authority And Approval

- Browser URLs remain loopback-only initially. Remote browsing requires a later explicit domain permission system.
- Computer use is disabled by default and requires native `forge.computerUseEnabled` plus `forge.computerUseAllowedWindows` configuration.
- Both action tools always enter the existing digest-bound human approval gate after schema/firewall validation and before execution.
- Inspect tools do not mutate but may reveal screen content, so computer inspection requires an allowlisted window title and records access evidence.
- The model never supplies JavaScript, PowerShell, XPath, coordinates, process IDs, credentials, or arbitrary accessibility queries.
- Actions reference stable IDs emitted by the latest inspection and bound to session/window/page state; forged, stale, replayed, or cross-target IDs reject.

## Persistence

Write JSON and PNG artifacts under `.forge/browser-sessions/` and `.forge/computer-sessions/`. Each record includes target identity, state digest, action, before/after references, timing, result, approval ID where applicable, and bounded diagnostics. Browser/computer evidence remains distinct from code-oracle evidence and cannot independently declare coding success.

## UX

Do not add browser or desktop panes. Existing activity events narrate inspect/action transitions. The composer globe opens latest browser evidence; a compact monitor icon opens latest computer evidence only after use. Settings expose the disabled-by-default computer policy and allowed-window list.

## Validation

- Browser fixture: inspect, click, fill, submit, resulting DOM/state, screenshot, stale-ID and remote-URL rejection.
- Computer fixture: local purpose-built Windows test window, allowlist, inspect, invoke/set-value, screenshot, stale-ID, wrong-window, disabled-policy, and replay rejection.
- Human approval proof: action pauses before side effect; approval performs exactly one persisted action without another model call; rejection mutates nothing.
- Full extension-host, visual, package/install, and installed Antigravity evidence.

## Non-Goals

No CAPTCHAs, passwords, payments, account creation, arbitrary remote sites, unrestricted keyboard/mouse coordinates, hidden/background credential extraction, OS settings, destructive desktop actions, or generic coding through screen automation when repository-native tools exist.
