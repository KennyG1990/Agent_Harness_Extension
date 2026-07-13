# Phase 89 Stronger Runtime Isolation Design

## Bounded Objective

Replace the current "sanitized child process" claim with explicit, machine-readable isolation grades. Every executable action receives host-classified authority, process/resource ceilings, filesystem boundaries, network policy, and a fail-closed decision before launch. Forge may run unattended only when the required isolation grade is actually available.

## Reconciled Baseline

- Phase 60 classifies obvious command network intent but explicitly is not socket containment.
- Phase 62 forks a sanitized worker, but the child has ambient filesystem and socket authority.
- Phases 65-66 isolate workspace side effects transactionally, but commands can still read outside staging, spawn descendants, exhaust resources, or open unclassified sockets.
- Browser/computer/MCP paths have independent allowlists and approvals; they must not inherit shell authority.
- This Windows host has Node 24 filesystem/child-process permissions, but no Docker/Podman, no usable WSL distribution, and no proven non-elevated socket sandbox. Missing containment must produce `unavailable`/rejection, not a false `sandboxed` label.

## Isolation Grades

- `process`: sanitized environment, bounded output/time/memory, descendant cleanup, no claim of filesystem or socket containment.
- `node-permission`: Node permission flags constrain worker filesystem access to runtime modules plus the isolated workspace; child-process authority is disabled unless the host-selected action requires it.
- `os-sandbox`: a detected backend supplies filesystem/process/network isolation (initial adapters: Linux bubblewrap and Docker/Podman). Backend capability is probed, recorded, and never inferred from configuration alone.
- `strict-unavailable`: the requested command requires socket/kernel containment but no proven backend exists; execution is rejected before spawn.

The effective grade and missing guarantees persist with every execution. `process` and `node-permission` are defense in depth, not aliases for `os-sandbox`.

## Command Authority

Host code classifies commands as `read`, `verify`, `workspace-write`, `network-read`, `network-write`, or `unknown` from tokenized executable/subcommand rules plus the existing network classifier. A model may state an expected authority, but mismatch rejects. Shell composition, redirection, command substitution, interpreters with inline code, and unknown executables widen authority; they never default to read-only.

- Read-only roles may use only `read` and `verify` commands allowed by their role/mode.
- `workspace-write` remains transactional and requires the existing review/approval gates.
- `network-write` stays blocked.
- `network-read` and `unknown` require a proven `os-sandbox` backend for unattended execution; otherwise they pause/reject according to product policy.
- `run_tests` is host-authored `verify`, never model-reclassified.

## Resource Policy

- Worker memory: 384 MiB default, bounded 128-1024 MiB.
- Worker/tool timeout: 30 seconds by default and never above the existing 130-second harness ceiling.
- Output: 2 MiB combined stdout/stderr with deterministic truncation/failure metadata.
- One process group/job tree per request; timeout/cancel kills descendants, then records cleanup status.
- Maximum spawned-process depth/count is backend-enforced when supported and otherwise reported as unavailable.

## Evidence

Persist `.forge/runtime-isolation.json` with backend probe results and bounded execution records: authority, requested/effective grade, filesystem/network/child-process guarantees, limits, PID, duration, exit/signal, output truncation, timeout, descendant cleanup, rejection reason, and backend probe timestamp. Secrets, raw environment values, active staging roots, and full command output are excluded.

## Acceptance Criteria

- Authority mismatch, shell-composition downgrade, unknown executable, network write, and strict-backend-unavailable reject before execution.
- A native edit worker cannot read outside its isolated workspace through Node APIs and cannot spawn children.
- Time, memory, output, and descendant-process fixtures terminate within bounds and leave no child alive.
- A loopback socket-bypass fixture is denied by a real OS backend when available; when absent, strict execution rejects before launch and records `strict-unavailable`.
- Transactional command workspace writes still merge/rollback exactly as Phase 66 specifies.
- Browser, computer-use, and MCP retain separate policies and cannot borrow `run_command` authority.
- Product UI adds no permanent panel; native artifact command plus one compact status is sufficient.

## Non-Goals

- Forge does not install Docker, alter Windows Firewall, enable optional Windows features, or require administrator rights.
- Intent classification is not presented as socket isolation.
- A missing backend is not silently downgraded for unattended network or unknown commands.
- This phase does not add remote MCP; it only establishes the isolation prerequisite and evidence needed to evaluate it later.

## Rollback

Runtime isolation is injected behind worker and command dispatch interfaces. If a backend adapter fails its probe, it is disabled and strict requests fail closed. Removing the new dispatcher returns to Phase 88 behavior without changing persisted run semantics, but releases must not claim Phase 89 after rollback.
