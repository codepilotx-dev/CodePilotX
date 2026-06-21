# Workflow 失败详情导出优化计划

## Summary
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-workflow-failure-detail-plan.md`，再进入代码修改。
- 优化 Workflow 事件复制 Markdown 的失败工具可读性：`tool_result / failed` 不只显示 `summary=Bash` 或 `summary=Glob`，尽量带出失败原因、输出摘要或 metadata 里的错误信息。

## Key Changes
- 检查 `ThreadEvent` / `TurnItem` 的 `tool_result` 可用字段，优先复用现有 schema，不改事件协议。
- 在 `workflowMarkdown.ts` 中增强 `tool_result` detail：
  - 保留 `tool`、`toolUseId`。
  - 对失败结果优先展示 `error`、`stderr`、`stdout`、`output`、`content`、`message` 等 metadata 字段中可读的摘要。
  - metadata 没有可用内容时继续回退到 `summary`。
  - 摘要继续做换行、管道符、长度处理，保证 Markdown 表格稳定。
- 补充 `workflowMarkdown.test.ts`：
  - failed `tool_result` 带 metadata error/output 时导出详情。
  - 缺少 metadata 时仍回退到 summary。

## Test Plan
- 运行 `bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`。
- 运行 `bun run desktop:typecheck`。

## Assumptions
- 本次只优化 Markdown 导出，不改 Workflow event schema、不改 toolLog 派生、不改运行时工具执行。
- 如果上游事件没有真实失败输出，本次只能把已有 metadata 可读字段导出；不会凭空生成原因。
