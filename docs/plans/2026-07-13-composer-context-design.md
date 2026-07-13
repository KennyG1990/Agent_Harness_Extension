# Phase 83: Host-Owned Composer Context Design

## Problem

Forge can search a workspace after a run starts, but task entry is not grounded. The composer cannot attach the active editor, a selection, diagnostics, or chosen files. Users must manually describe paths, and the host sends only chat text or a goal string. This creates avoidable ambiguity and places Forge behind the task-entry behavior users expect from coding agents.

## Decision

Add one compact context control to the existing composer. The extension host, not the webview, owns context capture and validation.

Supported attachment kinds:

- `file`: a contained workspace file selected through the native VS Code Quick Pick.
- `selection`: the current non-empty active-editor selection, including its contained file and line range.
- `diagnostics`: current VS Code diagnostics for contained workspace files.

The host returns bounded metadata for chips and retains bounded source/diagnostic content. The webview may request add/remove/clear operations only; it cannot supply paths, source text, ranges, or diagnostics as authority.

## Persistence And Prompting

Attachments persist as `context.json` under the active `.forge/sessions/<session-id>/` directory. A chat session is created when context is first captured if none exists. Loading a session restores its validated attachment list.

Chat receives a bounded system context block. A coding run snapshots the current validated attachments into `HarnessState.userContext`, persists them with run state, and includes them as a required budgeted proposal-prompt section. The run does not reread a later-changed file behind the user's back; the attachment records the captured content and timestamp.

## Limits And Security

- Maximum 12 attachments per session.
- Maximum 64 KiB per file or selection, 192 KiB total.
- Maximum 100 diagnostics with bounded messages.
- Only `file:` URIs inside the real workspace root.
- Reject symlinks, directories, binaries, oversized source, traversal, and stale/tampered persisted records.
- Diagnostics are metadata only; no arbitrary diagnostic objects cross from the webview.
- Removing an attachment removes it from future prompts but not from historical model messages.

## UX

Use one `Paperclip` icon beside the existing index and approval controls. Its compact popover offers:

- Active file or selection, depending on editor state.
- Workspace files via native Quick Pick.
- Current diagnostics.
- Clear all.

Selected items appear as removable, single-line chips above the textarea. No file tree, editor, permanent context panel, or duplicate IDE surface is introduced.

## Proof Contract

Tests must prove host ownership, path containment, symlink rejection, content and count caps, session reload, removal, chat injection, run-prompt injection, and absence of source text from webview-supplied messages. Visual smoke must show a compact desktop and narrow-sidebar composer with attachment chips and popover without obscuring Send/Run.
