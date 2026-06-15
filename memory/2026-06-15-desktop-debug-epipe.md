# 2026-06-15 Desktop Debug EPIPE

## Symptom

Electron showed "A JavaScript error occurred in the main process" with
`Error: EPIPE: broken pipe, write`. The stack pointed at `console.info` from the
bundled desktop main process while handling a session event.

## Root Cause

`apps/desktop/src/main/desktopDebug.ts` wrote every debug event through
`console.info`. In dev runs, Electron inherits stdout from `scripts/desktop-dev.mjs`.
If the parent process or terminal pipe exits while Electron is still alive, stdout
becomes a broken pipe. The next debug event writes to that pipe and crashes the
main process.

## Fix

Changed `desktopDebug` to write directly to `process.stdout`, catch synchronous
broken-pipe failures, and listen for stdout stream `error` events. After an
`EPIPE` or destroyed stream error, desktop debug logging is disabled for that
process instead of crashing Electron.

Touched files:

- `apps/desktop/src/main/desktopDebug.ts`

## Evidence

- `bun run typecheck` passed.
- `bun run desktop:build` passed.
- `git diff --check` passed for the touched source files; output only contained
  the existing CRLF normalization warnings.

## Status

DONE_WITH_CONCERNS: The code path that crashed is guarded and build-verified.
The exact broken-pipe UI popup depends on killing the dev parent process while
Electron remains alive, so it was not reproduced end-to-end after the fix.
