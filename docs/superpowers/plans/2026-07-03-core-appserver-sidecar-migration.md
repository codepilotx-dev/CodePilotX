# Core/AppServer/Sidecar 分阶段迁移计划

## Summary
目标架构定为：`packages/core` 承载 agent/session/tool runtime 与 appServer 协议，local server/API/Event stream 作为唯一运行时边界，desktop/web/tui 都作为客户端接入。迁移采用 sidecar 优先、JSON-RPC stdio 先落地、desktop 默认切换的路线；HTTP/SSE 放到后续版本。

迁移参考：
- D:\GitHubProject\opencode-1.16.2：迁移 sidecar 生命周期、health check、本地凭据、SSE 重连/合并、session run coordinator、task/background job 思路。
- D:\GitHubProject\codex-main：迁移 core protocol/app-server 分层、Thread/Turn/Item 投影、request serialization scope、fork 语义、multi-agent v2 mailbox 思路。

## Version Plan
- **v0 协议扶正与去重**
  - `packages/core/src/appServer/*` 成为唯一 appServer 协议/服务壳；`apps/tui/src/appServer/protocol.ts`、`server.ts` 改为 re-export 或直接 import core。
  - TUI 只保留 registry/runtime adapter，不再定义协议常量和 JSON-RPC 类型。
  - 增加边界护栏：desktop 对 `@codepilotx/tui` 的直接 runtime import 不得新增；core 不得依赖 TUI。
  - 保持现有执行路径不变，降低首轮风险。

- **v1 Desktop 默认走 JSON-RPC stdio sidecar**
  - 复用现有 `apps/tui/src/entrypoints/appServer.ts` 作为第一版 sidecar 执行进程。
  - Desktop main 新增 sidecar manager：spawn、initialize、thread/start、turn/start、turn/interrupt、session/getSnapshot、退出清理、失败 fallback。
  - Desktop 的 `AgentRuntime` 默认消费 sidecar 的 `thread/event` 与 `session/snapshot.updated`，再映射到现有 desktop workflow projection。
  - 保留 env 开关：`embedded`/`subprocess` 作为回退，sidecar 为默认。
  - 不在 v1 搬 `QueryEngine`，它仍留在 TUI sidecar 内执行。

- **v2 Core runtime 抽取**
  - 在 core 定义 runtime ports：`ThreadRuntimePort`、`ToolRegistryPort`、`PermissionGatewayPort`、`SessionStorePort`、`McpRegistryPort`、`EventSinkPort`。
  - 将纯事件模型、event store、snapshot 派生、sequence/eventId helper、stdout/control message 解析迁入 core。
  - TUI 的 `ThreadRuntime` 变成 core runtime adapter，逐步削薄对 `QueryEngineConfig` 的直接暴露。
  - Desktop/TUI 均通过 core appServer 接运行时，不再共享 TUI headless 内部实现。

- **v3 Local HTTP API + SSE**
  - 在 JSON-RPC stdio 稳定后添加 loopback HTTP API 与 SSE event stream。
  - 借鉴 opencode：随机本地 token/Basic Auth、loopback-only、health endpoint、CORS 限定 desktop renderer。
  - 客户端 SDK 统一封装 request + event stream；支持 heartbeat timeout、重连、事件合并、最小 backpressure。
  - Web/desktop renderer/tui remote mode 都改为 SDK 客户端，不直接碰 runtime。

- **v4 Session/Tool/Subagent 核心化**
  - 引入 core session coordinator：同 thread 串行、不同 thread 并行、wake 合并、显式 run 可等待。
  - 子代理改为 first-class child thread/session，记录 `parentThreadId`、`forkedFromId`、`agentPath`、`agentRole`。
  - 直接采用 Codex v2 mailbox 方向：父代理上下文只接收 bounded final/completion message，不把子代理完整 transcript 自动塞进主上下文。
  - task/background job 借鉴 opencode：foreground 可等待，background 可返回 running，完成后用结构化 event + bounded text 注入父会话。
  - fork history 使用白名单继承：保留稳定 system/developer/user/final assistant，过滤 tool call、reasoning、临时协作提示。

- **v5 清理与强约束**
  - 移除 desktop 对 TUI runtime/headless 的直接依赖和 alias 逃逸。
  - TUI 只作为客户端 UI/CLI shell，运行时能力在 core/local server。
  - 移除旧 experimental bridge 与重复 protocol/server 文件。
  - 文档化 appServer 协议、sidecar 生命周期、multi-agent mailbox 语义、fallback 策略。

## Public Interfaces
- appServer v1 保持现有方法：`initialize`、`thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`turn/rollback`、`item/inject`、`session/getSnapshot`。
- 后续 v2 增加：`turn/steer`、`thread/read`、`thread/list`、`agent/spawn`、`agent/sendMessage`、`agent/wait`、`agent/list`、`agent/interrupt`。
- 统一 UI 投影模型：`Thread -> Turn -> TurnItem`，前端不消费模型原始 rollout 或工具内部事件。
- Event stream 以 core `ThreadEvent` 为权威，transcript/SQLite 用于恢复与 backfill，不作为实时 UI 的第一来源。

## Test Plan
- v0：跑 appServer/core 边界测试，确认 TUI protocol re-export 后 fixture 不变。
- v1：增加 desktop sidecar manager 单测，覆盖 ready、initialize、event notification、turn failure、process exit fallback。
- v1 手动验收：桌面新建会话、发送消息、工具调用、interrupt、resume 后 UI 事件顺序与当前一致。
- v2：增加 event store/snapshot/idempotency 测试，覆盖 duplicate event、out-of-order 禁止、snapshot replay。
- v3：增加 SSE reconnect/heartbeat/coalescing 测试，覆盖 server restart、renderer pagehide/pageshow。
- v4：增加 multi-agent mailbox/fork 测试，确认子代理 final 进入父上下文但完整 transcript 不进入主上下文。

## Assumptions
- 默认路线采用用户已确认的 sidecar 优先、JSON-RPC stdio 优先、desktop 默认切换。
- 不照搬 opencode 的 Effect/Layer 体系，也不照搬 codex-main 的 Rust/schema 生成工程；只迁移边界、协议形状和状态机。
- 第一阶段允许"core 管协议和事件，TUI sidecar 继续执行 runtime"的过渡形态。
