# Phase 89 Stronger Runtime Isolation Implementation Plan

> **For Agent:** Follow `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR` for every batch.

**Goal:** Make process, filesystem, resource, child-process, and network isolation explicit and fail closed whenever the required backend is unavailable.

**Architecture:** A deterministic `RuntimeIsolationManager` classifies command authority, probes available backends, selects the minimum sufficient isolation grade, builds bounded launch specifications, and records sanitized evidence. `ProcessWorkerExecutor` and transactional commands consume those specs; models cannot choose or weaken them.

**Tech Stack:** TypeScript, Node 24 permission flags and process APIs, optional bubblewrap/Docker/Podman adapters, existing transactional workspaces, VS Code native artifacts.

## Task 1 - Authority Classifier And Policy

**Files:** create `src/harness/runtimeIsolation.ts`; modify `src/harness/commandNetwork.ts`, `src/harness/firewall.ts`, `src/harness/types.ts`.

1. Add authority/isolation/backend/limit/evidence types.
2. Tokenize bounded command forms and classify host authority; reject mismatch and downgrade attempts.
3. Require proven OS sandbox for unattended `network-read`/`unknown`; retain unconditional `network-write` denial.
4. Add adversarial fixtures for separators, redirects, inline interpreters, alternate download tools, and encoded PowerShell.

Gate: focused policy test proves every bypass rejects before spawn and ordinary read/verify commands retain correct authority.

## Task 2 - Worker Permission And Resource Cage

**Files:** modify `src/harness/workerExecutor.ts`, `src/harness/workerHost.ts`, runtime asset copy/bundle tests.

1. Launch non-command native workers with Node permission flags limited to runtime modules and isolated workspace.
2. Deny child-process authority for file/retrieval workers.
3. Add memory, timeout, output, and process-tree cleanup limits with explicit metadata.
4. Prove outside-read, child-spawn, output flood, timeout, and memory-pressure negatives.

Gate: no fixture escapes the workspace or leaves a descendant alive; every limit is recorded.

## Task 3 - Sandboxed Command Dispatcher

**Files:** modify `src/harness/tools.ts`, `src/harness/transactionalCommands.ts`; create backend wrapper/runtime assets only as needed.

1. Probe bubblewrap and Docker/Podman without network or installation side effects.
2. Build exact argv, mounts, environment, process, and network policy for available backends.
3. Keep workspace-write commands inside Phase 66 staging and merge only bounded changes.
4. Reject strict requests before spawn when no backend proves the required guarantees.

Gate: backend argv tests, unavailable-backend negative, transactional merge/rollback regression, and real backend socket/filesystem bypass test when capability exists.

## Task 4 - Evidence And Product Surface

**Files:** modify `src/harness/loop.ts`, `src/extension.ts`, `src/webview/src/App.tsx`, `package.json`.

1. Persist `.forge/runtime-isolation.json` and reconcile counters into run state.
2. Add `Forge Agent: Open Runtime Isolation Report`.
3. Expose only compact backend/grade status in existing collapsed settings/proof UI.
4. Never send paths, environment values, or raw backend diagnostics to the webview.

Gate: native artifact opens; webview receives sanitized summary only; no new dashboard.

## Task 5 - Release Validation

1. Run focused bypass/resource/process-tree tests.
2. Run compile, static, all no-spend regressions, worker 100/100, MCP, browser/computer, sub-agent, visual, and extension-host E2E.
3. Review every claimed guarantee against evidence and mark unavailable capabilities honestly.
4. Bump to `0.89.0`, package, inspect, install in VS Code and Antigravity, and interact with actual Antigravity.
5. Close ROADMAP, gap analysis, handoff, BUILD_LOG, plans, and AAR.

No paid provider call and no administrator-level system change is authorized by this plan.

## Document Close - PASS

- Tasks 1-4 implemented: deterministic authority classification, pre-spawn downgrade rejection, Node permission-caged native workers, child denial, bounded memory/output/time/process trees, optional backend probes, strict-unavailable command rejection, sanitized evidence, and native report command.
- Task 5 validated: focused isolation, static, worker 100/100, persistent sub-agent, MCP, browser/computer, conversation, visual, and compiled extension-host suites pass without a paid provider call.
- Release artifact: `forge-agent-0.89.0.vsix`, 54 runtime paths, 3,102,603 bytes, SHA-256 `A72FBE24F9905F9C11808D069F1919289AC76CE6428E84FDB11AB611505D84BD`.
- VS Code and Antigravity install and list `kennyg.forge-agent@0.89.0`. Actual Antigravity exposes and invokes the runtime-isolation report command after reload.
- Unavailable guarantee: no socket-isolating backend is proven on this host. Unknown/network-read commands fail closed; process-grade local verification is not represented as socket containment.

## AAR

- Sustain: host-owned authority, explicit isolation grades, fail-closed strict requirements, standalone packaged worker runtime, descendant cleanup, and evidence that states effective guarantees rather than intent.
- Improve: the first VSIX accidentally included `.kilo/node_modules`, expanding to 12.19 MB and 2,648 files. Recursive `**/node_modules/**` packaging exclusions now prevent nested dependency leakage; future package review must inspect both count and contents before install.
- Improve: compiled E2E initially retained stale assertions and exposed that generic worker execution could not run deterministic `get_diff` under child denial. Compile before E2E and keep trusted coordinator-only operations outside restricted model workers.
- Improve: the first Antigravity install attempt targeted the separate hub binary. Use `C:\Users\Moshi\AppData\Local\Programs\Antigravity IDE\bin\antigravity-ide.cmd`, not `...\Programs\antigravity\Antigravity.exe`.
- Performance signal: E2E passed in 247.9 seconds but briefly triggered an unresponsive/profile warning. Phase 90 should reduce prompt/context and extension-host load before raising concurrency.
