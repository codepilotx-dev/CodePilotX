# 2026-07-05 Desktop sidecar/MCP chat stall

## Symptom

Desktop quick chat sent a user message, switched to running, then finished almost immediately without an assistant reply. Debug log showed:

- `sidecar_crashed` with `spawn bun ENOENT`
- fallback log with `Cannot call write after a stream was destroyed`
- embedded runtime `mcp_sync_error` with `e.map is not a function`

## Root Cause

There were two confirmed defects in the same startup path:

1. `SidecarManager.start()` created the JSON-RPC connection and sent `initialize` even when the spawned `bun` process had already failed asynchronously. On Windows this changed the useful `spawn bun ENOENT` into a noisy `ERR_STREAM_DESTROYED` write failure.
2. `EmbeddedDesktopHeadlessRuntime.syncMcpServers()` treated `getAllMcpConfigs().servers` as an array, but the config API returns a record keyed by server name. The fallback runtime therefore logged `e.map is not a function` on each turn.

Sidecar also did not pass the desktop runtime PATH/toolchain environment into `buildSidecarEnv()`, so Electron processes with a narrower PATH were more likely to miss `bun`.

## Fix

- Wait for immediate spawn failure before creating the sidecar JSON-RPC connection.
- Preserve `context.toolchainEnvironment` in sidecar env.
- Normalize MCP config records with `Object.entries()` before comparing/iterating runtime configs.

Reference checked: `D:\GitHubProject\Agent\claude-code-master\src\cli\print.ts` uses `Object.entries(newConfigs)` for `getAllMcpConfigs().servers`.

## Evidence

- `bun test apps/desktop/src/main/sidecarManager.test.ts apps/tui/src/headless/desktopRuntime.test.ts` passed: 13 tests, 0 failures.
- `bun run typecheck` still fails in pre-existing `apps/desktop/src/main/desktopSessionIndex.ts` missing sqlite/storage/shared exports, outside this change.

## Status

DONE_WITH_CONCERNS: fixed the confirmed sidecar startup and MCP sync defects. A real Desktop/provider turn should still be manually retried because the provided log did not include a conversation-flow dump for the July 5 failed turn.
