# Debug Report: OpenAI-Compatible SSE Hang

- Date: 2026-06-15
- Status: DONE

## Symptom

After sending a chat message with an OpenAI-compatible provider, the UI could
remain in the thinking state indefinitely without displaying a response.

## Root Cause

`readOpenAIStream` in `apps/tui/src/services/api/openaiCompatible.ts` only split
SSE frames on `\n\n` and treated `data: [DONE]` as a no-op. Providers that emit
CRLF-delimited frames (`\r\n\r\n`) or keep the HTTP stream open after `[DONE]`
left the reader waiting for more bytes, so the query never yielded the final
assistant message.

## Fix

The stream reader now:

- recognizes CRLF, LF, and CR double-newline frame delimiters;
- treats `data: [DONE]` as terminal;
- cancels the reader and returns accumulated content immediately on DONE;
- flushes a final unterminated frame when the provider closes without DONE.

## Evidence

- `bun test apps/tui/src/services/api/openaiCompatible.test.ts` passed.
- `bun run typecheck` passed.
- `bun run build` passed.
- `bun run smoke` passed.

## Regression Test

`apps/tui/src/services/api/openaiCompatible.test.ts` covers:

- CRLF-delimited frames followed by `[DONE]` with no EOF;
- provider EOF without a final blank-line delimiter.
