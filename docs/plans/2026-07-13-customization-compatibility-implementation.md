# Phase 95 Skills, Agents, Rules, And Hooks Compatibility Implementation Plan

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Implementation Order

1. Add a strict normalized customization schema, canonical digest, bounded workspace discovery and structured Markdown/YAML/JSON parsing.
2. Implement skill catalogs plus progressive body activation and tool-alias intersection.
3. Implement agent-profile normalization into constrained imported Forge modes without changing built-ins or host model authority.
4. Implement always-on/path-scoped rule matching and bounded provenance rendering for the existing context pipeline.
5. Implement disabled-by-default isolated command-hook execution and normalized deny/ask/narrow/context-candidate handling.
6. Bind customization digest and selected IDs into run/background continuity so drift rejects before provider or mutation work.
7. Add native refresh/open commands, one collapsed Settings summary and imported agent/skill entries in existing selectors.
8. Add fixture, extension-host, visual, package/install and actual Antigravity proof; review authority paths; close documents and record AAR.

## Acceptance Evidence

- Focused fixture suite covering every location/format, precedence, parsing, bounds, symlink escape, progressive disclosure, tool intersection, rule globs and hook lifecycle decisions.
- Adversarial fixtures proving hooks cannot grant authority, approve, declare success, author trusted evidence, widen arguments, mutate source or survive timeout.
- Resume/background drift tests proving a changed customization digest stops before provider and mutation work.
- Compile/static regression, applicable harness suites, worker 100/100, extension-host E2E and desktop/sidebar visual smoke.
- Machine-readable `.forge/customizations.json` and untrusted-candidate report inspection.
- Document-closed VSIX content/hash, forced VS Code and Antigravity install, and actual Antigravity interaction with the compact customization surface.

## Planned Recovery

All mutation tests use disposable fixtures and retained baseline hashes. Hook processes run only in disposable isolated roots. Product source changes remain ordinary uncommitted workspace edits; no Git commit/reset/clean/checkout is allowed. If hook isolation or authority intersection cannot be proven, hook execution remains disabled and the phase is marked partial rather than weakening the contract.

## Document Close

PASS. All eight implementation slices landed. Focused causal, contract-drift, background continuity, static regression, 100-worker, extension-host, desktop visual, package/install and actual Antigravity interaction gates passed without provider spend. Review found and fixed persisted digest instability caused by an undefined optional authority field, plus an early-halt stop-hook lifecycle gap.

## Review

- Authority: imported tool requests only narrow; incompatible code agents reject; hook allow output adds no authority.
- Truth: hook evidence remains an untrusted candidate and terminal truth remains oracle/reviewer owned.
- Continuity: customization drift supersedes the old execution contract before provider work and blocks retained background authority.
- Source safety: hooks run in disposable copies; active-source mutations are restored and denied.
- UX: one collapsed Settings section and existing role picker; no dashboard, duplicate composer or nested IDE.

## AAR

- Worked: canonical snapshot binding and reuse of existing mode, isolation, checkpoint and execution-contract primitives.
- Failed: serializing an optional `customizationDigest: undefined` changed the canonical authority shape after JSON persistence and broke detached resume.
- Re-plan: omit absent optional authority properties before hashing; rerun contract and full detached merge/rollback suites.
- Reusable lesson: every digest-bound object must be canonical across in-memory and JSON-round-tripped representations.
- Next boundary: Phase 96 proof graph and signed attestations; imported provenance is available but is not yet cryptographically attested.

Suggested commit title: `Phase 95: add governed workspace customization compatibility`.
