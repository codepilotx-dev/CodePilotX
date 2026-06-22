# Codex 相关下一轮优化计划

## Summary
- 下一轮建议不要继续扩大 workflow schema，而是把已做的 Codex 风格事件层接到更完整的 Codex 使用面：`AGENTS.md`、`.codex/config.toml`、hooks、MCP、skills、权限 profile、诊断导出。
- 实施前先把本计划保存为 `D:\VueProject\ClaudeCode\doc\2026-06-22-codex-next-optimization-plan.md`，再进入代码修改。
- 优先级：先做配置/指导链路，再做 hooks/MCP/skills 可见性，最后做 workflow 诊断闭环和测试矩阵。
- 参考官方 Codex 面：`AGENTS.md`、`config.toml`、hooks、MCP、skills。

## Key Changes
- Codex 指令链优化：
  - 增加 `AGENTS.md`/`AGENTS.override.md` 发现与合并诊断视图，展示当前 session 实际吃到哪些项目指导。
  - 保持现有项目 `AGENTS.md` 行为，不改变 prompt 注入顺序；只先做可观测和测试。
  - 文档里明确 root 到 cwd 的覆盖关系，避免后续多人改错指导层级。

- `.codex/config.toml` 兼容层：
  - 新增只读解析 helper，读取项目级 `.codex/config.toml`，先支持 `approval`、`sandbox`、`mcp_servers`、`hooks`、`project_root_markers` 的最小子集。
  - 不替换现有 `CODEPILOTX_CONFIG_DIR`、`CLAUDE_CONFIG_DIR` 和 `.claude` 兼容体系。
  - 明确禁止项目级配置覆盖 provider/auth/telemetry/profile 这类用户级设置。

- Codex hooks / MCP / skills 可见性：
  - hooks：先做 hook 配置发现、启用状态、命令预览和错误诊断，不立刻让 hooks 阻断工具执行。
  - MCP：在设置页或调试面板展示当前可用 MCP server、来源层级和连接状态。
  - skills：展示当前加载的 skill 名称、description、来源路径，并在 workflow Markdown 导出里记录本轮触发过的 skills。

- Workflow 诊断闭环：
  - 在现有 `workflowEvents`、tool result metadata、missing turn 诊断基础上，增加“本轮 Codex 上下文快照”导出。
  - Markdown 导出包含：AGENTS 来源、config 来源、permission profile、MCP/skills/hooks 摘要、workflow 一致性诊断。
  - 继续保持 `workflow-events.jsonl` 只是调试来源，不作为 resume 权威状态。

## Interfaces / Types
- 新增内部类型：
  - `CodexGuidanceSource`：记录指导文件路径、层级、是否 override、摘要 hash。
  - `CodexProjectConfig`：只表达支持的 `.codex/config.toml` 子集。
  - `CodexContextDiagnostics`：聚合 guidance/config/hooks/MCP/skills/workflow 诊断结果。
- 不新增外部桌面 IPC API；优先通过已有 session/debug 面板消费。
- 不修改 `ThreadEvent` / `TurnItem` schema；如果必须携带新信息，只放入诊断 helper 输出，不进入核心事件协议。

## Test Plan
- 新增纯函数测试：
  - AGENTS 发现顺序、override 优先级、UTF-8 读取。
  - `.codex/config.toml` 最小解析、项目级禁用字段忽略、非法 TOML 诊断。
  - hook/MCP/skill 诊断输出不影响现有 workflow。
  - Markdown 导出包含 Codex 上下文快照，且表格转义稳定。
- 回归运行：
  - `bun test packages/core/src/agent/workflow.test.ts apps/tui/src/workflow/sdkEventMapping.test.ts`
  - `bun test apps/desktop/src/renderer/features/session/workflowMarkdown.test.ts`
  - `bun run desktop:typecheck`

## Assumptions
- 当前阶段仍不引入 Rust app-server、不引入 JSON-RPC server、不把 event log 当恢复权威。
- 当前阶段目标是 Codex 风格“可观测、可配置、可诊断”，不是完全复制 Codex CLI 架构。
- commit 使用中文，例如：`补充 Codex 项目上下文诊断`。
