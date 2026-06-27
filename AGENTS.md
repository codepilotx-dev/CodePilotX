# AGENTS.md

## Scope
These instructions apply to the whole `ClaudeCode` tree unless a nested
`AGENTS.md` says otherwise.

## Project Shape
- This is a TypeScript/TSX CLI and terminal UI codebase.
- Many imports intentionally use `.js` extensions even from `.ts`/`.tsx` files;
  keep that style when adding or changing imports.
- Some files in this checkout include inline `sourceMappingURL` blocks and
  `sourcesContent`. Treat them as part of the current artifact shape: avoid
  broad formatting passes, and keep edits narrowly focused.
- The app only needs to support desktop pages; do not spend effort adapting
  pages for non-desktop viewports unless explicitly requested.
- This checkout may not include package manager or test configuration files.
  Discover available commands before claiming a build or test path exists.

## Editing Rules
- Prefer small, local changes that follow the surrounding file style.
- Prefer UTF-8 when reading code and project files.
- Preserve existing public exports and runtime behavior unless the task
  explicitly asks for an API change.
- Keep code ASCII unless the file already requires non-ASCII content.
- Use typed helpers already present in `utils`, `services`, `Tool.ts`, and
  `types` before adding new utility layers.
- Do not edit generated files by hand. See nested instructions under
  `types/generated`.

## Validation
- First look for nearby existing validation patterns or commands.
- If no runnable test/build command is available in this checkout, do a
  targeted TypeScript/style review of the files you changed and state that
  limitation in the handoff.

## Debugging Notes

### Conversation Debug Dump Tool Results
- When desktop debug mode writes
  `<workspace>/.Temp/conversation-flow-*.json`, inspect both `toolFlow` and
  the next `model_call_start`/provider request. A tool can succeed locally in
  `tool_update_message` but still be missing from the next model context.
- The dump writer lives in `apps/tui/src/utils/conversationDebugDump.ts`.
  It redacts sensitive keys such as `authorization`, `api-key`, `x-api-key`,
  `token`, `secret`, `cookie`, and `password`; ordinary `tool_result.content`
  is not redacted just because it is file content.
- For "tool result missing" symptoms, check these files first:
  `apps/tui/src/query.ts`,
  `apps/tui/src/utils/messages.ts`,
  `apps/tui/src/services/api/minimax.ts`, and
  `apps/tui/src/headless/desktopRuntime.ts`.
- 2026-06-27 root cause: `ensureToolUseResultsForNextTurn()` returned the
  original `toolResults` array when no synthetic result was needed. The caller
  then did `toolResults.length = 0` and `toolResults.push(...pairedToolResults)`;
  because both variables referenced the same array, real tool results were
  cleared before the next model call. `ensureToolResultPairing()` then inserted
  `[Tool result missing due to internal error]`, so the model reported an
  internal tool failure even though the tool had returned content.
- The fix is intentionally small: in `apps/tui/src/query.ts`,
  `ensureToolUseResultsForNextTurn()` must return a fresh array
  (`[...toolResults]`) when no missing results exist, and keep returning
  `[...]` with appended synthetic results when needed. Do not move this fix
  into the provider or the dump redaction path.
- Regression coverage belongs in `apps/tui/src/query.test.ts`. Include a case
  that stores `pairedResults`, clears the original `results` array, pushes the
  paired results back, and verifies the real `tool_result` remains.
- Targeted verification for this class of bug:
  `bun test apps/tui/src/query.test.ts apps/tui/src/utils/conversationDebugDump.test.ts`.
  For manual confirmation, inspect the newest `.Temp/conversation-flow-*.json`
  and verify the next `model_call_start` includes the real `tool_result`, the
  last provider request does not contain `[Tool result missing due to internal
  error]`, and the request contains the successful tool result marker.
