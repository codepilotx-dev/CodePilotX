# Rust Foundation Migration Baseline

## Goal

Use `D:\GitHubProject\Agent\codex-main\codex-rs` as the long-term Rust agent
core reference while keeping the current Electron/React desktop shell. This is
not a TypeScript-to-Rust line-by-line rewrite.

The reference repository is read-only for this branch. Current development
uses the copied workspace under `rust/codex-rs`.

## Current Desktop Boundary

- Runtime selection is controlled by `CODEPILOTX_DESKTOP_RUNTIME` or
  `CLAUDE_CODE_DESKTOP_RUNTIME`.
- Existing values are `auto`, `sidecar`, `embedded-headless`, and
  `subprocess`.
- This branch adds `rust-sidecar` as an explicit experimental value.
- `auto` still uses the existing TypeScript sidecar with embedded fallback.
- The existing TypeScript sidecar protocol is implemented by
  `packages/core/src/appServer/protocol.ts` and
  `apps/desktop/src/main/sidecarManager.ts`.

## Rust Reference Baseline

Primary source repository:

`D:\GitHubProject\Agent\codex-main\codex-rs`

Current repository copy:

`rust/codex-rs`

Key Rust crates:

- `app-server`: package `codex-app-server`, binary `codex-app-server`.
- `app-server-protocol`: official protocol types and generated schema.
- `core`: agent/session/tool execution core used by the app server.

Useful source paths:

- `codex-rs/app-server/src/main.rs`
- `codex-rs/app-server/src/lib.rs`
- `codex-rs/app-server-transport/src/transport`
- `codex-rs/app-server-protocol/src/protocol`
- `codex-rs/app-server-protocol/schema/typescript`

## Protocol Finding

The current desktop `SidecarManager` uses `vscode-jsonrpc` stream framing
(`Content-Length` headers). Rust `codex-app-server --listen stdio://` uses
newline-delimited JSON messages. A Rust sidecar cannot safely reuse the current
manager without a transport adapter.

## Implementation Status

### Established (previous slice)

- `rust-sidecar` can be selected and reported in runtime status.
- `CODEPILOTX_RUST_APP_SERVER` can point at a local `codex-app-server` binary.
- Default development lookup checks this repository's
  `rust/codex-rs/target/debug/codex-app-server`.
- `RustLineJsonRpcClient` provides the newline-delimited JSON-RPC transport
  needed by Rust `stdio://`.
- Explicit `rust-sidecar` falls back to embedded headless when the local Rust
  app-server binary is missing.

### Implemented (this slice)

#### Rust App-Server Protocol Adapter

The Rust app-server protocol adapter is now implemented and provides a
complete vertical slice for text-only agent conversation:

1. **Protocol Type Slice** (`apps/desktop/src/main/rustAppServerProtocol/`):
   - Minimal generated TypeScript types for `initialize`, `thread/start`,
     `turn/start`, `turn/interrupt`, and the key server notifications
     (`thread/started`, `turn/started`, `turn/completed`, `item/delta`,
     `item/completed`, `error`).
   - Barrel re-export (`index.ts`) so business code never imports generated
     files directly.

2. **`sendNotification` on `RustLineJsonRpcClient`**:
   - Added `sendNotification(method, params?)` for one-way JSON-RPC messages
     (e.g., `initialized`).

3. **`RustAppServerClient`** (`rustAppServerClient.ts`):
   - Typed wrapper around `RustLineJsonRpcClient`.
   - Methods: `initialize`, `notifyInitialized`, `startThread`, `startTurn`,
     `interruptTurn`, `onServerNotification`, `onNotification`, `close`.

4. **Notification Mapping** (`rustAppServerWorkflowAdapter.ts`):
   - Maps the following Rust server notifications to desktop events:
     - `thread/started` → stores thread id
     - `turn/started` → marks active turn
     - `item/delta` / `item/agentMessage/delta` → accumulates and emits `partial_message`
     - `item/completed` (agentMessage) → emits final assistant `message`
     - `item/completed` (dynamicToolCall) → emits `tool_result`
     - `item/completed` (commandExecution) → emits `tool_result` with exit code/output
     - `item/completed` (fileChange) → emits `tool_result` with change summary
     - `turn/completed` → emits `done`
     - `turn/plan/updated` → emits `proposed_plan` with formatted plan steps
     - `item/plan/delta` → emits streaming `proposed_plan`
     - `reasoning/textDelta` → emits `partial_message` with reasoning prefix
     - `reasoning/summaryTextDelta` → emits `partial_message` with summary prefix
     - `item/commandExecution/outputDelta` → emits `partial_message` for live output
     - `item/fileChange/patchUpdated` → emits `diff` events per file
     - `turn/diff/updated` → emits aggregated `diff`
     - `error` → emits `error`
   - Unknown notifications are debug-logged and silently ignored.

