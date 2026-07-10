# PHASE 55 — FORGE STUDIO UI: SESSIONS, MEMORY, AND THE RIGHT RAIL
Design spec (documented before build, per workflow). Model: the Claude desktop layout the user screenshotted — left rail (sessions), center (conversation/run), right rail (live progress + context). Core insight: EVERY panel below maps to state Forge already persists. This is surfacing, not inventing. Validation protocol: every slice closes ◐ until a screenshot of the live panel exercises it (user or screen-enabled session flips to ✅).

## 1. STORAGE FOUNDATION (build first — everything else reads it)
Today `.forge/state.json` is a singleton overwritten per run → zero session history. Change to:
```
.forge/sessions/<sessionId>/state.json        (full HarnessState, already session-keyed)
.forge/sessions/<sessionId>/meta.json         { title, createdAt, updatedAt, pinned, goal, status, costUsd, steps, tags }
.forge/sessions/<sessionId>/chat.json         [{ role, content, ts }] — chat messages (currently NEVER persisted)
.forge/sessions/index.json                    ordered list of { sessionId, title, pinned, updatedAt, status } for fast rail render
.forge/state.json                             kept as symlink-like copy of ACTIVE session (backcompat: resumeFromDisk, artifact paths)
```
- persistStateToDisk writes both locations (active copy + session dir). Migration: on first load, wrap an existing bare state.json into a session dir.
- CONTEXTUAL NAMING (deterministic first, model-polish optional): title = first 60 chars of goalContract.goal cleaned of `/goal` syntax; after terminal state, optionally one cheap model call ("5-word title for: <goal + haltReason>") — firewalled: title is cosmetic, never truth. Store both `title` and `autoTitle`.
- MEMORY: this is where Phase 37 pays off — lessons.json + aar.json + repository-knowledge.json ARE the memory store. Add `.forge/memory.json`: harness-authored rollup { lessonsCount, topLessons[5], lastAAR summary, knownCommands } refreshed at terminal states. The model never writes it; the harness compiles it (our law).

## 2. LAYOUT (webview restructure: 3 columns, collapsible rails)
LEFT RAIL — Sessions:
- "+ New session" (fresh sessionId; archives current active).
- Pinned section (meta.pinned, right-click/star to pin).
- Recents (index.json order, contextual titles, status dot: green success / yellow paused-idle / red failed / spinner running).
- Click = load that session: chat.json into the thread, state.json into run console (resume banner if non-terminal: wires EXISTING resumeFromDisk).
CENTER — existing chat/run console, unchanged this phase except: renders loaded session chat history; "Resume last run" banner when active session is paused/mid-run.
RIGHT RAIL — the live context panel (the ask's centerpiece), all read from current HarnessState + workspace:
- PROGRESS: taskGraph.tasks as checklist — completed tasks get line-through + check (data already flows in state-update messages; purely presentational), running task gets spinner, failed gets red X. Counter "N of M" like Claude's "27 of 27".
- STEERING: the Phase 54 pause/resume buttons move here + current step/maxSteps + budget spend vs cap (runBudget) as a thin progress bar.
- CONTEXT / DOCUMENTS: state.files keys (files the agent has read — clickable, opens via existing 'open-file' bridge) + contextBundle.retrievalCandidates (dimmed, "candidates").
- MEMORY: recentLessons from contextBundle (already injected into prompts — show the user what the harness remembers) + link to lessons.json artifact.
- CONNECTORS: provider status (OpenRouter key set? model bindings per role; architect model if configured) + oracle availability (tests/lint/typecheck detected in workspace) — Forge's honest equivalent of a connectors list.
- EXTENSIONS/CAPABILITIES: static list of enabled harness capabilities with live counters from runStats (firewall validations, reflections, path repairs, whole-file recoveries, lessons banked) — the gradient of assistance, visible.
- ARTIFACTS: existing openArtifact links (plan, evidence, AAR, scorecards) grouped here instead of buried.

## 3. BRIDGE ADDITIONS (extension.ts)
`list-sessions` (read index.json) · `load-session {id}` (returns meta+chat+state; sets active) · `new-session` · `pin-session {id,pinned}` · `rename-session {id,title}` · `save-chat {id, messages}` (called by webview on each exchange) · `delete-session {id}` (moves to .forge/sessions/.trash/, never hard-deletes). All deterministic file ops; smoke asserts for each.

## 4. BUILD ORDER (each slice = one workflow pass; UI slices close ◐ pending screenshot)
55.1 Storage foundation + session bridge (sandbox-provable: behavioral tests on session CRUD, migration, naming, active-copy backcompat with resumeFromDisk).
55.2 Left rail (sessions list, pin, new, load-with-resume-banner).
55.3 Right rail: PROGRESS checklist + steering block (highest visible payoff; taskGraph already streams).
55.4 Right rail: context/memory/connectors/capabilities/artifacts groups.
55.5 Chat persistence + restore; contextual auto-titling (deterministic; model polish behind a setting).
55.6 Polish: status dots, "N of M", collapse states persisted to localStorage-equivalent (webview state API — NOT localStorage; VS Code webviews use vscode.getState/setState).

## 5. GUARDRAILS (do not violate)
- The right rail renders STATE, never model claims — every number traces to HarnessState/runStats/artifacts.
- Titles are cosmetic; sessionId is identity. No model output ever becomes a file path.
- Session storage stays inside .forge/ (workspace-contained, firewall-consistent). Trash, never hard-delete.
- Webview tsx has no sandbox typecheck (known gap) — add vitest or tsc --noEmit for src/webview in 55.1 so later slices get static gates.
- Keep the panel compact-first: rails collapse; the blueprint's "artifact-first, not IDE-clone" law still applies.
