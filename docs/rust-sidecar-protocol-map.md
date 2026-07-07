# Rust Sidecar Protocol Map

> Last updated: 2026-07-07

This document maps the protocol between the Electron desktop shell and the Rust
`codex-app-server` sidecar process. It covers the first text-only integration
slice.

## Transport

| Property | Value |
|---|---|
| Protocol | JSON-RPC 2.0 |
| Framing | Newline-delimited JSON (one JSON object per line) |
| Direction | Bidirectional (request/response + server notifications) |
| Transport | stdin/stdout of the spawned `codex-app-server` process |
| Client | `RustLineJsonRpcClient` → `RustAppServerClient` |

> **Contrast with TypeScript sidecar**: The TypeScript sidecar (`sidecarManager.ts`)
> uses `vscode-jsonrpc` with `Content-Length` header framing. The Rust sidecar
> is intentionally incompatible — it uses raw newline-delimited JSON.

---

## 1. Desktop Event → App-Server Request

| Desktop action | JSON-RPC method | Direction | Params | Response |
|---|---|---|---|---|
| Initialize session | `initialize` | Request → | `clientInfo`, `capabilities` | `InitializeResponse` |
| Notify ready | `initialized` | Notification → | (none) | — |
| Start thread | `thread/start` | Request → | `model`, `modelProvider`, `cwd`, `ephemeral` | `ThreadStartResponse` |
| Send user message | `turn/start` | Request → | `threadId`, `input[{text}]`, `model` | `TurnStartResponse` |
| Interrupt turn | `turn/interrupt` | Request → | `threadId`, `turnId` | `TurnInterruptResponse` (`{}`) |

### Initialize

```json
{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"clientInfo":{"name":"codepilotx-desktop","title":"CodePilotX Desktop","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
```

### Initialized (notification — no response)

```json
{"jsonrpc":"2.0","method":"initialized"}
```

### Thread Start

```json
{"jsonrpc":"2.0","id":"2","method":"thread/start","params":{"model":"MiniMax-M3","modelProvider":"minimax-cn","cwd":"/workspace/path","ephemeral":true}}
```

### Turn Start (text-only)

```json
{"jsonrpc":"2.0","id":"3","method":"turn/start","params":{"threadId":"thread-abc","input":[{"type":"text","text":"Hello world","text_elements":[]}],"model":"MiniMax-M3"}}
```

### Turn Interrupt

```json
{"jsonrpc":"2.0","id":"4","method":"turn/interrupt","params":{"threadId":"thread-abc","turnId":"turn-xyz"}}
```

Response: `{"jsonrpc":"2.0","id":"4","result":{}}` (empty object).

---

## 2. App-Server Notification → Desktop Event

| Notification | Desktop event(s) | State effect |
|---|---|---|
| `thread/started` | (none emitted) | Stores `threadId` |
| `turn/started` | (none emitted) | Stores `activeTurnId`, clears delta buffer |
| `item/delta` | `partial_message` | Appends text to `assistantDeltaBuffer`; emitted text includes full buffer |
| `item/completed` (agentMessage) | `message(role=assistant)` | Emits final item text (not buffer); clears delta buffer |
| `turn/completed` | `done` | Clears `activeTurnId`; clears delta buffer; resolves turn promise |
| `error` | `error` | Clears `activeTurnId`; clears delta buffer; resolves + rejects turn promise |
| Others | (debug-logged via `rust_adapter_unhandled_notification`) | Ignored |

### thread/started

```json
{"jsonrpc":"2.0","method":"thread/started","params":{"thread":{"id":"thread-abc"}}}
```

### turn/started

```json
{"jsonrpc":"2.0","method":"turn/started","params":{"turn":{"id":"turn-xyz"}}}
```

### item/delta

```json
{"jsonrpc":"2.0","method":"item/delta","params":{"threadId":"thread-abc","turnId":"turn-xyz","itemId":"item-1","itemDelta":{"text":"Hello, "}}}
```

Emitted as:
```typescript
{ type: 'partial_message', sessionId, text: 'Hello, ' }
```

### item/completed (agentMessage)

```json
{"jsonrpc":"2.0","method":"item/completed","params":{"item":{"type":"agentMessage","id":"item-1","text":"Hello, world!","phase":"final_answer"}}}
```

Emitted as:
```typescript
{ type: 'message', sessionId, role: 'assistant', text: 'Hello, world!' }
```

### turn/completed

```json
{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-abc","turn":{"id":"turn-xyz"}}}
```

Emitted as:
```typescript
{ type: 'done', sessionId }
```

### error

