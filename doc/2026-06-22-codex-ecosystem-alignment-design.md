# ClaudeCode 对齐 Codex 生态与保留国内模型能力设计

## Summary

本设计把 `D:\VueProject\ClaudeCode` 作为长期主干，不切换到 `D:\VueProject\CodeX` 作为新底座。`D:\VueProject\CodeX` 仅作为首版官方能力与 app-server v2 语义参照，重点参考其 Rust `app-server-protocol`、`app-server`、thread store、sandbox/permission 形态，而不迁移 ClaudeCode 的 TS/Bun 主循环到 Rust。

首轮目标是补齐 Codex 风格的协议边界、thread store、持久化与治理能力，同时保留 ClaudeCode 现有 CLI/TUI/Electron、多 provider、DeepSeek、MiniMax 工具链和国内模型优化。实施前不改业务代码；本文件先固定目标架构、协议子集、持久化模型、provider 策略、治理标准和后续拆分计划。

## Current Context

ClaudeCode 现状已经具备可承接本目标的基础：

- `apps/tui/src/appServer/` 已有 TS/Bun JSON-RPC app-server v1，方法包括 `initialize`、`thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`turn/rollback`、`item/inject`，通知为包装式 `thread/event`。
- `apps/tui/src/workflow/ThreadRuntime.ts` 已提供内存 thread runtime，能 start/resume/fork/sendTurn/interrupt/rollback/injectItem，但不是持久 thread store。
- `packages/core/src/agent/workflow.ts` 已定义 `ThreadEvent`、`TurnItem`、workflow fixture 与 runtime event 映射，是现有 desktop workflow replay 的事实事件模型。
- `apps/desktop/src/main/sessionPersistence.ts` 通过 transcript 加 overlay 管理桌面 session，并持久化 `workflowEvents`，但权威状态仍分散在 transcript、overlay、运行中 registry。
- `apps/desktop/src/main/desktopJsonRpcAppServerBridge.ts` 目前是可开关的镜像桥，主要验证 desktop 到 app-server 的并行事件接入，不是完整 v2 线协议。
- `packages/core/src/models/provider.ts` 与 `apps/tui/src/utils/model/providerConfig.ts` 已有 provider 抽象、模型 catalog、DeepSeek/MiniMax/OpenAI-compatible/AI Gateway/OpenRouter/Groq 基础配置。
- `apps/tui/src/tools/MiniMaxTool/` 已有 MiniMax 图片、语音、视频、音乐、视觉、文件、quota 工具链。

CodeX 快照中，v2 协议更细：`Thread` 包含 `id/sessionId/forkedFromId/preview/ephemeral/modelProvider/createdAt/updatedAt/status/cwd/source/name/turns`，turn/item 通知分拆为 `thread/*`、`turn/*`、`item/*`，并有 schema fixture 生成与漂移检查。ClaudeCode 应对齐这些语义和字段命名，而不是继续扩展当前私有 v1 形态。

## Goals

- 建立 Codex app-server v2 风格 facade：方法名、通知名、核心字段贴近 CodeX；未实现接口显式返回 `unsupported`。
- 把 thread store 设计为权威持久层：覆盖 list/read/resume/fork/archive/unarchive/delete/name/update、turn history、item/event replay、状态恢复。
- 将现有 transcript/session overlay 迁移为 thread store 的兼容数据源，避免一次性丢弃旧历史。
- 桌面端逐步从 session-centric 模型切换到 thread/event 模型，同时保留旧事件 fallback。
- 深化 DeepSeek 与 MiniMax：DeepSeek 保留 thinking/cache/user_id/usage/error 专门路径；MiniMax chat 与媒体工具保持独立优势。
- 建立协议 fixture、store/runtime/desktop/provider 测试矩阵、typecheck 分组、schema drift 检查和发布治理。

## Non-Goals

- 不把 ClaudeCode 主循环迁移到 Rust。
- 不以 `D:\VueProject\CodeX` 作为代码底座或直接覆盖 ClaudeCode 架构。
- 不在首轮深挖 OpenAI-compatible/custom/AI Gateway/OpenRouter/Groq 的高级能力，只保持基础可用与回归覆盖。
- 不继续扩大当前私有 app-server v1 协议；v1 后续只作为兼容入口和迁移桥。
- 不在本设计阶段修改业务代码。

## Design Principles

- Codex 兼容优先对齐线协议和持久语义，不照搬 Rust 内部实现。
- Thread store 是权威状态来源，runtime 是执行态缓存，desktop projection 是读模型。
- 所有事件可重放；列表、详情、桌面视图都能从 thread metadata、turn、item、event 推导。
- Unsupported 是显式能力，不是隐式失败；客户端可根据 capabilities 降级。
- Provider 能力不被 Codex 对齐稀释；DeepSeek/MiniMax 作为一等路径保留专属字段和测试。
- 每个实施计划都必须可独立验收，先测试或 fixture，再实现。

## Architecture

### Target Components

```text
Desktop Renderer
  -> desktopClient / legacy desktopApi fallback
  -> Desktop app-server client
  -> app-server protocol facade
  -> ThreadRuntime
  -> QueryEngine / provider layer / tools / permissions
  -> ThreadStore
  -> transcript/session adapter
```

### app-server protocol facade

位置建议：`apps/tui/src/appServer/`。

职责：

- 对外暴露 Codex v2 风格 JSON-RPC 方法和通知。
- 保持 stdio transport 首发；WebSocket/TCP 只在 desktop 或外部客户端需要时加入。
- 将 v2 wire params 转换为 ClaudeCode 内部 `ThreadRuntimeSettings`、`TurnItem`、`AgentPermissionPolicy`、provider 配置。
- 将 `ThreadEvent` 转换为 CodeX 风格 `thread/*`、`turn/*`、`item/*` 通知。
- 返回统一 error shape；未实现方法返回 `unsupported`，并包含 capability key。

### ThreadRuntime

位置延续：`apps/tui/src/workflow/ThreadRuntime.ts`，后续可拆出 `ThreadRuntimeController`。

职责：

- 管理运行中 thread/turn 生命周期：start、resume、fork、sendTurn、interrupt、rollback。
- 只持有执行态对象，例如 `QueryEngine`、AbortController、active turn、sequence cursor。
- 所有生命周期状态变更写入 `ThreadStore`，再由 store 事件 append 产生可重放历史。
- runtime 启动时从 `ThreadStore` 读 metadata 和最近 turn/event cursor，恢复 `nextSequence`。

### ThreadStore

位置建议：`apps/tui/src/threadStore/` 或 `packages/core/src/agent/threadStore/`。若 desktop 主进程也需要直接读写，应放在 `packages/core` 并保持无 Electron 依赖。

职责：

- 权威保存 thread metadata、turns、items、events、operation log。
- 提供 `listThreads`、`readThread`、`createThread`、`resumeThread`、`forkThread`、`archiveThread`、`unarchiveThread`、`deleteThread`、`renameThread`、`updateThreadMetadata`、`appendEvent`、`listTurns`、`listTurnItems`。
- 处理损坏数据恢复：单 thread 文件损坏时隔离为 corrupt record，不阻断全局 list。
- 对外输出 CodeX 风格 `Thread`/`Turn`/`ThreadItem`，对内保留 ClaudeCode 原始 event payload。

### session/transcript adapter

职责：

- 读取现有 `loadAllProjectsMessageLogs` 和 desktop overlay store。
- 将旧 transcript 转为 thread metadata、turn summary、message/tool items、workflow events。
- 采用懒迁移：首次 list/read 时生成投影，首次写操作时 materialize 到 ThreadStore。
- overlay 中的 pinned/archive/title/settings 先映射为 thread metadata；旧 overlay 保留一段时间作为 fallback。

### desktop client

职责：

- 从当前 `desktopApi` session 模型逐步迁移到 app-server thread 模型。
- 首轮保留 legacy fallback：当 v2 facade 不可用或 capability 不满足时，继续走现有 `agentRuntime` 和 `sessionPersistence`。
- renderer 侧状态不直接信任局部 mutation，而是通过 event replay 和 thread read/list 投影得到一致视图。
- `workflowReducer` 继续作为事件投影核心，但输入改为 v2 通知或 v2 adapter 后的 `DesktopWorkflowEvent`。

### provider layer

职责：

- 保持 `ModelProviderAdapter` 和 provider config 的统一入口。
- DeepSeek 分支保留 reasoning/thinking、cache usage、user_id、余额、错误码映射。
- MiniMax 分两条能力线：chat provider 与媒体工具。chat 可进入统一 `streamResponse`，媒体工具继续作为工具能力暴露。
- 基础 provider 只承诺模型列表、stream、usage、错误归一化，不在首轮引入专属高级参数。

## Protocol Design

### Version and handshake

`initialize` 返回：

- `protocolVersion: 2`
- `serverInfo: { name: "codepilotx-app-server", version }`
- `capabilities.methods`: 已实现方法列表
- `capabilities.notifications`: 已实现通知列表
- `capabilities.unsupported`: 已知但暂不支持的方法或通知，包含 reason 和 plannedPhase
- `capabilities.providers`: 当前可用 provider 摘要
- `compatibility.codexSnapshot`: 本地对齐参照，例如 `D:\VueProject\CodeX`

v1 `APP_SERVER_PROTOCOL_VERSION = 1` 不再扩展；新增 v2 facade 后，v1 仅保留测试和旧客户端兼容。

### First compatible RPC subset

首批实现或适配的方法：

- `thread/list`: 返回 thread metadata 列表，支持 archived/includeArchived/searchTerm/basic pagination。
- `thread/read`: 返回单个 `Thread`，可选 includeTurns/includeItems。
- `thread/start`: 创建 thread，可接受 cwd、model、modelProvider、sandbox/permission、initial user input。
- `thread/resume`: 加载已有 thread，恢复 runtime 执行态，返回包含 turns 的 `Thread`。
- `thread/fork`: 从 source thread 和可选 turn/item cursor fork，生成新 thread。
- `thread/archive`: 设置 archivedAt，发出 `thread/archived`。
- `thread/unarchive`: 清除 archivedAt，发出 `thread/unarchived`。
- `thread/delete`: 软删除或 tombstone，发出 `thread/deleted`。
- `thread/name/update`: 设置用户标题，发出 `thread/name/updated`。
- `thread/metadata/update`: 更新 pin、source、workspace、model 等非 turn 内容。
- `thread/rollback`: 回滚到指定 turn/item 边界，保留 rollback 事件。
- `thread/turns/list`: 列出 turns，可先支持 summary/full 两档。
- `thread/turns/items/list`: 首轮可返回 `unsupported`，Plan 2 后补完整。
- `thread/injectItems`: 仅内部和测试使用，首轮受 capability gate。
- `turn/start`: 启动 turn，接受 CodeX `input: UserInput[]`，内部适配 string 或 `ContentBlockParam[]`。
- `turn/interrupt`: 中断 active turn。
- `model/list`: 返回 provider/model catalog。
- `model/providerCapabilities/read`: 返回 provider 能力摘要。
- `permission_profile/list`: 返回 ClaudeCode 权限/沙箱配置映射。

首批显式 unsupported：

- realtime conversation、remote control、marketplace/plugin install、windows sandbox setup、multi-agent advanced collaboration、schema experimental APIs、thread shell command、process exec direct APIs。
- 对这些方法统一返回 `code: -32009`、`data.kind: "unsupported"`、`data.capability`、`data.plannedPhase | null`。

### Notifications

v2 facade 不再只发 `thread/event` 包装通知；首批发出：

- `thread/started`
- `thread/status/changed`
- `thread/archived`
- `thread/unarchived`
- `thread/deleted`
- `thread/name/updated`
- `turn/started`
- `turn/completed`
- `turn/failed`
- `turn/interrupted`
- `turn/diff/updated`
- `turn/plan/updated`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoningSummaryText/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/patchUpdated`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `warning`
- `error`

内部 `ThreadEvent` 继续存在，但只作为 adapter 输入和持久原始事件，不作为新客户端的主 wire shape。

### Error shape

所有 JSON-RPC error 使用统一结构：

```json
{
  "code": -32009,
  "message": "thread/turns/items/list is not supported yet",
  "data": {
    "kind": "unsupported",
    "method": "thread/turns/items/list",
    "capability": "thread.turnItems.full",
    "threadId": "thread-...",
    "turnId": "turn-...",
    "retryable": false
  }
}
```

建议错误 code：

- `-32601`: method not found，未知方法。
- `-32602`: invalid params，参数 shape 错误。
- `-32004`: unknown thread/turn/item。
- `-32008`: conflict，例如 active turn mismatch、delete active thread。
- `-32009`: unsupported，已知但暂未实现。
- `-32000`: internal app-server error。

### Schema and fixtures

首轮不需要复制 Rust `ts_rs` 生成链，但要建立 TS fixture：

- `apps/tui/src/appServer/v2/fixtures/*.json`
- `initialize`
- `thread/list`
- `thread/read`
- `thread/start`
- `turn/start`
- `turn/completed`
- `item/started`
- `item/completed`
- `error`
- `unsupported`

后续可把 CodeX schema 作为只读参照，新增 `schema drift` 测试检查 ClaudeCode fixture 的关键字段是否仍与参照字段命名一致。

## Persistence Design

### Authority model

ThreadStore 是唯一权威写入层：

- metadata 决定 list/read/archive/delete/name/update 的结果。
- events 决定 replay 和 runtime cursor。
- turns/items 决定 read/resume/fork/rollback 的内容边界。
- transcript/session overlay 只作为迁移和 fallback 数据源，不再作为新状态的最终来源。

### Storage shape

建议首版使用文件型 store，便于本地 TS/Bun 落地和调试：

```text
<configDir>/threads/index.json
<configDir>/threads/<threadId>/metadata.json
<configDir>/threads/<threadId>/turns.jsonl
<configDir>/threads/<threadId>/items.jsonl
<configDir>/threads/<threadId>/events.jsonl
<configDir>/threads/<threadId>/ops.jsonl
```

`index.json` 只保存 list 必需字段和 tombstone 指针；详情以 thread 目录为准。未来若 list/search 性能不足，再评估 SQLite，不在首轮引入数据库迁移复杂度。

### Thread metadata

字段：

- `id`
- `sessionId`
- `forkedFromId`
- `parentThreadId`
- `preview`
- `ephemeral`
- `modelProvider`
- `model`
- `createdAt`
- `updatedAt`
- `recencyAt`
- `status`
- `cwd`
- `workspaceRoots`
- `source`
- `threadSource`
- `gitInfo`
- `name`
- `archivedAt`
- `deletedAt`
- `pinnedAt`
- `settings`
- `providerMetadata`
- `schemaVersion`

### Turn model

字段：

- `id`
- `threadId`
- `clientUserMessageId`
- `status`: `inProgress | completed | interrupted | failed`
- `startedAt`
- `completedAt`
- `durationMs`
- `input`
- `itemsView`
- `error`
- `usage`
- `costUsd`
- `stopReason`
- `rollbackOfTurnId`
- `schemaVersion`

### Item model

内部 item 保留 ClaudeCode `TurnItem`，对外通过 mapper 输出 CodeX `ThreadItem`：

- `user_message` -> `UserMessage`
- `agent_message` -> `AgentMessage`
- `reasoning` -> `Reasoning`
- `tool_call` -> `CommandExecution`、`McpToolCall` 或 `DynamicToolCall`，按 tool source 映射。
- `tool_result` -> 更新对应 tool item 或生成 result summary item。
- `permission_request` -> approval request notification 与 item metadata。
- `file_change` -> `FileChange`
- `error` -> turn error 或 error item。

首轮允许存在 `metadata.rawClaudeCodeItem`，用于未完全映射的工具类型，避免丢历史。

### Event replay

事件写入顺序：

1. app-server 接到 request，生成 operation id。
2. runtime 状态变更写入 ThreadStore。
3. ThreadStore append event，分配 thread-local sequence。
4. facade 从 store event 生成 v2 notification。
5. desktop 从 notification 或 read/replay 构建 UI。

事件必须具备：

- `eventId`
- `threadId`
- `turnId` 可选
- `itemId` 可选
- `sequence`
- `createdAt`
- `type`
- `payload`
- `rawThreadEvent` 可选

### Archive/delete/fork/rollback semantics

- `archive`: 非破坏性，只设置 `archivedAt`；默认 list 不返回 archived。
- `unarchive`: 清除 `archivedAt`，更新 recency。
- `delete`: 首轮使用 tombstone 软删除，保留原始目录，`deletedAt` 后默认 list/read 不显示；后续可加 purge。
- `fork`: 复制 metadata 子集、turns/items/events 到 cursor 边界，记录 `forkedFromId` 和 `forkCursor`。
- `rollback`: 不直接删除历史；写入 rollback operation，生成新 active view。read 默认返回 rollback 后视图，debug 模式可返回 hidden turns。

### Migration path

1. Read-through：`thread/list` 先读 ThreadStore，再合并现有 transcript/overlay 投影。
2. Lazy materialize：对旧 session 执行 resume/fork/archive/name/update 时写入 ThreadStore。
3. Dual write：新 thread 同时写 ThreadStore 和现有 session overlay，保持旧桌面 fallback。
4. Store authority：desktop 默认读 ThreadStore，overlay 只保留兼容字段。
5. Cleanup：确认历史迁移稳定后移除旧 overlay 权威逻辑。

## Provider Design

### Unified surface

统一 provider 输出：

- `providerID`
- `kind`
- `model`
- `capabilities`
- `usage`
- `balance`
- `normalizedError`
- `rawProviderMetadata`

Provider 错误归一化继续使用 `ProviderDisplayError`，但扩展 `providerSpecific` 字段保存原始错误码和 HTTP body 摘要。

### DeepSeek

DeepSeek 是重点一等能力：

- 保留 OpenAI-compatible 基础 stream。
- 单独支持 thinking/reasoning 参数映射，不把 DeepSeek thinking 强行塞进通用字段。
- 保留 cache hit/miss、cache read/write、reasoning token usage。
- 支持 `user_id` 或等价用户标识透传。
- 错误映射覆盖 authentication、quota、model not found、rate limit、service busy、base URL。
- 测试覆盖 stream usage、cache usage、thinking 开关、错误归一化。

### MiniMax

MiniMax 分为 chat provider 与媒体工具：

- Chat：走 `ModelProviderAdapter.streamResponse`，保留 `minimax` kind 和 MiniMax 模型 catalog。
- Tools：继续保留 `MiniMaxImage`、`MiniMaxSpeech`、`MiniMaxVideo`、`MiniMaxMusic`、`MiniMaxVision`、`MiniMaxFile`、`MiniMaxQuota`。
- 媒体工具的 artifact 路径、远程 file id、quota 响应写入 tool item metadata，desktop 可展示下载/打开入口。
- 错误使用 MiniMax `base_resp` 和 HTTP status 双层解析。

### Basic providers

OpenAI-compatible/custom/AI Gateway/OpenRouter/Groq 首轮保持：

- list models
- stream response
- tool support 探测
- vision support 探测
- usage extraction
- normalized error

不在首轮承诺 provider-specific reasoning、cache、余额或自定义媒体工具。

## Permissions and Sandbox

ClaudeCode 不迁移 Rust sandbox，但抽象要对齐 Codex 语义：

- `AgentPermissionProfile` 映射到 v2 `permissions` 或 `sandboxPolicy`。
- `approvalMode` 映射到 `approvalPolicy` 和 approval reviewer。
- 现有 desktop permission modal 继续处理 command/file/tool approval。
- Windows sandbox 相关 v2 方法首轮返回 unsupported，reason 为 `native sandbox not implemented in TS runtime`。
- 后续如需要 native 隔离，再独立评估 Rust helper 或 Windows helper，不进入主循环迁移。

## Desktop Migration

阶段性策略：

1. Desktop main 创建 app-server v2 client，优先连接内进程 facade。
2. Sidebar list 从 `thread/list` 读取，保留 session list fallback。
3. Conversation read 从 `thread/read` 或 event replay 投影。
4. Composer 发送 `turn/start`，stream 通过 v2 notifications 更新。
5. Archive/name/delete/fork/resume 调用 thread RPC。
6. 当 facade 返回 unsupported 或 connection fail，回退旧 `desktopApi`。

Desktop UI 不做移动端适配，本项目仅需 desktop 页面。

## Governance Design

### Required validation commands

首轮继续使用仓库已有命令：

- `bun run test:codex-workflow`
- `bun run typecheck`
- `bun run desktop:typecheck`

新增后建议分组：

- `bun test apps/tui/src/appServer`
- `bun test apps/tui/src/threadStore`
- `bun test apps/desktop/src/main apps/desktop/src/shared`
- `bun test packages/core/src/models`

### Fixture and drift checks

- 每个 v2 request/response/notification fixture 固定 JSON shape。
- 添加 `unsupported` fixture，防止未实现方法变成 generic internal error。
- 添加 schema drift smoke：读取 CodeX 参照字段清单，检查 ClaudeCode fixture 至少包含首批核心字段。
- fixture 更新必须单独 commit 或在 commit message 明确说明协议变更。

### CI and release

- CI 至少包含 typecheck、codex workflow tests、app-server fixture tests、desktop projection tests、provider unit tests。
- 发布前要求 release notes 说明 v2 facade 支持列表、unsupported 列表、迁移风险。
- commit 使用中文，例如 `补齐 app-server v2 unsupported 框架`。

## Implementation Plan Split

### Plan 1: app-server v2 线协议 facade 与 unsupported 基础框架

目标：

- 新增 v2 protocol types、method registry、capability handshake、unsupported error。
- 保留 v1，不继续扩展。
- 建立 v2 fixture 和 server tests。

主要文件：

- `apps/tui/src/appServer/protocol.ts`
- `apps/tui/src/appServer/server.ts`
- `apps/tui/src/appServer/v2/*`
- `apps/tui/src/appServer/*.test.ts`

验收：

- `initialize` 返回 v2 capabilities。
- 已知未实现方法返回 `unsupported` fixture。
- 现有 `bun test apps/tui/src/appServer` 和 `bun run test:codex-workflow` 通过。

### Plan 2: ThreadStore 完整持久化与 transcript/session overlay 适配

目标：

- 新增 ThreadStore 文件型持久层。
- 支持 list/read/resume/fork/archive/unarchive/delete/name/update。
- transcript/overlay 懒迁移。

主要文件：

- `packages/core/src/agent/threadStore/*` 或 `apps/tui/src/threadStore/*`
- `apps/desktop/src/main/sessionPersistence.ts`
- `apps/tui/src/utils/sessionStorage*.ts`

验收：

- Store 测试覆盖 CRUD、fork、rollback view、损坏数据隔离。
- 旧 transcript 可在 `thread/list` 出现，写操作后 materialize。

### Plan 3: ThreadRuntime 生命周期语义补齐

目标：

- Runtime 从 ThreadStore 恢复。
- start/resume/fork/rollback/interrupt 写 store event。
- event sequence、active turn、status 一致。

主要文件：

- `apps/tui/src/workflow/ThreadRuntime.ts`
- `apps/tui/src/workflow/ThreadRuntime.test.ts`
- `packages/core/src/agent/workflow.ts`

验收：

- Runtime 测试覆盖 start/resume/fork/rollback/interrupt 事件顺序。
- turn failure/interruption 后 thread status 可恢复。

### Plan 4: 桌面端切换到 app-server 事件/线程模型

目标：

- Desktop main 默认走 v2 app-server thread RPC。
- renderer 状态通过 v2 notification/replay 投影。
- 旧 session API fallback 保留。

主要文件：

- `apps/desktop/src/main/desktopJsonRpcAppServerBridge.ts`
- `apps/desktop/src/main/agentSession.ts`
- `apps/desktop/src/main/sessionPersistence.ts`
- `apps/desktop/src/shared/workflowReducer.ts`
- `apps/desktop/src/renderer/features/session/*`

验收：

- Desktop workflow event replay、session persistence、tool/permission derived state 回归通过。
- 断开 v2 facade 时旧路径仍可用。

### Plan 5: DeepSeek/MiniMax provider 深化、测试矩阵与错误/usage 统一

目标：

- DeepSeek thinking/cache/user_id/usage/error 形成专门路径。
- MiniMax chat provider 与媒体工具 metadata 对齐 thread items。
- 基础 provider 回归。

主要文件：

- `packages/core/src/models/provider.ts`
- `apps/tui/src/utils/model/providerConfig.ts`
- `apps/tui/src/tools/MiniMaxTool/*`
- provider 相关测试文件

验收：

- DeepSeek usage/cache/thinking/error fixture 通过。
- MiniMax chat/tool schema/error fixture 通过。
- OpenAI-compatible 基础回归通过。

### Plan 6: CI、发布、schema fixture、文档与迁移检查

目标：

- 新增 CI 分组和 fixture drift 检查。
- 补迁移文档、release checklist、unsupported 列表。
- 建立阶段性验收标准。

主要文件：

- `package.json`
- CI 配置文件
- `doc/*`
- app-server fixture tests

验收：

- 本地 `bun run typecheck`、`bun run desktop:typecheck`、`bun run test:codex-workflow` 可作为发布前必跑。
- CI 覆盖协议、store、runtime、desktop、provider 核心回归。

## Test Plan

- 协议 fixture：固定 initialize、thread、turn、item、error、unsupported JSON shape。
- Store 测试：list/read/resume/fork/archive/unarchive/delete/name/update、损坏数据恢复、软删除 tombstone。
- Runtime 测试：start/resume/fork/rollback/interrupt 的事件顺序、status、sequence、active turn。
- Desktop 测试：workflow event replay、session persistence、tool/permission 派生状态、legacy fallback。
- Provider 测试：DeepSeek thinking/cache usage/error；MiniMax chat/tool schema/error；基础 OpenAI-compatible 回归。
- 收尾验证：`bun run test:codex-workflow`、`bun run typecheck`、`bun run desktop:typecheck`。

## Risks and Mitigations

- 风险：一次性对齐 CodeX 全量 v2 范围过大。缓解：首轮只实现 thread/turn/item 核心，其他显式 unsupported。
- 风险：旧 transcript 与新 ThreadStore 双写造成状态分叉。缓解：定义 ThreadStore 为新权威，overlay 仅 fallback，并添加 materialize 测试。
- 风险：desktop 状态投影重复或乱序。缓解：事件 sequence 和 eventId 去重，read/replay 作为修复路径。
- 风险：DeepSeek/MiniMax 专属能力被通用 provider 抽象吞掉。缓解：保留 provider-specific metadata 和专项测试。
- 风险：文件型 store 后续 list/search 性能不足。缓解：先保证 schema 和迁移正确，性能瓶颈明确后再引入 SQLite。

## Acceptance Criteria

- 文档层面：本设计固定主路线、协议、持久化、provider、治理和后续 6 个实施计划。
- Plan 1 完成后：v2 facade 能握手、报告 capabilities、对未实现方法返回 unsupported，现有 v1 不破。
- Plan 2 完成后：ThreadStore 成为 thread list/read/resume/fork/archive/delete/name/update 的权威来源。
- Plan 3 完成后：ThreadRuntime 生命周期事件可恢复、可重放、可回滚。
- Plan 4 完成后：desktop 能基于 app-server thread/event 工作，并保留 fallback。
- Plan 5 完成后：DeepSeek/MiniMax 专项能力有测试矩阵保护。
- Plan 6 完成后：CI 与 fixture drift 能防止协议和持久化回归。

## Assumptions

- 官方能力对齐以本地 `D:\VueProject\CodeX` 当前快照为准，不主动追 GitHub 最新 main。
- “完整持久化”是目标设计要求，但实施拆成多个可验收阶段。
- 本仓库继续使用 TS/Bun/Electron 技术栈。
- 中文 commit 约定继续执行。
- 本设计保存到 `D:\VueProject\ClaudeCode\doc`，符合项目 AGENTS.md 要求。
