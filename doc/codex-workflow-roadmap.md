# Codex 风格工作流后续改造路线图

## 当前状态

当前项目已经完成第一阶段的 Codex 风格工作流外壳：

- `packages/core/src/agent/workflow.ts` 定义了 `ThreadId`、`TurnId`、`ThreadEvent`、`TurnItem`、`TurnStatus` 等共享类型。
- `apps/tui/src/workflow/ThreadRuntime.ts` 在不改 `QueryEngine + query()` 主循环的前提下，提供 `startThread()`、`sendTurn()`、`interruptTurn()`、`getThreadState()` facade。
- `apps/tui/src/workflow/sdkEventMapping.ts` 将现有 `SDKMessage` 投影为 append-only 的 `ThreadEvent`。
- 桌面 main/preload/shared 层已经新增 `onWorkflowEvent` 并保留旧 `onAgentEvent`。
- 事件日志开关 `CODEPILOTX_WORKFLOW_EVENT_LOG=1` 默认关闭，开启后仅作为 JSONL 调试日志，不参与 resume。

## 本轮实现目标

本轮只做桌面只读调试时间线，用于验证新事件协议是否足够表达真实会话流。

- 在 renderer 会话状态中新增 `workflowEvents: DesktopWorkflowEvent[]`。
- 通过 `desktopClient.onWorkflowEvent()` 订阅 main 进程派发的 `ThreadEvent`。
- 切换会话时只展示对应 session/thread 的事件，避免跨会话污染。
- 在会话页提供默认折叠的调试时间线，展示事件类型、threadId、turnId、item 类型/状态、工具名、权限 requestId、错误和时间。
- 不替换现有 `message/toolLog/permission` 状态源。
- 不改 `apps/tui/src/query.ts`、工具执行顺序、权限判断、compact 或 transcript 恢复逻辑。

## 后续阶段

### 第二阶段：局部接管 UI 派生状态

- 让 tool log 可以从 `ThreadEvent` 的 `tool_call/tool_result` 派生。
- 让 permission drawer 可以从 `permission_request` item 派生。
- 旧 `AgentRuntimeEvent` 继续作为 fallback，避免一次性迁移导致桌面回归。

### 第三阶段：事件日志只读回放

- 保持 transcript 是恢复来源。
- 增加只读 `workflow-events.jsonl` 回放视图，用于调试事件顺序和协议兼容性。
- 不把事件日志作为 resume 的权威状态，直到事件协议稳定。

### 第四阶段：核心循环内部事件化

- 在 `QueryEngine/query()` 周边逐步直接产出更细粒度的 turn item。
- 工具调用、权限请求、compact boundary、assistant partial、最终 result 逐步从内部源头事件化。
- 每一步都保留现有 SDK/桌面输出兼容层。

### 第五阶段：统一 SDK/TUI 消费面

- SDK、桌面、后续 TUI 统一面向 `ThreadRuntime` / `ThreadEvent`。
- 内部 `Message[]` 继续存在，但只作为模型上下文和 transcript 的实现细节。
- 最终目标是接近 Codex 的 thread/turn/event/item 工作流，但不迁移到 Rust app-server，也不引入 JSON-RPC server。

## 验证标准

- 普通问答能看到 `thread.started -> turn.started -> item.* -> turn.completed`。
- 工具调用能看到 `tool_call -> tool_result`。
- 权限请求能看到 `permission_request`，旧权限弹窗和 `respondToPermission()` 仍可用。
- `bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts` 通过。
- `bun run typecheck` 通过。

## Commit 约定

- 本轮完成后使用中文 commit message：`引入 Codex 风格工作流调试时间线`。
- commit 包含当前工作树全部改动，包括已有 `apps/desktop/src/renderer/styles/main.css` 修改。
