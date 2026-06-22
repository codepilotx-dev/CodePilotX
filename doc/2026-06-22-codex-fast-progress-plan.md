# Codex 快速推进下一步计划

## Summary
- 先收口当前已验收但未提交的 JSON-RPC app-server / ThreadRuntime 生命周期改动，形成一个可回退中文提交。
- 下一轮不要继续扩大 workflow schema，优先打通 Codex 使用面：诊断去重、权限 profile 接入、app-server 桌面桥接。
- 执行前先保存计划到 `doc/2026-06-22-codex-fast-progress-plan.md`，再改代码。

## Key Changes
- 阶段 0：收口当前验收线
  - 跑 `bun test apps/tui/src/appServer/protocol.test.ts apps/tui/src/appServer/server.test.ts apps/tui/src/appServer/registry.test.ts apps/tui/src/workflow/ThreadRuntime.test.ts`。
  - 跑 `bun run test:codex-workflow` 和 `bun run desktop:typecheck`。
  - 如果通过，提交当前工作树里 app-server、ThreadRuntime、package 脚本和相关 doc，commit 用中文：`引入 Codex 风格 JSON-RPC app-server`。

- 阶段 1：Codex context diagnostics 去重
  - 把 `.codex/config.toml`、`AGENTS.md`、`AGENTS.override.md` 解析规则收敛到 core/shared。
  - renderer 只负责通过现有文件 API 读内容，不再维护第二套 TOML/AGENTS 解析逻辑。
  - 保持 Markdown 导出的“Codex 上下文快照”行为不变。

- 阶段 2：权限 profile 接入运行链路
  - 让 desktop permission mode 映射出的 `AgentPermissionPolicy` 不只用于诊断展示，也进入 `canUseTool` 前置判断。
  - 保留现有 permission drawer、hook permission decision、工具级 override。
  - `.codex/config.toml` 的 `approval/sandbox` 本轮先进入诊断和 policy 映射，不直接覆盖用户级 provider/auth 配置。

- 阶段 3：app-server 桌面桥接
  - 增加 `CODEPILOTX_JSON_RPC_APP_SERVER=1` 实验开关。
  - 开关关闭时继续走现有 `desktopApi/onWorkflowEvent`。
  - 开关开启时桌面端并行桥接 JSON-RPC app-server，并验证 `thread/start -> turn/start -> thread/event` 通知流。

## Public Interfaces / Types
- 保持 `ThreadEvent` / `TurnItem` schemaVersion 1，不新增核心字段。
- 保持 JSON-RPC v1 方法集：`initialize`、`thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`turn/rollback`、`item/inject`。
- 新增或复用的诊断 helper 只影响内部 debug/Markdown 导出，不作为 resume 权威来源。

## Test Plan
- 当前线收口：`bun run test:codex-workflow`、`bun run desktop:typecheck`。
- diagnostics 去重：覆盖 root 到 cwd 的 AGENTS 层级、override 优先级、UTF-8 中文读取、非法 TOML 诊断。
- 权限接入：覆盖 `default/auto/bypassPermissions/customConfig` 到 `AgentPermissionPolicy` 的映射，以及 read/write/shell/network/mcp 的 allow/ask/deny。
- app-server 桥接：覆盖 initialize capability、thread event notification、unknown thread JSON-RPC error data、桌面开关关闭 fallback。

## Assumptions
- “验收完成”指当前工作树里的 JSON-RPC app-server / ThreadRuntime 生命周期改动已经功能认可，但尚未提交。
- 本轮目标是快速推进可落地进度，不做 Rust 迁移，不把 workflow event log 当作 resume 权威。
- 计划执行时所有 commit message 使用中文。