```json
{"jsonrpc":"2.0","method":"error","params":{"error":{"message":"Context window exceeded","codexErrorInfo":null,"additionalDetails":null}}}
```

Emitted as:
```typescript
{ type: 'error', sessionId, message: 'Context window exceeded' }
```

---

## 3. Provider Wire API Matrix

The Rust sidecar receives provider configuration via `-c` CLI arguments. The
`wire_api` setting determines which API protocol the Rust app-server uses to
talk to the LLM provider.

| Provider kind / ID | `wire_api` | Endpoint pattern | Auth mechanism |
|---|---|---|---|---|
| `anthropic` | `anthropic_messages` | Default Anthropic Messages API | `env_key` / api key |
| `anthropic-compatible` | `anthropic_messages` | Provider-specific base URL | `env_key` / api key |
| `minimax` | `anthropic_messages` | `https://api.minimaxi.com/anthropic/v1` | `x-api-key` header via `env_key` |
| `openai` (`@ai-sdk/openai`) | `responses` | Default OpenAI Responses API | `env_key` / api key |
| `openai-compatible` (default) | `responses` | Provider-specific base URL | `env_key` / api key |
| `deepseek` | `chat_completions` | `https://api.deepseek.com/chat/completions` | `DEEPSEEK_API_KEY` via `env_key` |
| `openai-compatible` (chat-only) | `chat_completions` | Provider-specific `/chat/completions` | `env_key` / api key |

### Configuration override pattern

Each provider generates CLI args like:

```
-c model="MiniMax-M3"
-c model_provider="minimax-cn"
-c model_providers.minimax-cn.name="MiniMax (minimaxi.com)"
-c model_providers.minimax-cn.wire_api="anthropic_messages"
-c model_providers.minimax-cn.base_url="https://api.minimaxi.com/anthropic/v1"
-c model_providers.minimax-cn.env_key="MINIMAX_API_KEY"
```

The API key is set via environment variable (`MINIMAX_API_KEY=sk-...`), never in
CLI args.

### Implementation location

- `createRustModelProviderOverrides()` in `rustSidecarRuntime.ts:156`
- `getRustProviderWireApi()` in `rustSidecarRuntime.ts:203`

---

## 4. Unsupported Items (First Text-Only Version)

| Feature | Status | Error/behavior |
|---|---|---|
| Non-text input (`ContentBlockParam[]`) | ❌ | Throws: `Rust sidecar currently supports text-only turns.` |
| Control responses (permissions/tools) | ❌ | Throws: `Rust sidecar control responses (permissions/tools) are not supported in the first text-only version.` |
| Tool calls (`tool_use` / `tool_result`) | ❌ | Notification ignored (debug-logged) |
| Permission requests | ❌ | Notification ignored |
| MCP server integration | ❌ | Returns empty status |
| File change events | ❌ | Notification ignored |
| Plan/reasoning events | ❌ | Notification ignored |
| Concurrent turns | ❌ | Throws: `Rust sidecar does not support concurrent turns.` |
| `/v1/chat/completions` provider API | ❌ | Future: not wired in `getRustProviderWireApi()` |
| Websocket transport | ❌ | Overridden to `supports_websockets=false` |
| OpenAI auth header | ❌ | Overridden to `requires_openai_auth=false` |

---

## 5. Fallback Behavior

When the Rust sidecar binary is missing or fails to start (`SidecarStartError`):

| Runtime preference | Fallback target | Debug event |
|---|---|---|
| `rust-sidecar` | `InProcessDesktopAgentRuntime` (embedded headless) | `runtime_rust_sidecar_failed_fallback_embedded` |

Non-startup errors and user-aborted startup do **not** trigger silent fallback.

---

## 6. Key Files

| File | Purpose |
|---|---|
| `apps/desktop/src/main/rustSidecarRuntime.ts` | `RustSidecarDesktopAgentRuntime` — spawn/teardown/interrupt |
| `apps/desktop/src/main/rustAppServerClient.ts` | Typed JSON-RPC client for app-server methods |
| `apps/desktop/src/main/rustLineJsonRpcClient.ts` | Raw newline-delimited JSON-RPC transport |
| `apps/desktop/src/main/rustAppServerWorkflowAdapter.ts` | Maps server notifications to desktop events |
| `apps/desktop/src/main/rustAppServerProtocol/` | Generated TypeScript protocol types |
| `apps/desktop/src/main/agentRuntime.ts` | `RustFallbackDesktopAgentRuntime` — fallback wrapper |
| `apps/tui/src/appServer/` | TUI-side JSON-RPC server (reference implementation) |
