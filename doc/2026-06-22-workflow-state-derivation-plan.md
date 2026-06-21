# Workflow 状态接管优化计划

## Summary
- 先把本计划保存为 `D:\VueProject\ClaudeCode\doc\2026-06-22-workflow-state-derivation-plan.md`，再进入代码修改。
- 本轮推进 `doc\codex-workflow-roadmap.md` 的第二阶段：让桌面端 `toolLog` 和 `pendingPermissions` 优先由 `ThreadEvent` 派生，旧 `AgentRuntimeEvent` 状态继续作为 fallback。
- 不改 `QueryEngine`、`query()`、工具执行顺序、权限审批链路、compact 或 transcript 恢复逻辑。

## Key Changes
- 在桌面 session 状态层扩展 `workflowViewPatch`：基于去重后的 `workflowEvents` 调用 `deriveWorkflowSessionState`，同时派生 `pendingPermissions` 和 `toolLog`。
- 将 `WorkflowToolRun` 映射为现有 `DesktopToolLogEntry`：
  - `tool_call` 生成 start 类日志，展示工具名和调用摘要。
  - `tool_result` 生成 result 类日志，展示结果摘要和错误状态。
  - 同一 `toolUseId` 的 start/result 保持稳定顺序，避免同名并发工具串错。
  - 已展开状态尽量按旧 `toolLog.id` 或 `toolUseId` 继承；错误结果默认展开。
- 接管规则保守处理：
  - 当当前 session 有 workflow 工具事件时，`toolLog` 使用 workflow 派生结果。
  - 当没有 workflow 工具事件时，保留旧 `AgentRuntimeEvent` 写入的 `toolLog`。
  - 当 workflow 诊断出现重复事件、乱序、未完成工具结果时，不阻断 UI，只在调试时间线中继续显示诊断。
- 保持权限 drawer 行为：
  - workflow 派生出新的 `permission_request` 时仍自动打开权限 drawer。
  - 用户 allow/deny 后继续走现有 `respondToPermission()`，本地先移除 pending request，再等待 workflow decision event 收敛状态。

## Interfaces
- 不新增外部桌面 IPC API。
- 可新增内部 helper，例如 `deriveWorkflowViewPatch(workflowEvents, currentView, threadId?)`，返回 `workflowEvents`、`pendingPermissions`、`toolLog`。
- `DesktopWorkflowEvent`、`ThreadEvent`、`TurnItem` 暂不改 schema；本轮只消费现有事件模型。

## Test Plan
- 新增或扩展 `apps/desktop/src/shared/workflowReducer.test.ts`：
  - 同名并发工具 start/result 能按 `toolUseId` 正确成对。
  - 缺少 result 的工具保持 running/未完成诊断。
  - 错误 result 标记 `isError`，映射日志默认展开。
- 扩展 `apps/desktop/src/renderer/features/session` 相关测试或补最小纯函数测试：
  - 有 workflow 工具事件时接管 `toolLog`。
  - 无 workflow 工具事件时保留旧 `toolLog`。
  - permission request started/completed 后 pending 权限正确增删。
- 运行：
  - `bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts apps/desktop/src/shared/workflowReducer.test.ts apps/desktop/src/main/workflowProjection.test.ts apps/desktop/src/renderer/features/session/workflowEventDedup.test.ts`
  - `bun run desktop:typecheck`

## Assumptions
- 本轮目标是“局部接管 UI 派生状态”，不是事件日志权威恢复，也不是完整替换 `AgentRuntimeEvent`。
- 消息正文仍保持现有 `messages/events` fallback 机制，避免影响聊天主路径。
- `log.txt` 仍不处理。
- commit 使用中文信息，例如：`接管 workflow 工具日志派生状态`。
