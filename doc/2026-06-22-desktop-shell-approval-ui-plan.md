# 桌面端 Shell 审批 UI 链路修复计划

## 目标

- 让 `PowerShell` / `Bash` 等 shell 工具触发的 `ask` 权限请求在桌面端对话流里显示内联审批卡。
- 用户批准后，审批结果必须回注给当前 headless runtime，让原工具继续执行。
- 用户拒绝后，工具返回明确拒绝消息，不再表现为找不到审批入口。
- 不用 Git 命令白名单绕过问题；`git add`、`git commit` 只是 shell 审批链路的验证样例。

## 当前问题

- `PowerShell` 未命中允许规则时会返回 `passthrough`，通用权限层再转为 `ask`。
- 桌面端 renderer 已有内联审批卡，也能渲染 `pendingPermissions`。
- 真正断点在 headless `canUseTool`：只有 `permissionPromptToolName === "stdio"` 时，`getCanUseToolFn()` 才会把 `ask` 权限转成 `StructuredIO control_request`。
- 桌面端之前没有传 `--permission-prompt-tool stdio`，embedded runtime 也没有传 `permissionPromptToolName: "stdio"`，所以 shell `ask` 直接落成失败 tool result，日志里最终只看到 `This command requires approval`。

## 实现步骤

1. 梳理数据链路：
   - `PowerShellTool.checkPermissions()` 产生 `ask`。
   - headless 输出 `control_request`。
   - `agentRuntime.ts` 调用 `context.requestPermission()`。
   - `agentSession.ts` 发出 `permission_request` 事件。
   - renderer 将请求放入 `pendingPermissions` 并渲染内联审批卡。
   - 用户点击后调用 `respondToPermission()`，runtime 注入 `control_response`。
2. 补测试先行：
   - 在 desktop runtime 测试里覆盖桌面端必须启用 `stdio` 权限提示协议。
   - 保留现有 renderer/workflow 测试，确认 `permission_request` 会进入 `pendingPermissions` 且批准/拒绝后关闭。
3. 修 runtime/session 缺口：
   - subprocess 启动参数增加 `--permission-prompt-tool stdio`。
   - embedded runtime options 增加 `permissionPromptToolName`，调用 `runHeadless()` 时传入 `"stdio"`。
   - 保持 `requestId`、`description`、`input.command` 的现有传递链路。
4. 修 renderer 缺口：
   - 对话页底部显示当前待审批请求，shell 请求展示工具名和命令摘要。
   - 按钮使用现有 `decidePermission()`，支持本次允许、会话总是允许、拒绝。
   - 审批后立即清理本地 pending 状态，等待 runtime 后续 tool result。
5. 验证：
   - 运行涉及 session/runtime/reducer 的定向测试。
   - 运行 `bun run desktop:typecheck`。
   - 如可用，手动触发一个 `git add` 请求，确认内联审批卡出现并可继续执行。

## 后续要做

- 给审批卡补更详细的 diff/命令风险摘要，而不是只展示原始命令。
- 把多个并发审批请求做成队列 UI，而不是永远只显示第一条。
- 为 shell 命令审批增加“始终允许此精确命令/前缀”的细粒度规则展示。
- 后续检查 `subprocess` 和 `embedded` 两种 runtime 是否行为一致，并在 CI 中固定。
