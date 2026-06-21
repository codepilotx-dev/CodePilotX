# Codex Workflow 回放与持久化收尾

## Summary
- 本轮优先做 Codex workflow 的“回放+测试”：让桌面端 live workflow events 不只发给 renderer，也能进入 session snapshot，刷新/重启后仍可用于调试时间线和状态派生。
- 保持现有 `AgentRuntimeEvent` fallback，不把 workflow event log 作为 resume 权威来源，不改 `QueryEngine/query()` 主循环。

## Key Changes
- 持久化 live workflow events：
  - 新增 `applyDesktopWorkflowEventsToSnapshot(snapshot, workflowEvents)` 纯函数，追加并归一化 `DesktopWorkflowEvent`，设置 `workflowEventModelVersion: 1`。
  - 调整 `DesktopWindowService.emitAgentEvent()` / `emitPermissionDecision()` 的内部返回值，让 main 进程拿到本次投影出的 workflow events。
  - 在 `apps/desktop/src/main/index.ts` 中，agent 事件和 permission decision 发出后，把返回的 workflow events 写回对应 session snapshot 并持久化。
- 回放与诊断稳定性：
  - `readWorkflowEventLog()` 继续只读 `workflow-events.jsonl`，但解析时复用 `normalizeThreadEvent()`，丢弃坏行，不影响 UI。
  - `WorkflowDebugTimeline` 展示和复制时统一按 `activeSessionId` 过滤最近 60 条，避免跨 session 事件污染。
  - 保留现有“检查日志”“复制 MD”行为；复制内容继续包含当前事件诊断和日志诊断。
- 接口变更：
  - 不改变 renderer 暴露的 `DesktopApi.readWorkflowEventLog(): Promise<DesktopWorkflowEvent[]>`。
  - 仅调整 main 内部 `DesktopWindowService` 方法返回类型：发出 workflow events 后返回 `DesktopWorkflowEvent[]`，供 session snapshot 持久化使用。

## Test Plan
- 扩展 `apps/desktop/src/main/sessionPersistence.test.ts`：
  - live workflow events 追加到 snapshot 后能被 normalize/read back。
  - 重复或非法 workflow event 不破坏 snapshot。
- 扩展 `apps/desktop/src/main/workflowProjection.test.ts`：
  - permission decision event 使用同一 session/thread 并生成可持久化事件。
  - 同名并发工具 start/result 仍按 FIFO 绑定 `toolUseId`。
- 扩展 `apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts` 或 `workflowViewPatch.test.ts`：
  - active session 过滤后只导出本 session 事件。
  - 从持久化 workflow events 派生 tool log / pending permissions 仍保持 fallback 行为。
- 运行：
  - `bun test apps/desktop/src/main/workflowProjection.test.ts apps/desktop/src/main/sessionPersistence.test.ts apps/desktop/src/shared/workflowReducer.test.ts apps/desktop/src/renderer/features/session/workflowViewPatch.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
  - `bun run desktop:typecheck`

## Assumptions
- 本轮不改 workflow schema，不引入 Rust app-server/JSON-RPC。
- `workflow-events.jsonl` 仍是调试日志，只有 `CODEPILOTX_WORKFLOW_EVENT_LOG=1` 时写入。
- session snapshot 里的 `workflowEvents` 只是桌面 UI 回放和诊断来源；真正 resume 仍依赖现有 transcript。
- 旧 `toolLog`、旧 `pendingPermissions`、旧 `events` 保留为 fallback，避免历史会话或缺 workflow events 的会话回归。
