# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/renderer/`，并补充仓库根目录规则。本文件只能增加 Renderer 实现细则，不得弱化根规则。

## Workspace 与客户端边界

- `shared/` 保存跨 Renderer/preload 的明确契约，`src/` 保存 UI 实现，`test/` 保存 Renderer 测试。
- 系统能力只能通过 typed preload bridge 或 Agent client 使用。禁止直接访问 Node、Electron、SQLite、凭据或文件系统。
- RPC wire 契约来自 `@codepilotx/agent-protocol`，thread 领域模型来自 `@codepilotx/shared/thread`。
- Desktop client 稳定入口为 `src/services/desktop-client/index.ts`。入口只负责环境选择、组合和导出。
- 必须复用现有 `agentRpcClient`、`agentThreadAdapter`、desktop client 和 session-view projection，禁止创建第二套 transport 或状态协议。
- Renderer 优先提供多项目、多聊天、Review、Artifact、Visualization、Worktree、Scheduled task、通知和系统能力的桌面可视化工作台。
- 所有共享行为继续经过 `desktop-client`、Agent RPC 和 `session-view`，禁止在组件、Hook 或状态仓库内复制 CLI/Agent 逻辑。
- Review pane、文件预览、行级评论和项目导航属于桌面交互层；其数据真源和变更操作仍由共享 service/contract 提供。
- 禁止在 Renderer 中模拟 `codex exec`、Shell 管道、JSONL 或 CI runner。桌面需要相同底层能力时，必须通过 Agent service 增加可复用接口并提供桌面交互。
- 跨端功能必须根据协议 capability 显示、降级或隐藏，禁止根据 User-Agent、应用版本字符串或失败结果猜测能力。
- 必须保留 desktop-first 布局。除非任务明确要求，禁止新增移动端、窄视口或未来 CLI/TUI 的 Renderer 兼容分支。

## 数据代际

- Renderer 只能清理明确列出的 CodePilotX localStorage/sessionStorage 键和前缀。
- 禁止调用 `localStorage.clear()` 或删除其他 origin 所有者的数据。
- 数据 epoch 已淘汰旧 UI state。禁止重新加入 v3、legacy plan、旧 Review expansion 或旧单问题兼容分支。

## 组件与样式契约

- 所有文字动作按钮及“图标 + 文字”动作按钮必须复用 `components/ui/Button`，并使用统一高度、内边距、圆角、边框和主题自适应中性背景。禁止通过 primary/secondary 变体区分视觉层级。
- 危险、选中、禁用、加载和焦点状态可以保留语义差异。纯图标工具按钮、导航、标签页、分段控件和开关必须使用各自组件，禁止套用动作按钮容器。
- 所有 Renderer Token 任务必须先阅读 `docs/design/renderer-token-system.md`；颜色任务还必须阅读 `docs/design/renderer-color-system.md`。
- 非颜色 Token 的选择顺序固定为“内容角色 → 组件/布局角色 → 密度 → 状态/动效 → 层级”。Feature 只能使用公共 `--cpx-sys-*`、拥有选择器内的动态局部变量和颜色契约允许的组件槽位，禁止消费 `--cpx-comp-*` 几何 Token。
- 排版使用 `caption / label / body-sm / body / body-lg / heading-sm / heading-md / heading-lg / code`。间距使用 4px 开放刻度或明确 `--cpx-sys-layout-*`。圆角使用 `indicator / compact / control / container / floating / pill`。动效使用 `instant / feedback / exit / state / enter / panel / loading`。全局层级按 `local / sticky / dock / composer / modal / popover / tooltip / toast` 递增。
- 禁止为页面、实例或历史像素值创建平行 Token。
- Feature 只能消费 `--cpx-sys-color-*` 公共语义颜色；颜色类 `--cpx-comp-*` 只属于基础组件内部。选择顺序固定为“业务 tone → surface → foreground/border → 交互态”。找不到语义时必须先扩展规范，禁止按页面或视觉外观临时命名颜色。
- Workbench 大区域必须通过独立的 `--cpx-sys-color-workbench-*` 区域 token 取色，禁止在布局 Feature 中直接绑定基础 surface。
- 窗口菜单栏与左侧栏属于应用 Chrome，默认映射 `surface-recessed`。`.desktop-workspace`、右侧 Dock 与底部 Panel 属于工作区，Dock/Panel 的独立区域 token 默认必须跟随 `workbench-main-bg`。
- 工作区内部工具栏保持透明并继承工作区背景。代码块、输入框、浮层和文件树子区域继续使用各自局部层级 token。区域默认同色不代表合并 token。
- Workbench 大区域之间的持久结构边界使用 `--cpx-sys-color-border-default`；toolbar、章节、卡片及容器内部细分隔使用 `--cpx-sys-color-border-subtle`。同一物理边界只能由一个容器绘制，禁止父子元素叠加边框；强调和焦点不得通过继续加深结构边界表达。
- `accent` 只表示选择、焦点与主要交互；`info/success/warning/danger/skill` 分别表示中性信息、成功、注意、危险和能力身份。颜色不得成为唯一状态线索，同一容器最多使用一个业务 tone。
- Feature 禁止裸 `hex/rgb/hsl` 和自行混合多个语义色。色盘、数据可视化、第三方渲染等必要算法只能使用 `style-contracts.json` 中精确且带原因的例外；例外失效时必须删除。
- 静态用户消息使用 `--cpx-sys-color-message-user-bg`；不得借用 `hover`、`active`、`selected` 等交互状态，也不得通过修改 `surface-panel` 影响全局容器。线程环境摘要宽度属于 Feature 局部布局变量，不得提升为 system token；定位外壳、主区占位和摘要内容必须消费同一宽度来源。
- 界面必须保持简约扁平。底板、卡片、面板和常规容器零阴影，只能通过 1px 细微边框和底色阶区分。
- 持续覆盖工作区的悬浮 Composer 和绝对定位线程环境摘要只能使用唯一的 `--cpx-sys-shadow-prominent`；Modal、Popover、Dropdown、Toast 等瞬时浮层使用 `--cpx-sys-shadow-floating`。同一视觉树只能有一个 elevation owner，Popover 内嵌摘要不得重复投影。Feature 禁止拼接重复阴影值或创建同值的页面/组件 system token。遮罩必须使用深色半透明 `--cpx-comp-modal-scrim` 并轻柔化，禁止暗色发白光晕或白雾蒙层。

