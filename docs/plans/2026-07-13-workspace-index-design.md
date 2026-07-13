# Deterministic Workspace Index Design

## Goal

Turn the cosmetic composer database icon into a real host-owned repository index that improves weak-model navigation beyond the current 250-file search ceiling.

## Contract

`WorkspaceIndexService` scans at most 5,000 contained text/source files without following symlinks. It excludes dependency, build, cache, Git, Forge, test-runtime, and screenshot directories. Each record contains only workspace-relative path, byte size, modification time, language, and at most 40 bounded declaration records. Source bodies are never serialized.

The service writes `.forge/workspace-index.json` atomically with schema version, workspace hash, status, generated time, file/symbol counts, truncation flags, ignored count, and a deterministic fingerprint. A corrupt, mismatched, or path-escaping index is rejected and rebuilt rather than trusted.

`repo_search` uses validated indexed paths for bounded content search and reports how many files were examined. `symbol_search` uses indexed declaration metadata first. Both preserve direct-scan fallback when no valid index exists.

## Staleness

The extension host owns status: `missing`, `building`, `ready`, `stale`, or `error`. Workspace file create/change/delete events mark a ready index stale without silently rebuilding. The user explicitly refreshes from the composer popover. A stale index remains usable with disclosed provenance because its validated paths are still bounded by current workspace containment.

## UX

The existing database icon opens one compact popover showing state, file/symbol counts, generated time, truncation, `Refresh`, and `Open index`. No permanent panel or cloned file tree is introduced. Building and error states are explicit. The icon color reflects ready/stale/error.

## Proof

- A fixture with more than 250 files finds a target beyond the old limit.
- Symlinks, binaries, dependencies, build output, `.forge`, and path escapes never enter the index.
- Corrupt and cross-workspace artifacts reject.
- Symbol search returns indexed declarations.
- File events mark status stale; refresh restores ready.
- Desktop/sidebar screenshots keep the popover and composer visible.

