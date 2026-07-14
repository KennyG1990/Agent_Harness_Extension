# Phase 97 Oracle Calibration Design

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Objective

Measure whether Forge's selected test oracle detects bounded, semantics-changing source mutations before Audited assurance may rely on it. Calibration is deterministic verification of oracle sensitivity, not model evaluation and not a substitute for green run evidence.

## Reconciled Foundations

- `VerificationOracles` and project adapters already own deterministic test-command selection and composite truth.
- `prepareIsolatedWorkspace(..., 'copy')` creates a disposable source copy without mutating the active workspace.
- Execution contracts already fail Audited closed when `oracleCalibration` is unavailable.
- Phase 96 proof graphs and signatures report existing facts; calibration must become another host-owned fact and cannot be inferred from signing.

## Calibration Contract

`OracleCalibrationReportV1` is generated only by the extension host or the focused CLI runner.

- Supported initial ecosystem: Node projects with a configured test command. Unsupported ecosystems fail closed instead of using guessed mutation rules.
- Baseline test oracle must pass before mutation and after all mutations are restored.
- Candidate files are bounded regular non-symlink JavaScript/TypeScript source files. Test/spec/snapshot/config/generated/dependency paths are excluded.
- A lexical scanner skips comments and string/template bodies, then emits only syntax-preserving token substitutions: boolean literals, strict/loose equality, relational boundaries, and boolean conjunction/disjunction.
- Each mutant changes one token in the disposable copy, runs the exact selected test command under bounded time/output, records killed/survived/error state without source or raw output, then restores exact bytes.
- Tests are never mutated. The active workspace is hashed before and after and any byte drift invalidates the report.
- Audited floor: at least five applied mutants and sensitivity `killed / applied >= 0.80`. User configuration may raise but never lower this floor.
- Report validity binds adapter fingerprint, exact test command, test-suite/config digest, mutation-policy version, floor and immutable report digest. Test/config changes make prior calibration stale; ordinary source edits do not silently rewrite calibration history.

## Artifacts And UX

- Latest report: `.forge/oracle-calibration.json`.
- Immutable archive: `.forge/calibrations/<calibration-id>.json` written with exclusive creation.
- Native commands: run, inspect status and open report.
- Existing collapsed Proof integrity disclosure gains one calibration status row/action. No second composer or permanent dashboard.

## Authority

- Calibration cannot modify tests, active workspace, execution contracts, evidence ledgers, terminal status, attestations or merge decisions.
- A report below the floor remains useful diagnostic evidence but does not make Audited available.
- Audited availability and terminal gates revalidate the report against the current adapter and test-suite digest. UI state cannot claim calibration.

## Risks And Recovery

- False kills from syntax errors: operators are syntax preserving; scanner excludes strings/comments; baseline is rerun after restoration.
- Flaky tests: a red final baseline invalidates the complete calibration rather than counting kills.
- Test mutation: path classification, pre/post test hashes and active-workspace snapshots fail closed.
- Oversized repos: bounded scans report unsupported/truncated instead of partial confidence.
- Cleanup failure: invalid report plus retained disposable path for diagnosis; no source merge exists.

## Non-Goals

- No claim of exhaustive mutation testing, test quality certification, coverage measurement or correctness proof.
- No Python/Rust/Go calibration until language-specific deterministic operators and fixtures exist.
- No provider call and no model-authored mutations.
- No weakening of the existing composite oracle, review, evidence or signature gates.
