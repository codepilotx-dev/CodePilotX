# 修复桌面端本地写代码权限计划

## Summary
- 根因假设：桌面端 `workspace-write`/`auto` 语义没有真正自动允许普通工作区文件写入，写入请求仍走 `ask`；当权限弹窗/回传链路不可用时，就表现为无法修改本地文件。
- 先做一版可用修复：桌面端自动允许“工作区内普通代码文件”的 `Edit`/`Write`/`MultiEdit`/`NotebookEdit`，但敏感路径仍走权限确认。
- 计划文件执行时先保存到 `doc/2026-06-22-desktop-workspace-write-permissions-plan.md`，再改代码。

## Key Changes
- 修改 `apps/desktop/src/main/agentSession.ts`：
  - `requestPermission()` 调用 `resolveDesktopPermissionPolicyDecision(policy, request, this.workspacePath)`。
  - 新增路径判断 helper：只对 `workspacePath` 内的写入路径自动 allow。
  - 自动 allow 范围：`workspace-write` profile 且 `approvalMode` 为 `prompt`、`auto-review` 或 `auto-approve-edits`。
  - 继续不自动 allow：工作区外路径、UNC/网络路径、`.git`、`.claude`、`.vscode`、`.idea`、常见 shell/config 敏感文件。
  - `customConfig` 继续尊重 config，不从桌面层覆盖。
  - `bypassPermissions` 保持 full access 现有行为。

## Public Interfaces
- `resolveDesktopPermissionPolicyDecision()` 签名增加可选 `workspacePath?: string`。
- 不改 TUI tool schema，不改 `FileEditTool`/`FileWriteTool` 输入输出。
- 不改 CLI 权限模式参数；桌面 subprocess 和 embedded-headless 都通过同一个桌面权限决策生效。

## Test Plan
- 更新 `apps/desktop/src/main/agentSession.test.ts`：
  - `default/workspace-write` 自动允许工作区内 `Edit`。
  - `auto/workspace-write` 自动允许工作区内 `Write`。
  - 工作区外写入返回 `null`，继续请求权限。
  - `.git/config`、`.claude/settings.json` 等敏感路径返回 `null`。
  - `customConfig` 对写入返回 `null`。
  - `bypassPermissions` 仍直接 allow。
- 运行：
  - `bun test apps/desktop/src/main/agentSession.test.ts packages/core/src/agent/permissions.test.ts apps/desktop/src/main/agentRuntime.test.ts`
  - `bun run desktop:typecheck`
- 已做的只读验证：当前相关测试 8 个通过，确认现有 `auto` 没覆盖自动写入语义。

## Assumptions
- “能正常写代码”优先解释为：能直接修改当前已选择 workspace 内的普通项目文件。
- 首版不放开任意电脑路径和任意命令；需要全盘读写/联网命令时仍使用现有“完全访问权限”模式。
- 若后续还发现 shell/build 命令也被卡，再追加一轮：为工作区内安全命令建立桌面端自动 allow 规则，而不是把所有 shell 全局放开。