5. **`RustSidecarDesktopAgentRuntime`** (`rustSidecarRuntime.ts`):
   - Lazy startup: spawns `codex-app-server --listen stdio:// --session-source vscode`
     on the first `runUserTurn()` call.
   - Sends `initialize` → `initialized` → `thread/start` during startup.
   - Each turn sends `turn/start` with text-only `UserInput`.
   - Wires server notifications to the workflow adapter and emits events via
     the `DesktopAgentRuntimeContext.emit` callback.
   - Handles `done`/`error` notifications to resolve/reject the turn promise.
   - Supports abort via `AbortSignal` (sends `turn/interrupt`).
   - `dispose()` method for teardown.

6. **Permission/Approval Flow**:
   - `handlePermissionRequest()` handles `item/permissions/requestApproval`,
     `item/commandExecution/requestApproval`, and `item/fileChange/requestApproval`.
   - Uses `buildDesktopPermissionRequestFromControlRequest()` to build desktop
     permission requests from Rust protocol params.
   - Calls `context.requestPermission()` and awaits the user decision.
   - Maps `DesktopPermissionDecision` back to the Rust protocol response type
     (e.g., `{ decision: 'accept' | 'decline' }` for commands/file changes).

7. **Tool Call Flow** (`item/tool/call`):
   - Handler returns `{ status: 'pending' }` as JSON-RPC acknowledgment.
   - Tool is executed asynchronously via `executeToolAndNotify()`.
   - Result is sent to Rust server via `notifyToolResult()` notification.
   - `tool_start` / `tool_result` events emitted for desktop UI.
   - Note: most tools are handled by Rust server internally; client-side
     tool execution returns "not available" for now.

8. **MCP Elicitation** (`mcpServer/elicitation/request`):
   - Handler shows permission dialog and returns `{ cancelled: true }`.
   - Full form rendering requires future desktop UI support.

9. **Plan Mode Support**:
   - `setPlanModeActive()` stores the plan mode flag.
   - `-c collaboration_mode=plan` is added to app-server args when plan mode
     is active.

10. **Packaging**:
    - `scripts/prepare-desktop-rust-sidecar.mjs` builds and copies the Rust
      binary to `dist/desktop-rust-sidecar/`.
    - Electron-builder config updated to include `dist/desktop-rust-sidecar/**/*`
      in the packaged app.
    - `desktop:dist:win` script includes `desktop:rust-sidecar:prepare` step.

### Current Limitations

- Only text `string` input is accepted; `ContentBlockParam[]` input is
  rejected with: `Rust sidecar currently supports text-only turns.`
- `runControlResponse()` throws for normal flows (permissions handled directly
  in handlers).
- Client-side tool execution returns "not available" (Rust server handles
  common tools internally).
- MCP elicitation returns `{ cancelled: true }` (form rendering not supported).
- MCP runtime status returns empty (no background query yet).
- Concurrent turns are not supported.
- No sidecar crash fallback to embedded mode (unlike `auto`).

### Local Try-Out

```sh
# Build the current repository's Rust app-server
cd rust/codex-rs
cargo build -p codex-app-server

# Build the Rust sidecar for dist
cd /path/to/repo
node scripts/prepare-desktop-rust-sidecar.mjs

# Launch desktop with rust-sidecar
CODEPILOTX_DESKTOP_RUNTIME=rust-sidecar bun run desktop:dev
```

## Next Steps (future slices)

1. **Tool execution integration** — import and use TUI tool implementations
   for client-side tool execution via `item/tool/call`. Currently returns
   "not available".
2. **MCP form rendering** — implement desktop-side form UI for MCP elicitation
   requests instead of returning `{ cancelled: true }`.
3. **MCP runtime status** — add background query to populate
   `getMcpRuntimeStatus()` with real MCP server data.
4. **Sidecar crash recovery** — add fallback to embedded headless when Rust
   sidecar crashes during a turn.
5. **Non-text input** — support `ContentBlockParam[]` with image attachments.
6. **Thread resume/fork** — adapt `thread/resume` and `thread/fork` for
   session persistence. Currently single-thread only.

