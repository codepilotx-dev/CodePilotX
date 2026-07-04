# appServer 协议

## 概述

appServer 是 CodePilotX 的运行时边界协议。它定义了 Desktop/TUI（客户端）与 agent runtime（服务端）之间的通信契约。

## 架构分层

```
┌──────────────────────────────────────────────┐
│  Desktop / TUI / Web                         │  ← 客户端（UI / CLI）
├──────────────────────────────────────────────┤
│  JSON-RPC over stdio      HTTP + SSE          │  ← 传输层
│  (v1 sidecar)             (v3 HTTP API)       │
├──────────────────────────────────────────────┤
│  JsonRpcAppServer (packages/core)            │  ← 协议层
├──────────────────────────────────────────────┤
│  AppServerThreadRegistry (apps/tui)           │  ← 适配层
├──────────────────────────────────────────────┤
│  ThreadRuntime → QueryEngine (apps/tui)       │  ← 运行时
└──────────────────────────────────────────────┘
```

## 传输方式

### stdio（v1，默认）
- 子进程通过 stdin/stdout 建立 JSON-RPC 连接
- 使用 `vscode-jsonrpc` 的 `MessageConnection`
- entrypoint: `apps/tui/src/entrypoints/appServer.ts`
- 启动：`bun apps/tui/src/entrypoints/appServer.ts`

### HTTP + SSE（v3，可选）
- Loopback HTTP API 服务
- SSE 用于事件推送
- 随机 token 认证（自动生成 32 字节 hex）
- entrypoint: `apps/tui/src/entrypoints/appServerHttp.ts`
- 端点：
  - `POST /jsonrpc` — JSON-RPC 请求
  - `GET /events` — SSE event stream
  - `GET /healthz` — 健康检查

## JSON-RPC 方法

### `initialize`
请求：
```json
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
```
响应：
```json
{"jsonrpc": "2.0", "id": 1, "result": {
  "protocolVersion": 1,
  "capabilities": {
    "transports": ["stdio"],
    "methods": ["initialize", "thread/start", "turn/start", ...],
    "notifications": ["thread/event", "session/snapshot.updated"]
  }
}}
```

### `thread/start`
创建新会话线程。

### `thread/resume`
恢复已有会话线程。

### `thread/fork`
从源线程 fork 出新线程。

### `turn/start`
处理用户输入。同步方法：在侧边处理期间通过 `thread/event` 通知流式发送事件，完成时返回。

### `turn/interrupt`
中断进行中的 turn。

### `turn/rollback`
回滚到指定 turn。

### `item/inject`
向线程中注入自定义 item。

### `session/getSnapshot`
获取会话快照（用于 UI 恢复）。

## 通知

### `thread/event`
服务端 → 客户端。每当有 ThreadEvent 产生时推送。

### `session/snapshot.updated`
服务端 → 客户端。会话快照更新时推送。

## 类型定义

所有 JSON-RPC 类型定义在 `packages/core/src/appServer/protocol.ts`。
服务端实现（`JsonRpcAppServer` 类）在 `packages/core/src/appServer/server.ts`。
