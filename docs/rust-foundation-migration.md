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
     - `item/delta` (agentMessage text) → accumulates and emits `partial_message`
     - `item/completed` (agentMessage) → emits final assistant `message`
     - `turn/completed` → emits `done`
     - `error` → emits `error`
   - All other notifications (tools, commands, files, MCP, plan, reasoning)
     are debug-logged and silently ignored.

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

### Text-Only Limitations (First Version)

- Only text `string` input is accepted; `ContentBlockParam[]` input is
  rejected with: `Rust sidecar currently supports text-only turns.`
- `runControlResponse()` is not supported; throws: `Rust sidecar control
  responses (permissions/tools) are not supported in the first text-only
  version.`
- No tool execution, permission requests, MCP, file changes, plans, or
  reasoning tracking.
- No sidecar fallback to embedded mode (unlike `auto`).
- Concurrent turns are not supported.

### Local Try-Out

```sh
# Build the current repository's Rust app-server
cd rust/codex-rs
cargo build -p codex-app-server

# Launch desktop with rust-sidecar
CODEPILOTX_DESKTOP_RUNTIME=rust-sidecar bun run dev:desktop
```

## Next Steps (future slices)

1. **Tool execution integration** — map `item/tool/call` server requests to the
   existing desktop tool execution path.
2. **Permission/approval flow** — wire `item/permissions/requestApproval` into
   the desktop permission dialog.
3. **MCP support** — bridge the `mcpServer/elicitation/request` and MCP tool
   calls.
4. **File change events** — map `item/fileChange/started` and
   `item/fileChange/completed` to desktop diff notifications.
5. **Plan/reasoning support** — map `turn/plan/updated` and reasoning items.
6. **Error recovery** — sidecar crash fallback to embedded mode.