## 样式白名单

- `style-contracts.json` 中的白名单是经过审查的固定例外，不是检查失败后的自动基线。禁止机械增加计数、批量刷新基线或保留已经失效的条目。
- `featureTokenContract` 的例外必须精确到类别、文件、属性和值，并写明不可替代的运行时几何、Diff 坐标、动态色板或第三方契约。局部变量必须由拥有布局的 Feature 选择器声明；例外与局部变量失效后必须立即删除。
- `literalLineHeightAllowlist` 只允许固定桌面控件几何，例如按钮、徽标、菜单、标签、固定控制条和 Review diff。
- Markdown、会话正文、设置说明、编辑器文本等可缩放内容必须使用 `--type-line-*` 语义 token，或基于语义 token 的 `var()`、`calc()`、`min()`、`max()`、`clamp()`。禁止加入行高白名单。
- `tailwindLeadingAllowlist` 默认保持为空。TSX 禁止通过新增 `tw:leading-*` 绕过语义排版。
- 新增排版角色必须复用或扩展现有 Tailwind 主题、设计 token 或语义样式层。
- 其他 Renderer 样式白名单只允许第三方运行时变量、明确的 lazy stylesheet 边界，或无法由正常层叠替代的必要兼容覆盖。
- 遇到 `css:check` 失败时，必须先定位具体文件、选择器和值，并优先改为现有语义 token 或组件。确需新增白名单时，只能增加最小文件级条目或计数，并在同一变更的代码说明或变更记录中写明固定几何、外部契约或兼容原因。

## Windows 标题栏

- `.desktop-menubar` 的最终计算背景色是 Windows 标题栏颜色真源，透明 Window Controls Overlay 必须直接透出该背景。
- Renderer 菜单栏高度 token 必须固定为 `36px`，并与 Windows 原生窗口控制区一致。禁止重新依赖 DOM 实测高度或 `titlebar-area-height` 回写。
- 修改菜单栏高度、标题栏主题 token、主题派生色或 Workbench 区域色时，必须同步检查 Renderer token、最终计算样式和 Electron overlay。
- 标题栏变化必须在 Windows 浅色、深色和自定义主题下验证无颜色断层、无高度跳变，并确认原生窗口按钮行为不变。

## 测试与验证

- 测试重点是状态转换、client contract 和具体回归，放在现有 `test/` 目录。
- 类型检查：`bun run --cwd apps/desktop/renderer typecheck`。
- 完整测试：`bun run --cwd apps/desktop/renderer test`。
- UI、lazy import、Vite、TypeScript project reference 或 asset pipeline 变化时运行：`bun run build:renderer`。
- 样式变化时运行：`bun run --cwd apps/desktop/renderer css:check`。
- 禁止为了通过检查而盲目更新 CSS、style 或 test 基线。
