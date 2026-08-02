# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/`，并补充仓库根目录规则。

## Workspace 边界

- `shared/` 保存跨 renderer/preload 的明确契约，`src/` 保存 UI 实现，`test/` 保存 renderer 测试。
- 系统能力只能通过 typed preload bridge 或 Agent client 使用；禁止直接访问 Node、Electron、SQLite、凭据或文件系统。
- RPC wire 契约来自 `@codepilotx/agent-protocol`，thread 领域模型来自 `@codepilotx/shared/thread`。
- Desktop client 稳定入口为 `src/services/desktop-client/index.ts`；入口只负责环境选择、组合和导出。
- 复用现有 `agentRpcClient`、`agentThreadAdapter`、desktop client 和 session-view projection；禁止创建第二套 transport 或状态协议。
- 保留 desktop-first 布局；除非任务明确要求，不新增移动端或窄视口行为。

## 桌面端产品定位

- Renderer 优先提供多项目、多聊天、Review、Artifact、Visualization、Worktree、Scheduled task、通知和系统能力的可视化工作台。
- 所有共享行为继续经过 `desktop-client`、Agent RPC 和 `session-view`；禁止在组件、Hook 或状态仓库内复制 CLI/Agent 逻辑。
- Review pane、文件预览、行级评论和项目导航属于桌面交互层；其数据真源和变更操作仍由共享 service/contract 提供。
- 不在 renderer 中模拟 `codex exec`、Shell 管道、JSONL 或 CI runner；若桌面需要相同底层能力，应通过 Agent service 增加可复用接口并提供桌面交互。
- 跨端功能根据协议 capability 显示、降级或隐藏；不得根据 User-Agent、应用版本字符串或失败结果猜测能力。
- 保留桌面优先布局，不为尚未建立的 CLI/TUI 引入 renderer 兼容分支。

## 数据代际

- Renderer 数据代际只清理明确列出的 CodePilotX localStorage/sessionStorage 键和前缀。
- 禁止调用 `localStorage.clear()` 或删除其他 origin 所有者的数据。
- 数据 epoch 已淘汰旧 UI state；禁止重新加入 v3、legacy plan、旧 Review expansion 或旧单问题兼容分支。

## 测试与验证

- 测试重点是状态转换、client contract 和具体回归，放在现有 `test/` 目录。
- 类型检查：`bun run --cwd apps/desktop/renderer typecheck`
- 完整测试：`bun run --cwd apps/desktop/renderer test`
- UI、lazy import、Vite、TypeScript project reference 或 asset pipeline 变化时运行：`bun run build:renderer`
- 样式变化时运行：`bun run --cwd apps/desktop/renderer css:check`
- 不得为了通过检查而盲目更新 CSS/style/test 基线。
