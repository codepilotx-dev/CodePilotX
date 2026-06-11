# 2026-06-12 Desktop Stream Freeze

## Symptom

The desktop chat page became unresponsive while a DeepSeek/OpenAI-compatible
streaming response was being rendered.

## Root Cause

The upstream model stream was still producing events and reached `message_stop`,
so the request was not hung. The desktop app was doing too much work per tiny
stream chunk: main-process debug logging, renderer debug logging, IPC delivery,
React state updates, and a session-store save for each partial text/thinking
delta. Providers that emit very small chunks can produce enough events to make
Electron appear frozen.

Follow-up video evidence showed the app could still freeze during tool-call
phases. The first fix only coalesced renderer delivery and persistence; the
main process was still applying every tiny delta to the full in-memory session
snapshot before coalescing, copying growing message/thinking strings repeatedly.
The renderer also kept old `thinkingText` mounted during later tool execution
and summarized it by scanning the full string on each render.

Second follow-up video showed freezes while the assistant answer itself was
being rendered. Even after event coalescing, each streaming assistant text
update still synchronously ran the full Markdown pipeline (`marked`, `xss`,
and `highlight.js`) against the growing full response. Code blocks without an
explicit language also triggered `highlightAuto`, which can block the renderer
main thread on larger or frequently updated text.

User suspected logging was contributing to the freezes. A follow-up scan found
two remaining unguarded stream-event logs in the TUI query pipeline
(`query-loop-stream` and `query-engine-stream`). In desktop mode, the agent
subprocess uses stdout as a structured JSON channel, so per-event console logs
can both flood DevTools/terminal output and risk polluting the protocol stream.

## Fix

- Coalesced high-frequency `partial_message`, `thinking_delta`, and
  `tool_input_delta` events before updating snapshots, saving, or sending IPC.
- Debounced session-store persistence for those high-frequency events.
- Disabled stream debug logging by default behind environment flags.
- Removed renderer-side hot-path console logging.
- Stopped rendering retained thinking text outside active thinking mode.
- Rendered full thinking text only when the thinking details are expanded, and
  limited summary generation to a small prefix.
- Render streaming assistant text as plain React text and defer Markdown
  parsing/sanitizing/highlighting until the message is final.
- Disabled automatic language detection for code blocks without an explicit
  language; those blocks are escaped and rendered as plain text.
- Deferred expensive tool input/output formatting until a tool card is expanded.
- Gated the remaining TUI stream-event logs behind `QUERY_STREAM_DEBUG=1`.

## Evidence

- `bun run typecheck` passed.
- `bun run desktop:build` passed.

## Status

DONE_WITH_CONCERNS: The hot path is fixed and build-verified, but a full
interactive Electron send-message run still depends on the user's configured
provider credentials and live desktop session.

## Follow-up: Conversation Went Sideways

### Symptom

A copied desktop conversation looked chaotic: the assistant misidentified the
project as Vue based on the parent folder name, `Glob` failed with
`uv_spawn 'B:\~BUN\root\vendor\ripgrep\x64-win32\rg.exe'`, and
resume/compaction context referenced transcript files under
`~/.oh-my-openagent/projects/...`.

### Root Cause

The apparent Chinese mojibake was a PowerShell inspection artifact: reading
UTF-8 files without an explicit encoding showed garbled text, but the pasted
attachment, source files, and JSONL transcript were valid UTF-8 when read
through Node.

The real failures were separate:

- Desktop/TUI search defaulted to a vendored ripgrep path derived from the
  bundled runtime location. In this desktop environment that path did not
  exist, while a system `rg.exe` was available on PATH.
- Desktop transcript hydration did not filter internal transcript-only entries
  such as `isMeta`, `isCompactSummary`, and `isVisibleInTranscriptOnly`. Those
  entries are meant for model/session recovery, not the user-facing desktop
  history.

### Fix

- Added a system `rg` fallback when the vendored ripgrep binary is missing.
- Filtered transcript-only/meta/compact-summary entries from desktop history
  hydration.

### Evidence

- Direct UTF-8 checks showed the attachment, renderer source, and JSONL
  transcript contain normal Chinese, not mojibake.
- `ripgrepCommand()` now resolves to system `rg` in the current desktop
  environment instead of the missing `B:\~BUN\root\vendor\...` path.
- A direct `ripGrep(['--files', '--glob', 'package.json'], ...)` call returns
  results successfully.
- The affected transcript contains hidden user entries; these are now skipped
  during desktop history hydration.
- `bun run typecheck` passed.
- `bun run desktop:build` passed.
