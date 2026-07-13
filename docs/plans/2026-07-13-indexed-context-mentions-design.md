# Phase 84: Indexed @File And @Folder Mentions Design

## Problem

Phase 83 made context attachment real, but discovery still requires opening a Paperclip menu and then a native picker. The research gap list explicitly requires `@file / @folder` mentions in the composer. Kilo-style agents make this path searchable where the task is written.

## Decision

Typing `@` at a token boundary opens a compact inline result list. Search requests go to the extension host and return at most 20 metadata-only candidates from the validated workspace index. Results include files and derived folders. Selecting one sends only kind/path intent back to the host; the host independently resolves, validates, and captures it through `ComposerContextService`.

File mentions use the existing bounded source snapshot. Folder mentions capture a deterministic manifest of contained indexed paths, not recursive source bodies. This gives the model a scoped map and lets its normal search/read tools inspect exact files during an agent run.

## Interaction

- `@` or `@query` searches files and folders.
- Arrow keys move selection.
- Enter or Tab attaches the selected result and removes the incomplete mention token.
- Escape closes suggestions.
- Mouse selection is equivalent.
- `/` commands and `@` mentions never open simultaneously.
- Selected context remains visible as the existing removable chips.

## Security And Limits

- Candidate source is a validated workspace-bound index.
- Maximum 20 returned candidates and 120 query characters.
- Host revalidates every selected path; webview paths are never authority.
- Folder manifests contain at most 500 indexed paths and 64 KiB.
- No symlinks, traversal, source bodies for folders, remote URIs, hidden index internals, or automatic model calls.
- A missing/stale index returns explicit provenance; stale results remain selectable only after current filesystem validation.

## Proof Contract

Tests must prove ranking, file/folder distinction, query bounds, result caps, metadata-only responses, folder containment, manifest source exclusion, stale/missing index behavior, forged path rejection, keyboard selection, session persistence, prompt injection, and compact desktop/sidebar rendering.
