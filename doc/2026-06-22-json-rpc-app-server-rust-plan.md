# JSON-RPC App-Server 与 Rust 迁移评估计划

## Summary
- 方向改为引入 Codex 风格 JSON-RPC app-server，但第一阶段用 TypeScript/Bun 实现，不直接迁移 Rust。
- 原因：当前仓库没有 Cargo/Rust 基础；已有 `vscode-jsonrpc`、`ws`、`ThreadRuntime`、`ThreadEvent` 和 Electron IPC。TS app-server 能最快把协议边界立起来。
- Rust 作为明确的评估项推进：先做设计对照和最小 spike，不在第一阶段重写 `QueryEngine + query()`。

## Key Changes
- 新增 TS JSON-RPC app-server 核心，位置为 `apps/tui/src/appServer/`。
- 使用 `vscode-jsonrpc/node` 的 stdio transport 作为 v1 默认传输。
- app-server 内部调用现有 `ThreadRuntime`，不复制模型循环。
- 先支持单进程内存 thread registry，事件继续用 `ThreadEvent`。
- 新增协议方法：`initialize`、`thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`turn/rollback`、`item/inject`。
- 新增通知：`thread/event`，payload 为现有 `ThreadEvent`。
- 统一 JSON-RPC error shape，包含 `code`、`message`、可选 `data.threadId/turnId/cause`。
- v1 不做 `turn/steer`，除非已有真实调用方。
- 新增 CLI 入口 `apps/tui/src/entrypoints/appServer.ts`。
- 新增脚本 `bun run codex:app-server`。
- 桌面保留现有 `desktopApi` 和 `onWorkflowEvent`，后续通过 `CODEPILOTX_JSON_RPC_APP_SERVER=1` 并行桥接。

## Interfaces
- 新增内部类型：
  - `JsonRpcAppServer`
  - `AppServerThreadRegistry`
  - `JsonRpcThreadStartParams`
  - `JsonRpcTurnStartParams`
  - `JsonRpcErrorData`
- 复用现有类型：
  - `ThreadEvent`
  - `ThreadId`
  - `TurnId`
  - `TurnItem`
  - `ThreadRuntime`
- 不修改 `ThreadEvent` / `TurnItem` schema。
- 不迁移 provider、auth、tool 执行、transcript resume 到 Rust。

## Test Plan
- 新增 app-server 单元测试：
  - `initialize` 返回协议版本和能力。
  - `thread/start` 创建 thread 并发出 `thread.started`。
  - `turn/start` 流式转发 `ThreadRuntime.sendTurn()` 事件。
  - `turn/interrupt` 发出 `turn.interrupted`。
  - 错误 threadId/turnId 返回 JSON-RPC error，不 crash server。
- 新增协议 fixture 测试：
  - 固定 request/response/notification JSON shape。
  - 确保 `ThreadEvent` payload 与现有 workflow 测试兼容。
- 回归命令：
  - `bun test apps/tui/src/appServer`
  - `bun run test:codex-workflow`
  - `bun run desktop:typecheck`
- Rust 只做文档与 spike 评估，不进入主验证链。

## Assumptions
- 第一阶段目标是“协议边界可运行”，不是完整复制 Codex Rust app-server。
- JSON-RPC app-server 先走 stdio；WebSocket/TCP 留到有外部客户端需求时再加。
- Rust 迁移结论默认是“暂不迁移，先保留评估门槛”，除非 spike 证明 TS 路线明显不够。
- commit 使用中文，例如：`引入 Codex 风格 JSON-RPC app-server`。
