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

## 样式契约与白名单

- 所有颜色任务必须先阅读 `docs/design/renderer-color-system.md`。Feature 只能消费 `--cpx-sys-color-*` 公共语义颜色；颜色类 `--cpx-comp-*` 只属于基础组件内部。选择顺序固定为“业务 tone → surface → foreground/border → 交互态”，找不到语义时先扩展规范，禁止按页面或视觉外观临时命名颜色。
- `accent` 只表示选择、焦点与主要交互；`info/success/warning/danger/skill` 分别表示中性信息、成功、注意、危险和能力身份。颜色不得成为唯一状态线索，同一容器最多使用一个业务 tone。
- Feature 禁止裸 `hex/rgb/hsl` 和自行混合多个语义色。色盘、数据可视化、第三方渲染等必要算法只能使用 `style-contracts.json` 中精确且带原因的例外；例外失效时必须删除。
- 界面全面坚持简约扁平风格：底板、卡片、面板与常规容器零阴影，纯靠 1px 细微边框和底色阶区分；仅浮层（Modal/Popover/Toast/悬浮 Composer）使用克制纯深色微投影（`--cpx-sys-shadow-floating`），遮罩一律使用深色半透明（`--cpx-comp-modal-scrim`）加轻柔化，严禁暗色发白光晕或白雾蒙层。
- `style-contracts.json` 中的白名单是经过审查的固定例外，不是检查失败后的自动基线；禁止机械增加计数、批量刷新基线或保留已经失效的条目。
- `literalLineHeightAllowlist` 只允许收录行高直接参与固定桌面控件几何的场景，例如按钮、徽标、菜单、标签、固定控制条和 Review diff。Markdown、会话正文、设置说明、编辑器文本等可缩放内容必须使用 `--type-line-*` 语义 token，或基于语义 token 的 `var()`、`calc()`、`min()`、`max()`、`clamp()`，不得加入白名单。
- `tailwindLeadingAllowlist` 默认保持为空；TSX 不得通过新增 `tw:leading-*` 绕过语义排版。新增排版角色必须复用或扩展现有 Tailwind 主题、设计 token 或语义样式层。
- 其他 Renderer 样式白名单只允许第三方运行时变量、明确的 lazy stylesheet 边界，或无法由正常层叠替代的必要兼容覆盖；普通业务样式、可迁移到现有组件或 token 的声明不得加入。
- 遇到 `css:check` 失败时，先定位具体文件、选择器和值，优先改为现有语义 token 或组件。确需新增白名单时，只增加最小文件级条目或计数，并在同一变更的代码说明或变更记录中写明固定几何、外部契约或兼容原因。

## 测试与验证

- 测试重点是状态转换、client contract 和具体回归，放在现有 `test/` 目录。
- 类型检查：`bun run --cwd apps/desktop/renderer typecheck`
- 完整测试：`bun run --cwd apps/desktop/renderer test`
- UI、lazy import、Vite、TypeScript project reference 或 asset pipeline 变化时运行：`bun run build:renderer`
- 样式变化时运行：`bun run --cwd apps/desktop/renderer css:check`
- 不得为了通过检查而盲目更新 CSS/style/test 基线。
