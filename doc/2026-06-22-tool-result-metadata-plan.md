# Tool Result 失败详情 metadata 优化计划

## Summary
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-tool-result-metadata-plan.md`，再进入代码修改。
- 当前 `复制 MD` 已能读取 `tool_result` 的 `metadata.error/message/stderr/stdout/output/content/text/result`，但上游事件映射没有把真实失败输出稳定写入 metadata。
- 本轮只增强 `apps/tui/src/workflow/sdkEventMapping.ts`，让 `tool_result` item 在不改 schema 的前提下携带可读结果详情。

## Key Changes
- 在 `userMessageToEvents()` 处理 `tool_result` block 时：
  - 保留现有 `summary`、`toolUseId`、`isError`、`metadata.result`。
  - 从 `block.content` 提取文本，写入 `metadata.content`。
  - 从 `message.tool_use_result` 提取常见字段：`stdout`、`stderr`、`output`、`error`、`message`、`text`、`content`。
  - 对嵌套对象只做安全读取，不改变 runtime 事件 schema。
- 更新 `apps/tui/src/workflow/sdkEventMapping.test.ts`：
  - failed tool result 带 `tool_use_result.stderr/stdout` 时，映射后的 item metadata 包含这些字段。
  - 只有 `block.content` 时，metadata 包含 `content`，供 Markdown 导出 fallback 使用。

## Test Plan
- 运行 `bun test apps/tui/src/workflow/sdkEventMapping.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`。
- 运行 `bun run desktop:typecheck`。

## Assumptions
- 不改 `ThreadEvent` / `TurnItem` 类型定义。
- 不改工具执行逻辑，只改 SDK message 到 Workflow event 的投影。
- 没有真实输出的工具结果仍只能显示 summary。
