# 后续优化总计划

## Summary
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-next-optimization-plan.md`，再进入代码修改。
- 优先收尾 Workflow 第二阶段：让桌面端 `toolLog` 和 `pendingPermissions` 稳定从 `ThreadEvent` 派生，并保留旧事件 fallback。
- 然后补 Workflow 调试体验：事件卡片一键复制 Markdown、诊断信息可见化、日志排查更方便。
- 最后再推进低耦合 UI 设置、测试补强和 prompt 缓存优化。

## Key Changes
- Workflow 状态接管收尾：
  - 完成 `deriveWorkflowViewPatch` 接入，确保有 workflow 工具事件时接管 `toolLog`，无 workflow 工具事件时保留旧 `toolLog`。
  - 权限请求继续从 workflow 派生 `pendingPermissions`，并保持现有 permission drawer 和 `respondToPermission()` 流程不变。
  - 不修改 `QueryEngine`、`query()`、工具执行顺序、compact、transcript 恢复逻辑。

- Workflow 事件卡片增强：
  - 在 `WorkflowDebugTimeline` 增加 `复制 MD` 按钮。
  - 新增纯函数 helper，将当前 session 的最近 60 条 workflow 事件导出为 Markdown。
  - Markdown 包含 sessionId、事件总数、诊断汇总、事件表格：`时间 | 类型 | thread | turn | item | detail`。
  - 如果用户点过 `检查日志`，复制内容追加日志诊断小节。
  - 诊断区明确展示重复事件、未完成工具、乱序事件数量。

- 测试补强：
  - 补 `workflowReducer` / `workflowViewPatch` / Markdown 导出 helper 的纯函数测试。
  - 后续继续补关键行为测试：provider selection、DeepSeek/MiniMax adapter、tool result 回灌、permission request、desktop runtime event 映射、session persistence。

- 后续独立优化：
  - 落地外观页字号设置：`UI 字号`、`代码字号` 全局持久化，并收敛 CSS 硬编码字号。
  - 单独规划 prompt 缓存切片优化：检查静态/动态 boundary、MCP instructions delta、动态 prompt 段是否击穿缓存。

## Test Plan
- 运行：
  - `bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts apps/desktop/src/shared/workflowReducer.test.ts apps/desktop/src/renderer/features/session/workflowEventDedup.test.ts apps/desktop/src/renderer/features/session/workflowViewPatch.test.ts`
  - 新增后运行 `bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
  - `bun run desktop:typecheck`
- 手动验证：
  - Workflow 事件卡片能正常显示当前 session 事件。
  - 点击 `复制 MD` 后粘贴内容可读，表格不被换行或 `|` 破坏。
  - `toolLog` 在 workflow 工具事件存在时由 workflow 派生，无事件时旧日志不丢。
  - permission request 出现时 drawer 仍自动打开，allow/deny 后 pending 权限正确移除。
  - 日志诊断能帮助定位重复、乱序、缺 result 的事件。

## Assumptions
- 当前阶段不做 Rust app-server、不引入 JSON-RPC server。
- 当前阶段不把 workflow event log 作为 resume 权威来源，只做调试和只读诊断。
- 不一次性把所有 UI 改成事件订阅，继续保留旧 `AgentRuntimeEvent` fallback。
- `log.txt` 不纳入提交；现有 `memory/` 删除和其他无关工作树改动不处理。
- commit 使用中文，例如：`优化 Workflow 调试与状态派生`。
