# Codex 协议化工作流总计划

## Summary
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-codex-protocol-lifecycle-plan.md`，再进入代码修改。
- 本计划按 5 个方向推进：Workflow 协议契约化、ThreadRuntime 补齐 Codex 生命周期语义、事件日志与 transcript 一致性校验、Codex 风格权限配置、测试体系补强。
- 总原则：继续保留 TypeScript/Bun 主循环，不迁移 Rust app-server，不引入 JSON-RPC server；先把现有行为稳定投影成 Codex 风格 `thread/turn/item/event` 边界。

## 完成目标
- Workflow 事件协议有稳定契约测试，核心事件顺序、字段和兼容性可被测试锁住。
- `ThreadRuntime` 从当前 `start/send/interrupt` facade 扩展为更接近 Codex 的生命周期入口，至少具备 resume、fork、rollback、inject item 的内部 API 雏形。
- 桌面 session 可对 `workflowEvents` 与 transcript/session snapshot 做只读一致性诊断，发现差异但不参与恢复。
- 权限配置从工具局部判断上提一层，形成 session/thread 级 permission profile，并继续兼容现有 permission drawer 与工具级 override。
- 测试从零散功能测试升级为协议、生命周期、权限和恢复诊断的核心行为测试组。

## Key Changes

### 1. Workflow 协议契约化
- 在 `packages/core/src/agent/workflow.ts` 周边补充协议 fixture/helper，固定最小合法事件链：
  - `thread.started`
  - `turn.started`
  - `item.started | item.updated | item.completed`
  - `turn.completed | turn.failed | turn.interrupted`
- 为 `ThreadEvent` / `TurnItem` 增加契约测试，覆盖 schemaVersion、eventId、sequence、threadId、turnId、item id、createdAt 的稳定归一化行为。
- 对工具、权限、文件变化、错误四类 item 分别建立 fixture，确保 UI/SDK/桌面消费的是同一套语义。
- 不在本阶段扩大 schema；如果必须新增字段，只放在 `metadata`，并补兼容测试。

### 2. ThreadRuntime 补齐 Codex 生命周期语义
- 在 `apps/tui/src/workflow/ThreadRuntime.ts` 增加内部 lifecycle API：
  - `resumeThread(threadId, snapshotOrState)`：恢复 runtime facade 状态，不把 workflow event log 作为模型上下文来源。
  - `forkThread(sourceThreadId, options)`：创建新 thread，继承必要 metadata，但使用新的 threadId。
  - `rollbackTurn(threadId, turnId)`：标记指定 turn 后的 runtime 状态回退，先只影响 facade state 和事件输出，不改 transcript。
  - `injectItem(threadId, turnId, item)`：允许调试或兼容层注入 client-facing item event。
- 每个 API 都产出明确的 `ThreadEvent`，并保持 `QueryEngine/query()` 主循环不变。
- 桌面端暂不直接暴露这些 API 给用户；先为后续 UI、SDK 和恢复能力建立稳定实现边界。

### 3. 事件日志与 transcript 一致性校验
- 新增只读诊断 helper，将当前 session 的 `workflowEvents` replay 成派生状态：
  - turn 状态
  - tool runs
  - pending permissions
  - final response 摘要
  - failure/interrupted 状态
- 将 replay 结果与现有 transcript/session snapshot 派生状态对比，输出 diagnostics：
  - 缺失 `turn.completed`
  - tool call/result 未配对
  - permission request 没有 decision
  - workflow final response 与 transcript 最终 assistant message 不一致
  - sessionId/threadId 混入
- 诊断结果只展示在调试面板或复制 Markdown 中，不参与 resume，不阻断 UI。
- 保持 `workflow-events.jsonl` 是调试日志；session 恢复仍以现有 transcript/snapshot 为权威。

### 4. Codex 风格权限配置
- 在 core 层整理 session/thread 级 permission profile，表达：
  - approval mode
  - sandbox policy
  - filesystem/network/tool scope
  - per-tool override
- 将现有工具权限判断适配为读取 profile + 工具局部规则的组合，不移除现有 `canUseTool`、hook permission decision 和 permission drawer。
- 桌面设置层先只消费现有设置并映射到 profile，不做大规模 UI 重构。
- 增加 `.codex/config.toml` / `CODEX_HOME` 兼容的后续预留点，但本阶段不替换 `CODEPILOTX_CONFIG_DIR`、`CLAUDE_CONFIG_DIR` 和 `.claude` 兼容体系。

### 5. 测试体系补强
- 建立核心测试分组：
  - 协议契约：`workflow.test.ts` 覆盖事件归一化、fixture、schema 兼容。
  - 生命周期：`ThreadRuntime` 覆盖 start/send/interrupt/resume/fork/rollback/inject。
  - 桌面派生：workflow replay、toolLog、pendingPermissions、Markdown 诊断。
  - 权限：permission profile 与现有工具权限、hook、drawer 行为兼容。
  - 回归：sessionPersistence、workflowProjection、sdkEventMapping 保持现有行为。
- 每阶段都先补纯函数测试，再接入 UI/runtime，避免只靠手动桌面验证。

## Test Plan
- 第一阶段运行：
  - `bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts`
- 第二阶段新增并运行：
  - `bun test apps/tui/src/workflow/ThreadRuntime.test.ts`
- 第三阶段运行：
  - `bun test apps/desktop/src/main/sessionPersistence.test.ts apps/desktop/src/renderer/features/session/workflowViewPatch.test.ts apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
- 第四阶段运行：
  - `bun test packages/core/src/agent/permissions.test.ts`
- 每个阶段收尾运行：
  - `bun run desktop:typecheck`
  - 关键跨层修改后运行 `bun run typecheck`

## Assumptions
- 不把 workflow event log 作为 resume 权威来源，直到事件协议和 replay 诊断稳定。
- 不一次性让所有 UI 改订阅 `ThreadEvent`；旧 `AgentRuntimeEvent` 继续作为 fallback。
- 不引入 Rust core、app-server、JSON-RPC server。
- 不破坏现有 Claude/CodePilotX 配置兼容；Codex 风格配置先做抽象和映射，不做强迁移。
- commit 使用中文，例如：`完善 Codex 风格工作流协议生命周期`。

## 后续实施顺序
1. 先实现 Workflow 协议 fixture 和契约测试，锁住事件边界。
2. 再补 `ThreadRuntime` 生命周期 API 和测试。
3. 然后做 workflow replay 与 transcript/snapshot 只读一致性诊断。
4. 接着抽象 permission profile，并接入现有权限判断链路。
5. 最后清理测试命名、文档索引和调试 Markdown 输出，让后续阶段可继续按协议演进。
