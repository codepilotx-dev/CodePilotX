# Tool Result Runtime Metadata 修复计划

## Summary
- 先保存本计划，再修改代码。
- 当前 `log.md` 中 `Read` / `Glob` 失败仍只显示 `summary=Read` / `summary=Glob`。
- 根因在 runtime 到 workflow 的链路：`AgentRuntimeEvent` 的 `tool_result` 事件没有 metadata 字段，`agentRuntimeEventToThreadEvents()` 因此无法把失败详情投影到 `ToolResultTurnItem.metadata`。
- 本轮只补工具结果 metadata 传递，不改 workflow schema、不改工具执行顺序、不改 Markdown 展示规则。

## Key Changes
1. 扩展 `packages/core/src/agent/runtime.ts`：
   - 为 `AgentRuntimeEvent` 的 `tool_result` 变体增加可选 `metadata?: Record<string, unknown>`。
2. 扩展 `packages/core/src/agent/workflow.ts`：
   - `sourceMetadata()` 除 source 信息外，也合并 runtime event 自带 metadata。
   - `tool_result` item 继续保留 `summary`，但 metadata 中可携带 `stderr/stdout/output/error/message/content/text/result` 等字段。
3. 补测试：
   - `packages/core/src/agent/workflow.test.ts` 增加 failed `tool_result` metadata 投影测试。
   - `apps/desktop/src/main/workflowProjection.test.ts` 增加 desktop projector 保留 failed tool result metadata 的测试。

## Test Plan
- 先写失败测试并确认红灯：
  - `bun test packages/core/src/agent/workflow.test.ts`
  - `bun test apps/desktop/src/main/workflowProjection.test.ts`
- 实现后运行：
  - `bun test packages/core/src/agent/workflow.test.ts apps/desktop/src/main/workflowProjection.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
  - `bun run desktop:typecheck`

## Assumptions
- 如果原始桌面 agent event 没有任何失败输出，本次仍只能显示 summary。
- 如果 agentRuntime 构造 `tool_result` 时已经能拿到原始 stdout/stderr/content，后续可继续在 `apps/desktop/src/main/agentRuntime.ts` 的具体适配点补 metadata；本轮先打通类型和投影通道。
- commit 使用中文：`传递工具失败结果 metadata`。
