# 2026-06-11 Desktop Message Crash

## Symptom

Desktop dev app exited when sending a message.

## Root Cause

The desktop runtime had been changed to run `runHeadless` in the Electron main
process. The TUI headless path is a CLI entrypoint, not an embedded library:
it reads process-global config and has multiple `process.exit` /
`gracefulShutdownSync` paths. When those paths run inside Electron, they can
terminate the desktop app instead of only ending an agent turn.

## Fix

Restored the desktop message runtime to spawn `dist/desktop-agent/codepilotx-local.exe`
as an isolated subprocess when an agent executable path is available. The
in-process runtime remains as a fallback, but normal desktop dev/build sessions
now pass `agentExecutablePath` and report `runtimeKind: 'subprocess'`.

Touched files:

- `apps/desktop/src/main/agentRuntime.ts`
- `apps/desktop/src/main/agentSession.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/shared/types.ts`

## Evidence

- `bun run desktop:build` passed.
- `bun run typecheck` passed.
- Direct runtime smoke using `dist/desktop-agent/codepilotx-local.exe` returned a
  captured subprocess error (`Desktop agent process exited with code 1`) instead
  of killing the parent process. The subprocess error was expected in the smoke
  environment because OAuth login is disabled/not configured there.

## Status

DONE_WITH_CONCERNS: The isolation fix is verified from the runtime layer, but a
full interactive Electron UI send-message test still depends on a logged-in
desktop session.
