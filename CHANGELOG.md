# Changelog

所有显著的变更均记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [SemVer](https://semver.org/lang/zh-CN/)（含预发布后缀）。

> 当前产品基线为 `0.2.0-beta.1`，此前历史不追溯。

## Unreleased

### Added

- [agent/desktop/renderer] 集成官方 MiniMax CLI 的一键安装、更新与卸载，自动跟随 API Key Hub 当前生效的 MiniMax Coding Plan Key，并将 mmx Skills 动态接入 Agent。
- [desktop] 新增可恢复的本地自动化调度、任务管理与运行收件箱。
- [agent] 增加兼容 Codex manifest 的内置插件发现、启停与插件 Skill 接入，并明确用户插件缓存随 CodePilotX 数据目录迁移。
- [desktop/renderer] 接入真实的内置任务规划插件，并将 Browser 等尚未接入能力的 Featured 插件统一显示为暂不可安装。
- [desktop] 支持独立启动并发现开发 Agent，多个完整桌面窗口可复用同一 Agent，并可将当前聊天在新窗口中打开。
- [desktop/renderer] 为 Composer 文件变更汇总增加会话级 Diff 文件预览，支持查看逐文件增删统计并点击定位到 Review。
- [desktop/renderer] 增加侧边栏会话标记为未读及已读切换功能，并持久化同步会话行、Bell 与活动时间线状态。
- [agent] 新增 HarnessCompositionIdentity、HarnessToolComposition、HarnessTurnComposition、HarnessTurnContext、HarnessStepContext 类型及相关纯函数，实现 Agent Turn 组合身份计算、上下文构建与工具 envelope 校验。
- [desktop] 新增侧边栏“查看活动”，集中展示进行中、待处理、未读及最近七天会话，并支持来源筛选和增量加载。
- [Agent/desktop/renderer] 模型目录统一接入 models.dev，在保留 Pi 原生执行、用户自定义 Provider 与加密凭据的同时，自动启用安全的 OpenAI-compatible Provider，并为离线缓存和未适配协议提供明确状态。
- [desktop/renderer] 支持 GitHub 风格的 Markdown 提示块（Alerts / Callouts，支持 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]`）：在正文会话时间线与右侧 Markdown 富文本编辑器/预览中统一渲染色彩边框、图标徽标与专属警示色系，富文本编辑中聚焦首行可直接修改围栏标签。
- [development] 新增 CodePilotX 项目级代码审查、推送前检查、文档规范和简化审计 Skills，使 Agent 按仓库架构与验证契约执行常见工程工作流。
- [Agent/desktop/renderer] 新增全局模型健康测试，可用活动凭据并发执行真实最小请求、实时查看模型延迟与安全失败分类、取消批次及逐模型重试，并将 Provider 连接测试统一为真实探针。
- [Agent/desktop/renderer] 新增 Codex 式本地文件与目录上下文：图片按发送时快照保存，普通文件和目录以任务级只读路径引用接入 Agent，并支持安全的应用内预览与目录浏览。
- [desktop] 新增基于 SenseVoice GGUF 的本地语音听写、麦克风选择和后台模型安装，录音仅临时处理且不会自动发送。
- [desktop/renderer] 新增历史消息与待发送图片、文本附件的右侧预览，支持图片缩放、按类型美化文本及安全下载到系统 Downloads 目录。
- [desktop] 支持在主窗口按 F12 切换开发者工具控制台，并避免长按按键导致重复开关。
- [desktop/renderer] 新增 `/new` 两种真实资源门禁（Renderer 静态入口与 coding/working/chat 交互首屏），以显式模块清单定位首屏必经 chunk，并在优化完成后按实测值收紧上限，防止首屏体积回退。
- [desktop/renderer] 在入口 JS 与主 CSS 就绪前保持静态启动遮罩（复用 Electron 鲸鱼图标视觉），仅在真实 ProseMirror 编辑器可输入后淡出，并在 reduced-motion、离开 `/new` 与 20 秒超时场景安全退出。
- [desktop/electron] 在 Electron 性能测试的 cold start 中新增 `new-route-ready` 观测样本（真实 Composer 可输入、建议面板与字体、同源 JS/CSS 解码字节），本轮仅观测不设硬预算。
- [desktop] 外观设置补齐真实系统字体与字体样式选择：preload 新增类型化 `listSystemFonts()`（Local Font Access 只返回 family/fullName/postscriptName/style，字段限长、去重、稳定排序，不支持/拒绝/失败安全降级为自由文本输入）；主题设置保留式升级为 V7（新增可空 `uiFace`/`codeFace`，清除时显式持久化 `null`，V1–V5 历史重置策略与高版本拒绝覆盖不变）；新增主题字体加载工具，以唯一 alias 注册本地 face 并置于原家族之前，加载失败自动回退；UI 字体展示全部家族、代码字体按 Canvas 等宽检测过滤，默认 face 只保存家族；“偏好设置”顺序对齐 Codex：指针光标、减少动态效果、界面字号、代码字号、差异标记、字体平滑（仅 macOS）。
- [Agent/desktop/renderer] 统一三种上游协议（OpenAI Responses / OpenAI Completions / Anthropic Messages）的富工具结果：在 shared thread 增加可选 `resultBlocks`（text / citation / json / artifact）与完成元数据 `completion`，PiEventAdapter 将工具结果安全投影为同一 canonical item/event；history schema 前向迁移至 33，新增独立 `item_artifacts` 表与受控 blob 存储，新增 `artifact/read` RPC 与 `artifacts.read.v1` capability（跨 thread / 未知 ID / 非法定位拒绝，缺表环境降级 capability）；renderer 在工具卡片渲染四类结果块，图片 artifact 复用附件预览、其他类型为通用文件项，并按状态展示已取消的会话/轮次。
- [agent/runtime] 新增 `runtime_composition_plans` 表（history schema 34）与 RuntimeCompositionService/Repository，持久化 Turn 的模型、权限、Skills、MCP、工具和 Prompt 快照；缺表环境 fresh turn 走 ephemeral、恢复时 fail-closed。
- [agent/desktop] 补齐工作目录、会话 ID 与系统深链复制，支持 CodePilotX Agent 分页读取关联会话，并为外部 Agent 提供按会话 ID 查询的 SQLite 只读语义视图。

### Changed

- [desktop/renderer] 阶段三将 Coding、Working 与 Chat 新建页的 Prompt 输入面改为 Oreo 式不透明平面表面，并将常驻建议卡和工具条收敛到容器圆角语义。
- [desktop/renderer] 阶段二按 Oreo Agentic UI 收敛菜单栏与侧栏密度、平面滚动标题和账号头像入口，同时保持 Windows 标题栏、导航与工作区布局契约。
- [desktop/renderer] 阶段一将默认明暗主题、首屏回退与基础组件样式收敛到 Oreo Agentic UI 的中性视觉基线，并保留已有用户主题和桌面交互契约。
- [desktop/renderer] 为独立置顶会话补充会话图标，并将侧栏长标题改为静态渐隐与更舒缓的悬停滚动。
- [desktop/renderer] 将全局界面收敛为 Codex 式 12/13/14 正文刻度、445/500/600 字重与统一前景色层级，改善会话、侧栏、设置和工作台的信息重点。
- [agent/desktop/renderer] 将工具执行时间线升级为 Codex 风格的语义活动流：由 Agent 统一分类读取、搜索、文件变更、命令、技能、网页和集成活动，Renderer 使用 `cpx-agent-activity*` 展示稳定聚合、状态文案、可打开文件链接及折叠明细，同时兼容旧历史记录。
- [desktop/renderer] 将会话组并入 Renderer 静态入口，使全部主窗口一级页面和所有设置页面随桌面启动加载，消除首次导航时的异步分块等待。
- [desktop/renderer] 在插件示例提示词中展示对应的真实插件图标，使提示词胶囊与 Codex 的身份标识结构一致。
- [desktop/renderer] 固定插件懒加载样式的级联层顺序，避免 reset 层覆盖示例提示词的毛玻璃按钮背景。
- [desktop/renderer] 为插件示例提示词增加 Codex 风格的半透明毛玻璃胶囊，使提示内容与图片背景形成清晰层次。
- [desktop/renderer] 将插件示例提示词横幅改为 Codex 风格的紫色图片背景，并以居中的提示词胶囊保持明暗主题下的可读性。
- [agent/desktop/renderer] 将插件详情重构为 Codex 风格的宽幅产品页，展示清单长描述、示例提示词、技能与信息，并支持从真实提示词立即试用。
- [desktop] 将侧边栏项目、置顶项和组内任务排序改为同组 Reorder，拖动时实时让位并在松手后保存新顺序。
- [desktop/renderer] 将 MiniMax CLI 插件的临时线框图标替换为正式图片资源。
- [desktop] 将自动化建议区分隔线移至章节顶部并移除标题内边距。
- [desktop/renderer] 为自动化建议列表增加 5px 项间距，使相邻建议卡片保持清晰分隔。
- [desktop/renderer] 为自动化建议列表项增加 5px 内边距，避免内容紧贴悬停区域边缘。
- [desktop/renderer] 移除自动化建议按钮的额外内边距，使建议内容布局更紧凑。
- [desktop] 恢复自动化建议列表的宽松行距、正文层级与章节分隔。
- [desktop] 恢复自动化全部页无任务时的空状态指引，并与建议模板同时展示。
- [desktop] 自动化工作台对齐 Codex 的任务列表、建议区、状态筛选与空状态布局。
- [desktop/renderer] 让插件与技能首页完整继承统一一级页面的标题、说明、搜索、内容轴和纵向间距，仅在目录业务区域保留 Codex 式专属样式。
- [desktop/renderer] 收紧插件目录的图标与文字尺寸，将 Computer Use 等方形图片裁剪到图标容器圆角内，并为已安装图标上移动效恢复顶部缓冲。
- [desktop/renderer] 按 Codex 插件目录结构重做插件与技能主页面，增加真实图标的已安装架、紧凑透明双列目录、分类筛选及可深链的页内详情。
- [desktop/renderer] 按 Codex 列表式信息架构统一项目、会话组、自动化与插件一级页面，复用共享宽版内容轴并收紧标题、说明与页面留白。
- [desktop/renderer] 全面重构会话组（Session Groups）工作台视觉与交互：引入现代引导大厅（Hero Banner 与三大核心特性）、统一 SearchInput 搜索过滤与左侧列表卡片元数据、升级成员添加为带搜索的 Select 下拉组件，并优化步骤时间线状态指示、校验徽章与 Diff 折叠预览。
- [session-group] 将任务看板替换为跨项目会话组，支持组内共享步骤、修改、验证、失败来源和精确 Diff 引用。
- [desktop/renderer] 将供应商目录、连接、凭据和模型管理从主导航迁入“设置 → 集成 → 供应商”，并保留旧地址重定向。
- [desktop/renderer] 将全局输入框与多行文本框的基础样式调整为直角边框。
- [desktop/renderer] 将会话组的“新建”操作从列表标题移至工作区右上角，保持页面级动作位置一致。

- [desktop/renderer] 将 Chat、Working 与 Coding 新建首页按 Codex/ChatGPT 参考逻辑收敛为聚焦布局，恢复 Coding 鲸鱼与四张建议卡边界，并将 Working 建议移出首屏。
- [desktop/renderer] 将 Renderer CSS 资源门禁改为显式基线、软告警与硬失败分层，并将会话组隔离为独立路由资源预算。
- [desktop/renderer] 为 Composer 思考强度滑块增加连续拖动与轻磁吸，改用合成层位移和填充缩放消除拖动迟滞，并将 Codex 式弹簧阻尼限制在 Thumb 按压反馈上。

- [desktop/renderer] 建立完整的 2xs–4xl/full 圆角基础刻度并分阶段迁移 Renderer 组件，使普通控件、列表、菜单、消息与高层级浮动表面恢复 Codex 式层级，同时限制大圆角仅用于明确的 prominent 表面。
- [desktop/renderer] 将 Composer 模型、推理强度与提供商整合为 Codex 风格的简洁/高级选择器，使打开态 Chip 与弹层对齐并居中，按 Switch 语义统一滑杆前景与背景并收紧高级按钮，修复双层 Hover、纵向切换、动态高度空白、悬停 Flyout、Provider 连续选择及拖动档位回跳，同时保留“更高效 / 更智能”端点提示。
- [desktop/renderer] 建立主题自适应的圆角光学校正与 prominent 曲率语义，使按钮、会话 Composer、用户消息和线程环境摘要在支持环境中使用一致的 Codex 风格超椭圆轮廓，同时保持其他 Renderer 圆角不变。
- [desktop/renderer] 收紧 Composer 执行计划与 Diff 文件预览卡片的宽度、间距和排版，并统一为主题自适应的 Codex 风格 rich tooltip 层级。
- [desktop/renderer] 对齐 Codex 的紧凑比例，收窄思考等级弹层及其轨道、滑块和内部留白，避免遮挡会话内容。
- [desktop/renderer] 按主题语义重塑思考等级弹层，以当前等级、粗轨道、大滑块和离散刻度提供更直观的调节反馈。
- [desktop/renderer] 将思考等级从模型选择器拆分为独立等级按钮，使模型与推理设置可以分别调整。
- [development] 重构根与各 workspace 的 AGENTS.md 规则层级，明确全仓红线、局部细则及兼容边界，减少重复和 Agent 误判。
- [agent/desktop/renderer] 将六项性能分档任务模型收敛为生成、整理、代码和安全四类专用模型，按用途复用任务建议、标题、记忆、上下文、计划执行、代码审查和权限审核能力并迁移旧配置；任务建议生成超时由 8 秒延长至 15 秒，并记录实际模型与耗时。
- [desktop/renderer] 固化 Workbench 区域颜色归属规范，明确右侧 Dock 与底部 Panel 跟随工作区画布，窗口菜单栏与左侧栏保持应用 Chrome 层级。
- [desktop/development] 对齐 Codex 的 Windows Window Controls Overlay：原生按钮区改为完全透明并透出 Renderer 菜单栏背景，菜单栏与 Overlay 使用确定的 36px 逻辑高度，移除 DOM 实测颜色/高度回写 IPC 及其缩放反馈环，避免右上角色块断层和标题栏高度自增。
- [desktop/renderer] 为窗口菜单栏、侧边栏和工作区建立独立区域颜色 token；窗口 Chrome 默认同色，右侧 Dock 与底部 Panel 跟随工作区画布。
- [development] 将 MiniMax 全系列模型限制为只读文档查阅、代码探索和方案调研，禁止其修改任何工作区内容或承担编码实现；外部编码仅允许使用经确认的 DeepSeek 候选，否则由主 Agent 亲自完成。
- [desktop/renderer] 建立 UI 交互术语规范并统一普通 Popover、Spinner、长文本展开、文件树语义与拖放反馈，减少重复实现并保持各领域状态边界。
- [desktop/renderer] 将左侧栏、中央内容、辅助面板与底部面板收敛到统一 Workbench Shell，并保留面板尺寸、显隐及辅助面板最大化前状态的恢复语义。
- [desktop/renderer] 将 Composer 输入面及其新建会话形态的圆角统一为双倍 `--cpx-sys-radius-xl`，使输入区域保持更明确的圆润层级。
- [desktop/renderer] 统一排版、间距、圆角、动效、阴影与层级 Token 的语义选择规则，迁移 Feature、lazy 样式和 Tailwind 任意值，并新增可检测组件私有边界、裸值及 stale 精确例外的自动契约。
- [development] 允许主 Agent 按任务范围和上下文复杂度自主选择 OpenCode 的 DeepSeek 或 MiniMax 模型执行受控小阶段，同时保留文件冻结、同 session 返修和独立验收要求。
- [desktop/renderer] 统一 Renderer 颜色语义与表面层级，收敛 feature 对组件颜色别名和临时混色的依赖，为后续 Agent 增加可执行的选色规范与样式检查，并增强 Composer、会话摘要、审批及 Review Diff 在明暗和自定义主题下的信息层级。
- [desktop/renderer] 将消息附件与本地上下文导入改为客户端启动时预热的延迟模块，保持首次发送无需临时加载模块，同时恢复 Renderer 入口体积预算。
- [desktop/renderer] 将 Skill 选择统一为 Composer 内联 token；内置扩展跳转产品详情，工作区和用户 Skill 在右侧只读打开 SKILL.md。
- [desktop/renderer] 将主导航、设置与常用工作台界面调整为随桌面端启动加载，减少首次打开页面和面板时由动态分块造成的加载动画与空白，同时继续按需加载终端和编辑器等重量级能力。
- [agent/desktop/renderer] 将 Material 图标与代码高亮主题收敛为少量按需分片，统一 Repository 公共声明和 Electron 原子 JSON 写入，并简化性能报告为当前指标与预算对比，显著减少源码文件且保持现有运行能力。
- [docs/agent] 基于当前 CodePilotX 与 OpenAI Codex 固定提交重写 Harness 对标报告，校正已完成能力，并给出以运行组合完整性、Skills/MCP 真按需、Hook、Sandbox/凭据决策和 Durable Goal 为核心的证据化优化路线。
- [agent] 将 Pi Harness 物理并入 App Agent，并统一 AgentRuntime 执行门面，减少重复编排层。
- [development] 明确 OpenCode、MiniMax 等外部 Coding Agent 的受控实施边界，要求核心改造采用小任务串行、冻结行为测试、禁止类型绕过并由主 Agent 独立验收。
- [agent/runtime] 为 Harness 增加不可变 Turn/Step composition 契约，并统一持久化主 Agent 与子 Agent 的模型、权限、Skills、MCP、工具和 Prompt 快照，确保暂停及恢复期间运行配置保持一致。
- [agent/runtime] 将 schema 34 的持久化 Runtime Composition（快照、rebind、capability probe 与幂等 release 生命周期）整合进 AgentRuntimeService 内部：同一持久化产品 Turn 在首次 Provider sample 前持久化快照，pause/resume 只 rebind，下一产品 Turn 才重新 compose。
- [build/session-view] 补齐移除 Pi Core workspace 后缺失的共享类型环境：`packages/session-view/tsconfig.json` 的 `lib` 由仅 `ES2022` 对齐为 `ES2022 + DOM`（与 shared、agent-protocol 等包一致），使 session-view 自身声明其传递编译所需的 `URL`/`File` 全局类型，不再依赖被删除 workspace 经根 node_modules 泄漏的 `@types/bun`；干净 frozen install 后 `bun run typecheck` 可全绿。
- [desktop/renderer] 统一会话区域加载态展示：将鲸鱼闪光效果约束在会话内容主区域（variant="contained"），保留侧边栏、右侧面板与顶部菜单栏正常交互；加载期间隐藏底部 Composer，并在数据就绪后平滑淡入时间线；替换时间线旧有旋转 Spinner，彻底消除会话切换与加载时的重复动画问题。
- [desktop/renderer] 优化侧边栏顶部活动通知图标：采用 Lucide 嵌套 SVG 规范，统一使用 Bell 图标并将其小圆点收敛为纯未读消息指示器，仅在存在未读会话时显示与会话行一致的主题色小圆点，会话进行中或等待用户操作时不亮起圆点，提示文案固定为“查看活动”。

- [desktop/renderer] 升级「设置 - 用量与成本」页面：将具备实时余额（如 DeepSeek）与套餐额度（如 MiniMax、Kimi Code）的厂商作为正常卡片发起查询与渲染，支持多币种总余额与充值/赠送明细展示；移除顶部全局时间范围切换器，下沉至仅支持分日历史时序（usage / cost）的厂商卡片右上角内嵌独立控制，并在用量页面隐藏无可用接口厂商的不可查区域；顶部工具栏支持「刷新全部」操作，各卡片右上角提供独立「刷新」按钮并精准追踪单卡片 Loading 加载态，互不干扰。
- [desktop/renderer] 优化侧栏用量浮层与设置用量页面展示：从侧边栏底部设置菜单的「剩余用量」浮层中移除重置时间文字，解决紧凑宽度下标签断行与文本拥挤问题；同时在「设置 - 用量与成本」的远端厂商卡片中新增额度窗口（Quota Windows）明细，完整呈现各周期名称、剩余比例/数量、进度条及重置时间。
- [desktop/renderer] 体系化重构下拉框与弹出菜单（Dropdown / Popover）设计系统：建立 4 级标准化形态规范（Tier 1 标准单行 32px / Tier 2 双行富文本 44px / Tier 3 可搜索选择器 / Tier 4 表单下拉），统一收敛内外边距、垂直行间隙（`--cpx-comp-row-gap-y: 2px`）与垂直节奏（模式切换由 52px 收敛至 44px），重构三栏网格对齐（16px 图标位 + 弹性标题 + 状态/快捷键），标准化搜索框内衬、深色微投影与 Lucide 箭头图标，彻底解决浮层在各模块间“部分过挤、部分过松”的视觉与交互割裂。
- [desktop/renderer] 全局收敛单行交互控件与芯片体系的 line-height：在 Token 层引入 `--cpx-sys-line-height-none: 1`，将 `interactive-row` 族系、`MetaChip`、`ChipButton`、`Button` 各尺寸变体、Badge/Pill 及单行 Input 默认行高统一收敛为 1，并为图标补齐 `flex-shrink: 0` 与 `display: block` 规则，彻底消除字体不对称 leading 导致的图标与文本垂直基线偏斜失衡；多行排版（Markdown 正文、CodeMirror/Diff、Textarea）继续保持规范的阅读与代码行高。
- [desktop/renderer] 对齐侧边栏项目标题与会话行的尾部操作图标样式与布局：项目行更多菜单与新建对话按钮统一复用 `IconButton`（ghostSecondary / iconMd），消除多余背景与边框差异；统一项目行与会话行的 CSS 网格列宽与右侧基线，并将动作按钮间距收紧为紧凑的 4px，使两行图标在尺寸、位置与中心线上像素级完美对齐。
- [desktop/renderer] 深度对齐 Codex 侧边栏项目与会话悬浮卡片（Hover Card）及运行态交互：项目悬浮卡片重构为紧凑四行结构（标题与图钉、任务与开启统计、项目主路径及齿轮图标编辑入口），移除多余分割线并修复路径在亮暗主题下的样式显示；会话悬浮卡片增加设备图标、相对时间及运行中「· 🔵」蓝色状态指示点，元信息统一为文件夹项目归属与 Git 分支展示；侧边栏运行中会话支持悬停即时展示置顶与归档快捷操作，并统一未读与运行状态圆点使用系统 Accent 主题色。

- [desktop/renderer] 全面对齐 Codex 风格的文件浏览与「打开文件」界面：重构「打开文件」标签页为左右分栏布局（左侧呈现根路径与打开文件居中空状态插图，右侧呈现带宽度拖拽分割条的文件树面板）；文件树目录行改用精简 Chevron 展开折叠箭头，文件行全量接入彩色 Material 图标并修复单色样式覆盖，顶部始终呈现「筛选文件...」搜索框，在单工作区模式下隐藏冗余的主目录分组头，并实现文件树展开状态与宽度的跨面板持久化同步。
- [desktop/renderer] 统一 Markdown 富文本代码块与正文页组件呈现：富文本编辑与预览中代码块升级为统一的 CodeBlock 结构，对齐语言标签、复制代码与 Shiki 语法高亮；支持在代码块头部直接点击语言标签原地修改语言，且点击代码内容区域直接在代码块内部就地编辑代码（不展开裸露的代码围栏反引号 ```），实时双向同步至底层 Markdown 文档。
- [desktop/renderer] 现代化重构正文与 Markdown 阅读排版体系：正文行高显著提升至 1.7（--cpx-sys-line-height-reading），段落间距增至 14px，列表项间隙增至 10px~12px，标题字重统一定为 600（Semi-bold）并增大上边距（H1 30px / H2 26px / H3 22px），精细化行内代码与代码块/表格垂直留白，并同步用户提问气泡内衬排版，全面消除拥挤感，大幅提升技术长文阅读舒适度。
- [desktop/renderer] 深度对齐 Codex 侧边栏视觉与交互体验：全量接入并响应系统「界面字号」设计令牌（--cpx-sys-font-size-ui / --cpx-sys-font-size-sm），统一侧栏字号与字重层级规范（导航/项目/常规会话使用界面主字号 400 字重，时间线主标题 500 字重，分组标题使用次级字号 500 字重，二级摘要使用次级字号弱化灰 400 字重），规范 Windows 平台抗锯齿与字体渲染；时间线模式升级为标准双行卡片模式（高度约 50px），优先提取并展示会话最新消息/摘要预览（Snippet，单行截断省略），无内容时优雅回退显示所属工作区标签。
- [desktop/renderer] 现代化重构扁平简约微投影与全局深色遮罩体系：彻底消除暗色模式下亮色墨水色（Ink）导致的遮罩白雾与光晕发白问题；亮暗模式遮罩统一为 20%~28% 纯黑低透明度与轻微背景柔化（--cpx-comp-modal-scrim）；全局卡片、常驻面板及审批框彻底去除冗余阴影，纯粹依托 1px 细微边框区隔；浮层（弹窗、下拉菜单、命令面板、Toast、悬浮 Composer）采用纯深色双模适配微投影（亮色 6%~12% 纯黑柔和微投影，暗色 30%~40% 纯黑微投影），达成通透轻盈且层级分明的简约扁平设计。
- [desktop/renderer] 现代化重构 Composer 模型与推理选择器：推出左右两栏 Master-Detail 弹窗结构、支持全局跨提供商即时搜索、推理强度平滑离散滑块调节（无冗余图标），并优化输入框底部触发 Chip 与胶囊徽标展示。

- [desktop/renderer] 重新设计全局 Design Token 体系与组件交互层：引入动态感知表面多级阶梯与 WCAG 4.5:1 对比度校准、定义克制优雅的微混多色语义阶梯（成功绿/危险红/警告橙/技能紫/信息青/主色微混与对应 Chip 规范），并在悬浮 Composer、Popover、Dropdown、Modal 及 Tooltip 浮层引入精致微透毛玻璃 Token 体系（--cpx-sys-blur-* / --cpx-comp-glass-*），统一全量基础组件视觉与几何交互规范。
- [desktop/renderer] 全面重构并精简样式 Token 体系：彻底弃用历史多层代理与旧命名遗留，建立「系统语义层（--cpx-sys-*）」与「组件槽位层（--cpx-comp-*）」现代化双层规范；统一收敛色彩、T-Shirt 圆角（xs~xl/full）、排版（xs~3xl）与 4px 间距网格；全仓 76+ 个 SCSS 样式及 TSX 引用统一迁移，同步升级 Theme Token Debugger 并在 CodeMirror/Terminal 局部保留最小必要映射，全量通过样式契约、单测与类型检查。
- [desktop/renderer] 现代化重构自定义 Provider 新增与编辑弹窗（ProviderEditorDialog）：引入「基本配置 / 模型管理 / 高级与网络」三标签页结构、预设模板一键填入、模型折叠手风琴卡片及底部固定操作栏。
- [desktop/renderer] 重构供应商与模型中心页面架构：顶层收敛为「供应商」主目录与「全量体检」大盘两级导航；供应商详情页内聚合「连接与凭据」和「模型与测速」双子闭环，在供应商上下文内直接完成 API Key/OAuth 凭据管理、模型目录拉取同步与单模型/批量即时测速，并移除与 Composer 及系统设置冗余的 Router 和默认模型配置。
- [desktop/renderer] Provider 目录与模型配置界面改用 models.dev 官方图标：仅当 `catalogOrigin === 'models-dev'` 时才生成 `https://models.dev/logos/{encodeURIComponent(providerID)}.svg` 固定域名 SVG，加载失败或用户自定义 Provider 继续安全回退通用图标。
- [desktop/renderer] 移除 Coding 新建会话中 Composer 区域的 flex 比例与 min-height 限制，使输入区域高度由内容自然决定。

- [architecture/shared/agent/desktop] 执行全仓简化方案：移除废弃共享会话模型与未消费 IPC 通道；收敛 RPC handler 直接 SQL 查询至仓储层；统一 Electron 窗口状态原子写器与 IPC 契约定义；合并 Renderer 跨端路径归一化比较工具；统一 Review 差异面板按钮复用及样式；提炼 Agent Protocol 基础类型与集成测试 Harness，并修正默认推理哨兵及确定性集成 fixture 的现行契约。
- [desktop/renderer] 对齐 Codex 侧边栏会话悬浮卡（Hover Card）设计：项目图标改用终端图标（SquareTerminal），标题支持多行自然折行展示完整会话名称，右侧顶部对齐相对时间，并优化悬浮卡圆角、内边距与间距排版节奏。
- [desktop/renderer] 动画体系一次性全优化：骨架屏扫光改为局部渐变伪元素 `transform: translateX` 的 compositor 路径（删除 100vw×100vh `background-attachment: fixed` 重绘）；文件树显示/隐藏、侧栏 section、会话扩展列表与处理过程/活动折叠改为 `AnimatePresence popLayout` + Motion layout projection 的 FLIP 呈现（删除 `width: 0 ↔ auto` 与 `height: 0 ↔ auto` 逐帧布局动画）；进度条填充统一为 `transform: scaleX` + `transform-origin: left` 过渡；滚动边缘渐隐由 scroll-timeline 动态 mask 改为 `useScrollEdgeState` 驱动的静态伪元素渐变 frame（passive scroll listener + rAF 合并 + ResizeObserver，仅边界布尔变化才重渲染）；删除常驻 `will-change`，拖拽实时 reflow、Radix 挂载/焦点语义、reduced-motion 与快捷键行为保持不变。
- [desktop/renderer] 会话打开与切换期间的整窗加载统一为带真实阶段文案的鲸鱼扫光动画（复用启动遮罩契约），替换原有的“加载对话中”文字加载态。
- [desktop/renderer] 拆分 live event 订阅过滤器：`provider` 过滤器不再接收 `model/health/updated`，模型健康页改用独立的 `modelHealth` 过滤器，避免 provider 状态消费无关的逐模型事件。
- [desktop/renderer] 补充 Renderer 样式契约白名单判定规范，明确固定控件几何、语义行高、Tailwind leading 与外部样式契约的准入边界，避免后续检查失败时机械刷新基线。
- [desktop/renderer] 统一可缩放内容与固定桌面 Chrome 的语义行高，修复大字号代码、设置行、侧栏动作和编辑器排版被局部行高撑高或压缩的问题。
- [desktop/renderer] 将右栏自动收起改为按整窗 960px 阈值计算并保留 24px 恢复回差，默认宽度改用按主区宽度与工作区高度的动态公式；工作区标题栏不再固定 94% 模糊背景与下边框，仅在会话滚动内容下显示 0.5px 分割线，窄窗口标题始终可见并截断。
- [docs/agent] 新增 Codex Harness 对标与 Agent 优化报告，明确当前能力基线、关键差距及分阶段实施路线。
- [desktop/renderer] 按 Codex 证据恢复设置卡片与按钮的主次层级：SettingsSection 默认卡片表面（16px 圆角、fog 背景、inset hairline），移除设置行固定 64px 高度，primary 恢复前景实底反色文字、secondary 使用 5% 弱背景，并新增 canonical pressed token。
- [desktop/renderer] 补齐 Windows 桌面菜单键盘行为：Alt/F10 聚焦菜单栏、Escape 关闭并恢复焦点、左右键切换菜单、Alt+F/E/V/W/H mnemonic 直接打开对应菜单。
- [desktop/renderer] 首页建议保留 0.5px ring 并恢复极弱阴影，移除按压位移。
- [desktop/renderer] 收敛 `/new` 三种首屏依赖：codex-light/codex-dark 主题 token、Browser Mock、Mock 历史投影及未打开的确认框改为按需加载，Electron typed bridge 首屏不再解析冷分支；visual/performance fixture 显式预置 Mock 模型，继续绕过真实 Agent 完成浏览器回归。
- [desktop/renderer] 以 Codex 式应用栏与工作区工具栏层级、克制表面和首次模型配置向导统一桌面视觉，并在进入工作台前确保存在可用默认模型。
- [desktop/renderer] 将会话顶栏的环境 Actions 与任务 Handoff 迁入命令菜单，恢复标题菜单“继续到…”的对话派生语义，并收紧 Codex 式标题图标与尾部工具按钮间距。
- [desktop/renderer] 将会话处理过程改为 Codex 式无框活动流，补齐语义摘要、嵌入命令详情、折叠动效与长列表渐隐滚动。
- [desktop/renderer] 按 Codex 的尺寸、颜色与上下文契约重构文字及纯图标按钮，统一应用标题栏、工作区、面板、TabStrip、侧栏与 Composer 的点击盒、字级、圆角和主次视觉层级。
- [desktop/renderer] 将 Coding 首页建议限制为最多四项，并让 Working 根据当前工作区、Git 状态与最近会话生成三条真实建议，同时保留工作模板入口。
- [desktop/renderer] 对齐 Coding、Working 与 Chat 新建首页的标题、建议层级和 Composer 布局，并为 Chat 增加独立首页。
- [desktop/renderer] 将桌面开关与对比度滑块的控制点统一为亮暗模式固定白色，并取消主题预览卡的鼠标悬停变色。
- [desktop/renderer] 将会话轮次、过程与耗时、正文、表格、代码、媒体、用户消息、附件、编辑态、文件变更卡片与 Composer 统一到 48rem 阅读轴，保留编辑重发附件并改善长消息及窄窗口下的折叠、截断和横向溢出表现。
- [desktop/renderer] 统一全局正文、标题、侧栏与菜单的字号、行高和语义字重，使等宽及非等宽 UI 字体均保持 Codex 式清晰排版节奏。
- [desktop] 参考 Codex 统一桌面端中性 active、hover 与键盘焦点表现，移除突兀的选中轨道，并仅为 inset 分段控件和裁切焦点保留轻量特殊效果。
- [desktop] 将桌面端圆角统一为 8/12/16px 嵌套柔和曲率，并限制胶囊圆角只用于状态与选择类控件，使扁平工作台更精致统一。
- [desktop] 统一桌面端扁平视觉层级、交互状态与动效，使全部工作台页面在用户自定义主题下保持清晰主次。
- [desktop/renderer] 重建设计系统的表面层级、低强度雾面浮层与统一动效，使工作台、会话概览和 Composer 在保留强调色、背景色与前景色设置的同时获得一致层次。
- [desktop] 将右侧面板默认宽度调整为 600px，同时保留用户已保存的拖拽宽度和窄窗口夹紧行为。
- [desktop/renderer] 重建 Codex 式右侧工作台 Frame、46px TabStrip 与统一面板状态，使 Review、文件、Browser、Terminal、Plan、附件、侧边聊天和子智能体共享尺寸、焦点、拖拽、全宽及生命周期契约。
- [Agent/session-view] 为主任务、侧边聊天和子 Agent 接通自动上下文压缩与单次 Provider 溢出恢复，并持久化可恢复、可投影的压缩检查点和统计。
- [renderer] 统一线程摘要、下拉菜单、上下文菜单和 Popover 的轻量黑色阴影，提升浮层与背景之间的层次感
- [renderer] 移除 Composer 外层堆栈的溢出裁剪，避免统一阴影和子面板边框被截断
- [renderer] 统一 Composer 外层堆栈与输入面板的圆角，避免阴影出现方形边角
- [renderer] 统一计划更新等生命周期状态与命令摘要的内容宽度和左侧对齐方式
- [renderer] 隐藏会话主滚动区的滚动条外观，同时保留滚轮、触控板和键盘滚动能力
- [renderer] 统一会话工作台右栏与底栏的定位占位层级，使拖拽时主区、面板内容、Markdown 与 Composer 实时重排，并补齐宽内容折行和最小尺寸保护
- [Agent/desktop/renderer] 统一执行与恢复纵切面：history schema 27 增加 durable resume lease，main/subagent 共享 interaction 恢复入口，Renderer 改为 canonical 批量单写者并在应用提交后确认事件位置
- [Agent/renderer] 统一 thread snapshot、history、queue 的 SQLite read fence 与 SSE cursor authority，事件以 256 条或 50ms 批量提交、1024 条有界积压并在消费失败后从已提交位置重新对账
- [release/docs] 后续 GitHub Release 统一改为 source-only：标签流水线使用 GitHub-hosted runner，仅发布 CHANGELOG 正文与 GitHub 自动生成的源码归档，不再依赖自托管签名 runner 或上传 Windows 安装包、更新元数据、校验和及 SBOM；README 改为指导 Windows x64 使用者自行打包
- [desktop/renderer] 将分段选择与插件来源筛选迁移到 Radix Toggle Group，补齐方向键和 roving focus 键盘导航，同时保持现有视觉与必选行为。
- [Agent] Skills 与可选 MCP server 改为按需发现和加载，单个外部资源故障不再阻断普通对话。

### Fixed

- [desktop] 修复展开状态向时间线、侧栏和表单父级广播导致的高频重渲染，连续展开收缩不再阻塞界面。
- [desktop/renderer] 修复文件修改摘要卡片在较窄会话区域将审核操作换到第二行的问题，使操作按钮始终保持在标题行右侧。
- [desktop/renderer] 修复 Composer 思考强度滑块进度层在横向缩放时压扁起始圆角的问题，保留顺滑拖动的同时恢复完整胶囊端帽。
- [desktop] 统一桌面端展开、收缩与浮层过渡，修复内容脱离布局导致的跳帧和面板卡顿。
- [desktop/renderer] 修正 Windows 工作区中 `/new` 等路由被误显示为文件引用的问题，校准 Markdown 文件图标基线，并将命令活动统一为带前置完成耗时的“执行”文案。
- [development/desktop] 修复独立开发 Agent 重启后端口与认证身份变化导致桌面持续连接旧地址的问题，使现有窗口可通过原有重连链路自动恢复。
- [desktop/renderer] 修复 Composer 会话组菜单无法新建会话组的问题，并将会话数与项目数移至组名下方显示。
- [desktop/renderer] 统一带勾菜单与下拉项的静止、悬停、按压及输入方式反馈，统一权限 Select 富文本项间距，并修正可搜索 Popover 上下与列表内边距不一致的问题。
- [desktop/renderer] 将任务规划插件的 Lucide 占位图标替换为正式规划任务图片，并统一应用于已安装架、目录和详情入口。
- [desktop/renderer] 修复插件管理 capability 未参与桌面初始化握手，导致真实任务规划插件被误报为 Agent 不支持的问题。
- [desktop/renderer] 恢复 Codex 式侧边栏项目、会话与导航行视觉，并修复产品模式切换器误用通用 Select 后产生的边框和悬停样式回归。
- [desktop/renderer] 完成交互语义与视觉所有权全量收口，统一剩余选择、披露、实体行和图标动作，并增加静态契约防止动作按钮与复合表面再次串扰。
- [desktop/renderer] 隔离卡片、附件和复合交互表面与动作按钮样式，修复悬停、尺寸和状态视觉串扰。
- [desktop/renderer] 将思考强度滑块改为拖动预览、松手单次提交，修复快速拖动时等级文字因受控状态连续回传而乱跳。
- [agent/desktop] 兼容读取异常任务阶段，区分看板读取与操作错误，并通过非阻断诊断提示保留任务可用性。
- [desktop/development] 修复多个 Git worktree 启动 Desktop 时争用固定 Renderer 端口和全局 Electron 实例的问题，为各 worktree 隔离动态 Vite、Electron 状态与日志，同时复用唯一开发 Agent。
- [desktop/renderer] 收紧高频交互动效并取消推理滑杆直接操作时的位置缓动，使模型菜单、浮层、悬停与滑杆反馈更及时。
- [desktop/renderer] 修复外观设置颜色选择框被拆成色块与空白输入区的问题，使浅色和深色主题的强调色、背景色及前景色恢复为 Codex 风格的一体式颜色控件。
- [desktop/renderer] 修正新会话首页因页面位置误用胶囊圆角的问题，引入独立的 Composer utility bar、布局和圆角角色语义，使首页与会话页的多行输入面统一使用 prominent 曲率。
- [desktop] 修复用户主题与系统主题不同时，桌面重新加载期间鲸鱼加载页短暂闪成相反明暗主题的问题。
- [desktop/renderer] 修正暗色主题细边框强度与 Workbench 结构边界层级，使侧栏、右侧 Dock、底部 Panel 和工作区顶部边界更清晰，同时保留内部卡片与章节分隔的次级语义。
- [desktop/renderer] 修复 Composer 执行计划预览入场期间因零宽 transform 包含块先显示竖条再展开的问题，预览改为首帧稳定宽度的淡入淡出。
- [desktop/renderer] 修正用户消息背景过弱、线程环境摘要宽度接线不一致及 Composer 变更汇总误用主按钮造成的黑色胶囊，使会话工作区的信息层级更接近 Codex 且继续适配自定义主题。
- [Agent/desktop/models] 修复 Provider 模型数量错误依赖 API Key 可用状态的问题；models.dev Provider 现在展示远程目录原始收录数，协议适配与凭据状态不再影响计数。
- [desktop/renderer] 调整 Provider 目录卡片的垂直与水平内边距，并移除状态徽标前的元信息分隔点，使卡片内容密度与模型中心布局保持一致。
- [desktop/models] 放宽 Provider 目录卡片的内部留白与图文间距，并移除面向用户展示的 models.dev 缓存来源标签。
- [desktop/renderer] 修正亮色主题中 control、raised 与 recessed 表面的层级方向，并为浮动 Composer 和线程环境摘要恢复克制的 prominent elevation，常驻 Dock、Panel 与普通卡片继续保持零阴影。
- [desktop/models] 修复 Provider 远程图标及其固定占位在目录卡片中塌缩、连带破坏图文间距的问题，并改为启动后后台校验 models.dev、失败回退缓存，同时提供页面级手动刷新。
- [desktop] 修复 Pi OAuth 登录在认证方式选择提示中持续加载、无法提交，以及授权完成后 Provider 模型目录未立即生效的问题，并确保打包后的 Agent sidecar 内置 OAuth 流程可加载。

- [desktop] 修复 Windows 原生窗口控制区未跟随应用标题栏主题与高度，消除浅色和自定义主题下的顶栏颜色断层。

- [desktop/renderer] 修复右侧栏与底部面板拖拽结束时旧比例状态短暂覆盖最终尺寸、导致面板先回跳再落到目标位置的问题。
- [Agent] 修复图片及文本附件在 input 创建前提前绑定而导致首条发送、排队追问和运行中引导显示“Agent 内部错误”的问题，并将附件绑定纳入 Turn 创建事务。
- [desktop] 修复可信主窗口的文本剪贴板写入权限，恢复工作目录、会话 ID、深度链接及其他普通复制操作。
- [desktop/renderer] 图片附件打开控件不再复用通用 Button，避免默认尺寸、背景和边框覆盖缩略图。
- [desktop/renderer] 修正 Skills 实时更新测试，使其匹配复用的全局事件订阅。
- [agent] 修复正式提问 checkpoint 使用 `toolCallID` 时被替换为随机标识，导致用户回答后无法恢复原工具调用、Turn 直接失败的问题。
- [desktop/renderer] 修复正式提问从会话历史恢复后使用交互 ID、却只按内部问题 ID 查找待处理请求，导致回答被误报为已失效的问题。
- [desktop/renderer] 修复全局事件重复占满浏览器连接、发送消息又等待动态上下文模块和完整模型目录，导致提交长期停留在“正在发送”且未创建 Turn 的问题。
- [desktop] ConversationEnvironmentControls 在 gitStatus 成功加载前或已确认非 Git 时不调用 local-environment/action/list、worktree/list 与 thread/handoff/pending，清空既有 Git actions/worktrees/遗留错误，请求期间由 Git 变非 Git 时忽略迟到结果与错误；移交等 Git 专属入口保持可发现但禁用并说明“仅 Git 项目可用”，Git 后续成功才加载。
- [desktop/renderer] canonical 会话批次收到 turn/completed/turn/failed/turn/interrupted 终态事件后，先 deliver 再只读取一次最新历史并 rehydrate 当前 coordinator，用 threadId + generation 双校验拒绝旧结果；对账失败保留实时投影、不设置页面错误、不清空时间线、不循环重连，仅做安全诊断。
- [desktop] 非 Git 普通项目与无项目会话在 Git status 返回 REPOSITORY_NOT_FOUND（或失败）后跳过 branches 与 Review RPC，避免 review.snapshot/review.summary 因仓库缺失而报错阻断会话，仅投影为 isGitRepo=false、gitStatus=null 与空分支/Review；Git 仓库继续加载 branches 与 unstaged/staged Review。Composer 发送门禁仍仅为空输入、模型未配置、会话未解析、附件错误与正在提交，非 Git 项目仍可正常发送。
- [desktop/renderer] 还原 Working Composer 内联 Skill 的 Codex 字体比例与透明 mention 样式。
- [desktop/renderer] 统一对话发送按钮、侧边栏会话行与 Bell 的运行及未读状态来源，修复回复完成后仍显示运行中的问题。
- [desktop/renderer] 修复侧边栏活动视图引导提示（Coachmark）在每次启动桌面端时重复弹出的问题：补齐桌面设置反序列化中的活动视图字段归一化，确保用户确认关闭后持久化生效且不再弹出。

- [agent/runtime] 固定同一产品 Turn 的 Harness composition 与 deferred 工具边界，确保多步执行和恢复不会重组模型、Prompt 或扩宽 ToolSearch 可见范围。
- [desktop] 优化 Windows 下 Electron 窗口边框与控制按钮：改用 titleBarStyle: 'hidden' 和 titleBarOverlay 支持原生贴靠布局并精确同步顶栏底色 (surfaceUnder) 与 36px 贴合高度；主内容区对齐简约扁平规范，移除卡片外阴影与冗余边框，彻底消除粗黑边与颜色高度断层。
- [desktop/renderer] 修复侧边栏在更新/生成会话标题时的骨架屏显示异常：标题生成期间禁用会话悬停卡片（HoverCard）弹出，避免出现大尺寸卡片浮层；同时将骨架屏圆角从全圆角修正为与文字行高贴合的 4px 微圆角长方形（`--cpx-sys-radius-sm`），保持平滑扫光动画。

- [desktop] 修复会话自动追底对齐到 Composer 渐变遮挡区的问题，使最新正文完整停留在可视区并保留底部阅读间距
- [agent/security] 修复 Skills 扫描静默忽略指向可信根之外 Junction 的问题，改为安全拒绝，同时保留跨已配置 Skills 根别名的去重行为。
- [desktop] 稳定 AI 流式 Markdown 的分块渲染、增量动效、代码高亮与自动追底，避免回复期间旧内容重复淡入和会话正文往返闪烁
- [desktop/renderer] 修复新建会话路由切换后复用已消费 inputId、完成任务仍显示运行中及发送错误重复提示的问题。
- [agent/security] Skills 快照升级为 V2（RuntimeCompositionSnapshotV2）：仅冻结实际引用项，无关 Skill 变化不再阻断暂停恢复；已显式展开到 prompt 或成功 skill_read 的 Skill 变化/缺失 fail-closed，并为成功 skill_read 持久化可用于恢复校验的证据；旧 V1 快照保持兼容并按旧全量 catalog fail-closed。
- [agent/security] 收紧 Skills 引用证据持久化边界：存在 durable composition storage 时，成功 skill_read 后的引用证据持久化失败即安全失败，不再把工具读取静默当作成功；缺表 ephemeral fresh 场景不受影响。
- [agent/runtime] 将无凭据的 thinking level 与 modelRef variant 纳入组合 identity hash，仅调整推理强度/变体即改变 composition 身份，凭据、headers、metadata 等不进入 hash 或快照。
- [desktop/renderer] 修复外观设置中选择字体变体后重新进入页面变体下拉框回退显示全称（如 JetBrains Mono Medium）而非变体名（如中等、半粗体）的问题：增强变体名提取与本地化解析（`faceStyleLabel`），并在组件挂载时自动复用已就绪的系统字体缓存。
- [desktop/renderer] 修复侧边栏底部的“设置”按钮因 DropdownMenu.Trigger 传递 data-theme-component="dropdown-trigger" 导致常驻控件实色灰底（被误判为永久 hover/active 态）的问题，使侧栏设置按钮在非激活/非悬停态下恢复为透明底色。
- [Desktop] 修复失败 turn 未显示安全错误原因、界面仅留下"已处理"状态的问题。
- [agent/protocol] 修复 initialize capability 协商未取客户端与服务端能力交集的问题，确保 RPC 方法、事件订阅和 initialize 返回值只暴露真实协商能力。
- [desktop/renderer] 修复侧边栏会话项在悬浮或聚焦时未读圆点与置顶/归档操作按钮并存重叠的问题，对标 Codex 实现悬浮态仅展示操作按钮并隐藏未读圆点，并将侧栏会话项与 Hover 详情卡片中的未读圆点统一为主题 Accent 色（var(--cpx-sys-color-accent)）。
- [Agent/desktop] 修复 models.dev 缓存重载时丢失工具调用等模型能力元数据，恢复 Provider 模型数量、兼容状态和模型选择器中的已配置 Provider。
- [Agent/desktop/renderer] 修复 Provider 模型数量依赖按需缓存、模型选择器仅显示当前 Provider 的问题；模型中心现在展示准确的可执行模型总数，并在选择器打开时加载全部已配置 Provider 的完整模型目录。
- [desktop/renderer] 修复字体变体应用逻辑：CSS 变量改用系统原生全称（如 "MiSans VF Semibold"、"JetBrains Mono SemiBold"）替代带连字符与自定义前缀的别名，确保 Windows/macOS/Linux 各字重与字形样式即时生效并兼容历史配置。
- [desktop/renderer] 全局去除文本透明度混合与文字 Alpha 通道：将底层主题 Token（`--cpx-sys-color-fg-secondary`、`--cpx-sys-color-fg-tertiary`、`--cpx-sys-color-fg-disabled`）由 `rgba()` 全面重构为基于背景表面混合的纯实色 Hex；清理侧边栏、工作流卡片、会话状态与设置面板中所有作用于文本与图标的 `color-mix(..., transparent)` 与 `opacity` hack，彻底消除 Windows Chromium DirectWrite 灰阶抗锯齿降级导致的字体边缘发虚发灰问题，全局文字与图标在各种背景下均呈现极致清晰锐利的纯色对比度。
- [Agent/usage/renderer] 修复 MiniMax Token Plan 额度状态解析错误：纠正 `status: 2`（已耗尽）被误判为无限额度的 bug，保留重置倒计时并准确标注为“已用尽 · 剩余 0%”；过滤未在套餐内的模型窗口（`status: 3`），并优化重置时间到期或超期时统一提示“即将重置”。
- [desktop/renderer] 修复多模型套餐（如 MiniMax 同时返回 general 与 video）时侧栏菜单与账户卡片因重复 Quota ID 生成相同 React key 的控制台报错问题。
- [desktop/renderer] 修复会话任务结束后 Composer 发送按钮、变更摘要与时间线组件状态未即时从运行态更新的问题：在 canonical auxiliary 状态投影中实时派生 active turn 状态，使桌面会话页面组件与流式事件完成精确同步，并在全局会话目录刷新中完整重载活动会话快照。
- [Agent/Desktop] 修复 Desktop 推理模式被误当成模型 variant，导致已保存模型仍显示“配置模型”的问题。
- [desktop/renderer] 修复外观 V7 与系统字体接线错误导致 Renderer 解析失败、Electron preload 编译失败及桌面开发环境无法启动的问题，并恢复高版本外观配置的拒绝覆盖保护。
- [desktop/renderer] 统一外观页主题编辑器与偏好设置卡片的共享表面、圆角、宽度和 16px 内容网格，使标题、控件及分隔线左右对齐；字体家族与样式下拉改为按当前内容自适应宽度，不再截断常规选项。
- [desktop] 修复外观 V7 在真实启动与 Agent 保存链中可能降级覆盖高版本配置、系统字体权限被麦克风策略误拒绝、字体 family/face 可不一致，以及已保存字体样式首次进入不可操作的问题。
- [desktop/renderer] 修复动态滚动内容增长后边缘渐隐状态失真、命令输出渐隐层随内容滚动及 reduced-motion 骨架屏残留高亮，并隔离动画性能夹具、补强视觉与样式契约以避免回归测试假绿。
- [desktop] 修复模型配置判定期间启动鲸鱼过早交接的问题，统一整窗加载为带真实阶段滑动文案的鲸鱼扫光动画，并保留局部加载反馈。
- [desktop/renderer] 将首次模型配置向导改为由用户 `config.json` 中的 `desktop.firstUseSetupCompleted` 一次性标记控制，已有有效模型的旧用户自动完成迁移，手动改回 `0` 可重新进入完整向导。
- [Agent/desktop/renderer] 修复只保存 API Key、未显式选择默认模型时，Agent 目录 fallback 被伪装成已配置模型、刷新或重启后绕过首次配置门禁的问题；`model/list.defaultModel` 现在只返回显式配置且当前可用的默认模型（含 variant）。
- [desktop/renderer] 修复 Provider 目录或模型状态刷新失败时旧 `modelConfigured` 状态继续放行工作台的问题，配置读取失败统一进入安全恢复态；凭据新增、更新、启停、切换、删除与 `catalog/updated` 事件合并为一次配置刷新，避免重复请求与后返回覆盖新状态。
- [desktop/renderer] 移除不生效的 `fetchProviderModels`/`saveModelProvider` Base URL 死参数与模型中心的不可达内联 Base URL 分支，自定义供应商 Base URL 只通过 ProviderEditor 保存并统一刷新目录。
- [Agent/desktop] 修复 Windows PowerShell ZIP 安全扫描未正确接收归档与解压路径，导致本地语音模型及托管 ZIP 工具下载后持续报安全校验失败的问题。
- [Agent/desktop] 修复 v4 会话事件投影不符合协议而触发 Renderer 历史对账的问题，并在任务建议生成超时或 Provider 暂时不可用时缓存本地建议，避免重复等待与告警。
- [desktop/renderer] 修复右栏拖拽时工作区 Header、主视口、面板外壳与内容使用不同宽度源造成的错位、空白和松手跳变，并保持主会话当前阅读位置稳定。
- [desktop/renderer] 减少 Review 文件预览和变更树的重复边界，并修复浅色主题下“再显示 N 个文件”文字不可见。
- [desktop/renderer] 修复 React StrictMode 重放使 Review 刷新协调器提前停止、变更快照永久停留在刷新状态，并确保 fresh 快照 generation 未变化时仍自动加载文件差异。
- [Agent/desktop/renderer] 修复工作区文件 revision 精确协议遗漏原始摘要与 UTF-8 BOM 信息导致文本文件统一报 Internal RPC error，并让“打开文件”目录树占满面板且不再受固定分组高度截断。
- [desktop] 修复内置 Browser 仍使用内存 mock、Review/Git 项目身份丢失、文件标签恢复过期作用域、工作区可选数据联动失败以及 Terminal/子智能体能力误判，缺失能力改为明确不可用状态。
- [desktop/renderer] 修复弹窗、浮层、折叠面板、临时卡片和新建页切换在 React 提前卸载时缺少退出动画的问题，并统一减少动态效果与焦点清理语义。
- [desktop/renderer] 修正整轮活动流的耗时标题、运行状态和折叠层级，使最终回复前的 commentary、工具活动与 thinking 状态按 Codex 顺序展示。
- [desktop/renderer] 修复桌面开关控制点因边框计入尺寸错误而偏离轨道中心、在选中端贴边的问题。
- [desktop/renderer] 修复顶部应用菜单无法通过重复点击和标准关闭操作稳定收起，以及 Composer 统一菜单的导航高亮反复跳回第一项的问题。
- [desktop] 对齐 Codex 空右栏的启动项顺序、文案、图标与快捷键，在无标签时隐藏冗余加号，并修复侧边聊天入口、添加菜单与标签关闭交互。
- [renderer] 修复新建会话复合 Composer 被全局外层阴影包围的问题，同时保留主线程和侧边聊天的输入框层次。
- [desktop] 侧边聊天直接复用主工作区 Composer 的完整布局和样式，同时保持独立草稿、附件及 thread 路由。
- [desktop] 修复侧边聊天 capability 未随 renderer 初始化握手声明的问题，避免 Agent 重启后入口可见但创建请求被拒绝。
- [desktop] 对齐 Codex 侧边聊天的临时分叉会话、多标签、关闭销毁与独立时间线，避免侧聊消息写入主任务。
- [renderer] 调整宽会话中对话导航轨的空间层级，以 48px 左侧导轨通道和 16px 右侧余量保持宽正文，并避免导轨贴附侧栏分隔线
- [renderer] 修复宽会话布局使对话导航轨因旧空白门槛始终隐藏的问题，并将导轨收进现有正文 gutter
- [renderer] 修复任务侧栏 Footer 覆盖滚动内容的问题，使设置与状态区域固定在独立布局空间并保证最后一项完整可见
- [renderer] 优化工作台各类面板在高刷新率下的实时拖拽，消除会话逐像素重渲染、重复滚动测量和 Review 全量行高同步
- [renderer] 修复 React StrictMode 重放导致 canonical 会话投影协调器提前停止、会话页无法加载的问题
- [Agent] 修复审批、提问、Hook 信任、子 Agent 等待与启动恢复在崩溃窗口中可能重复执行、永久等待或因 live publish 失败阻断 continuation 的问题
- [desktop] 修复 owned Agent sidecar 的旧 generation 晚回调、并发退出和残留进程可能污染重连的问题，增加实例身份校验及 shutdown、SIGTERM、进程树确认的严格退出链路
- [desktop] 修复外观设置 IPC 只广播但未原子落盘，导致桌面重启后主题、字体、动效和指针偏好恢复默认值的问题
- [renderer/test] 修复性能回归场景在侧栏与工作区同时显示同名会话标题时因全页严格文本定位产生歧义的问题，改用 canonical thread 标记确认当前会话完成切换
- [Agent] 修复模型健康批量测试的并发与生命周期竞态：同 operationId 并发 start 只构建并启动一次批次，候选构建期间 cancel 产生零请求的终态快照，取消、事件发布失败或服务释放时批次收敛为 cancelled 且计数守恒，dispose 会中止并等待后台批次停止。
- [Agent] 修复模型健康事件快照可变引用泄漏与发布失败可能产生未处理 rejection 的问题，历史 running 事件的 counts 不再随后续 healthy/failed 更新变化。
- [Agent/desktop/renderer] 保持旧 `provider/test` 兼容形状（未显式传 model 时结果不含 model，timeout/provider 分类映射为 unknown），Provider 与模型不匹配返回声明过的 `INVALID_REQUEST`；未协商 `model.health.v1` 的事件订阅不再收到 `model/health/updated`。
- [desktop/renderer] 修复模型健康页断线、离页与重试状态不一致：start 响应丢失后经 read 恢复已接受批次，离页或卸载按 operationId 立即取消，重连与投递恢复后以权威快照对账，单项重试结果不会覆盖新批次，任一重试进行中禁用重复触发。
- [desktop/renderer] 修复设置等宽文本域、代码块与配置代码预览在 UI/code 字号独立配置时行高小于字体的角色错配，并让样式检查明确拒绝在 `font` shorthand 中通过 `/` 设置行高。
- [desktop/renderer] 修复侧栏空态行复用交互行样式（指针、hover、active 与禁用选中）的问题，恢复中性 div 行结构并保持合法 block content model。
- [desktop/renderer] 修复 Radix 单选分段控件继续使用 inset 反向底色的问题，统一为 Codex 默认的透明容器与弱前景色选中态。

### Fixed

- [agent/storage] 修复已标记为 history schema 40 但缺少会话组表的开发数据库无法自动补齐迁移、导致 Agent 启动失败的问题。
- [desktop/renderer] 修复会话组新建、编辑和删除依赖桌面环境不支持的原生 `prompt/confirm`、点击操作时报错的问题，改用应用内对话框。

### Removed

- [desktop/renderer] 移除供应商页面中的全量模型体检界面，保留单连接测试、单模型测速和 Agent 底层健康检查能力。

- [repository/agent/desktop/renderer] 移除过期排障备忘、历史性能基线、未接入的 Renderer/Agent/Electron 实现、测试孤岛与生成资产逐文件副本，降低目录树和维护噪声；本地性能结果继续按忽略规则按需重建。
- [desktop/renderer] 移除全组件主题视觉 Token 调试工作台（ThemeTokenDebugger）及配套高保真预览、运行时样式注入与配方生成代码，清理相关 SCSS 样式与测试用例。
- [desktop/renderer] 移除 Codex Labs 导航、页面及视觉原型，旧 `/labs` 地址改为显示现有 404 页面并不再打包相关代码和样式。

### Security

- [security/dependencies] 升级 js-yaml、nanoid 与 tar 至安全补丁版本，并为暂无上游修复的 extract-zip 增加 symlink 越界防护和限期审计追踪，恢复 High/Critical 依赖门禁。
- [desktop] 所有普通/富文本剪贴板写入收口到 typed Electron IPC，Provider API Key 仅以 credentialId 请求并在主进程写入及 60 秒条件清理，同时撤销 Renderer 剪贴板权限。
- [Agent/renderer] 将旧 `sandboxMode` 集中解释为结构化文件访问范围，明确终端命令始终以当前 Windows 用户在宿主机执行并继续经过风险、Hook、审批和临时授权门禁，不再暗示操作系统级沙箱隔离

## 0.2.0-beta.4 — 2026-08-07

### Added

- [desktop/renderer] 新增多模式新建页 Surface 路由（`/new?surface=coding|working|chat`）：URL 有效值优先并与侧栏产品模式同步，缺失或无效参数回退到已保存模式并只替换 `surface` 参数；侧栏模式切换直接导航到对应新建页，「新建任务」链接跟随当前 Surface
- [desktop/renderer] 新增 Working 首屏：固定标题与居中空状态布局，单 workspace「选择文件夹」选择器，隐藏本地执行与 Git 分支工具条，新增「规划任务」工作插件（可选中/取消，状态仅属于新建页草稿），并提供规划今天的工作、拆解复杂工作、协调多个项目三层分步建议与中文提示词填入
- [release] 新增 PR `release-parity` 门禁：所有普通 PR 都在 GitHub-hosted runner 上执行 Renderer 最终状态 a11y、x64 Agent 构建、一次性自签证书合成签名与共享 Agent runtime verifier，并在 always 步骤按精确 thumbprint 删除证书、经 ownership marker 校验后清理临时目录
- [desktop] 支持从已完成的 Assistant 回复分叉到共享当前工作树或隔离托管 worktree 的新聊天
- [desktop] 在 Local environment 编辑器中说明 worktree setup 可用的源目录与目标目录变量
- [desktop/Agent/renderer] 新增 Windows-first 集成终端，每个任务拥有一个 ConPTY/PTY 会话，支持 shell profile、主题、回放、尺寸同步、任务关闭清理及经审批的有界终端输出读取
- [Agent/renderer] 新增基于 `.codepilotx/environments/environment.jsonc` 的 Local environment 与 Actions，可保留 JSONC 注释和未知键，并在确定的任务工作目录与环境中重建集成终端运行 Action
- [Agent/renderer] 新增托管 Git worktree 的 branch/working-tree 创建、setup 重试或跳过、永久保留、受保护清理及分层快照恢复
- [Agent/renderer] 新增 Codex 式 Local 与托管 worktree 双向 Handoff，通过完整 Conversation fork、Git 回滚日志和客户端状态确认创建目标任务并在成功后归档源任务
- [Agent/desktop/renderer] 新增共享的 JSON/JSONC Profile v1 分层、结构化写入目标及 Profile 列表/选择 RPC，让桌面端和后续 CLI/TUI 使用同一配置真源并明确提示重启生效
- [desktop/renderer/test] 新增 1200 个真实修改文件、500 轮长会话、30 个任务与三个真实 Agent 会话并发写入时的 Electron 拖动性能验收
- [Agent/renderer] 修改文件卡片新增三文件折叠、Review 文件定位及基于精确文件状态校验的撤销与重新应用
- [Agent/renderer] 新增 Review 摘要扫描、快照重试与文件 Diff 失败的安全诊断日志，便于定位“无法加载变更”问题
- [Agent/renderer] 新增可选的明文 `auth.json` Provider 凭据仓库与本机加密仓库切换流程，迁移会先验证目标再清理源，并明确提示便携性与明文风险
- [Agent/renderer] 新增可跨重启保留的会话未读状态，后台任务完成或失败时显示前景色未读点并在打开会话后清除
- [desktop/renderer] 新增可配置的 Windows 任务系统通知，在权限、提问、完成和失败时提醒用户，并支持点击恢复应用并打开对应任务
- [governance] 采用 Apache License 2.0，并新增贡献指南、行为准则、安全披露策略、CODEOWNERS、Issue/PR 模板与 Dependabot 配置，明确公开协作和依赖维护边界
- [renderer] 新增可持久化的侧栏优先级聚焦视图，集中展示需关注任务并按最近一周自然日整理其余任务

### Changed

- [desktop/renderer] 固定侧栏关注任务区并按真实关注状态切换铃铛提示，补齐置顶筛选、批量已读/归档及 Codex 式透明分类标题与列表间距。
- [Desktop] 侧栏按 Agent 能力动态展示现有入口，并对齐 Codex 的滚动定位、遮罩、粘性分组、悬浮预览与折叠动效。
- [Agent/renderer] 将子 Agent 详情重构为无输入框的只读工作台线程：移除公开直发能力与侧边聊天混淆，保留停止、重试、工作区处理、审批和结构化提问，返回或关闭标签时恢复主对话焦点
- [renderer] 区分普通侧栏与时间线的会话缩进，并将置顶内容固定为会话优先、文件夹随后，保持两组内部的手动顺序
- [renderer] 将侧栏任务按钮的纵向内边距调整为 4px，改善任务行的视觉间距与点击区域
- [Agent/renderer] 将侧栏优先级聚焦视图调整为紧凑型可筛选时间线，默认按最近一周分组，并按等待用户处理、计划待审批和完成未读整理优先任务
- [release] self-hosted 标签打包 job 使用带 ownership marker 的唯一运行上下文隔离 TEMP/APPDATA/LOCALAPPDATA 与 Agent 数据目录，PR `release-parity` 复用相同上下文在 GitHub-hosted runner 上安全隔离并在 always 步骤经校验清理
- [release] 从 Windows package verifier 抽出可复用的打包 Agent 运行时验证门面（PE x64、Authenticode、ready、/api/ready、thread-rpc-v4、Pi provider/model 目录、进程树退出与目录清理），供 PR 合成签名 parity 与人工标签签名包复用
- [release] `version:prepare` 的人工发布指引改为分阶段顺序：先推送签名版本分支并将提交合入 `main`，同步后运行 `version:check -- --tag` 确认目标提交在 `origin/main` 历史，再创建并单独推送签名 `v*` 标签，避免在 `dev` 上同时推分支与标签或未进入 `main` 就打标签
- [desktop/renderer] 移除侧栏会话行未使用的前置图标占位，使会话标题和工作区元信息与日期分组左侧对齐
- [desktop/renderer] 将侧栏会话标题与元信息的双行间距调整为 5px，增强工作区信息层次
- [desktop/renderer] 将侧栏聚焦分组日期标题统一为 UI 字号减 1px 的次级字号，兼顾日期分组层级与可读性
- [desktop/renderer] 移除 Working 首屏项目与插件工具条的顶部内边距，使下方工具条紧贴 Composer 输入面板
- [desktop/renderer] 修正 Working 首屏标题与 Composer 工具条布局，避免下方项目和插件区域被裁切，并将聚焦建议调整为无卡片分步列表
- [desktop/renderer] 调整 Working 首屏 Composer 工具条与工作建议交互，使项目和插件位于输入框下方，并仅在聚焦输入时展示无卡片分步建议
- [docs] 重写开源项目 README，补充产品截图、Beta 下载、功能概览与公开协作入口，并移除过时的能力限制和数据恢复说明
- [renderer] 参照 Claude-like 阅读节奏统一 Markdown 标题、段落、列表项间距、引用、表格与代码排版，优化粗体标题说明分组及表格单元格的均匀内边距与居中对齐，同时保留紧凑摘要及工作台响应式布局
- [renderer] 工作台激活标签统一使用列表选中态主题背景，并在聚焦或悬停时保持激活视觉
- [desktop/renderer] 集成终端跟随外观中的代码字体与字号，以实际工作目录命名标签，移除正常运行工具栏，并采用 220px 默认底栏及标签后添加、右侧关闭的紧凑布局
- [renderer] 将默认 UI 字体切换为 Codex 风格的 system-ui/Segoe UI Variable 回退链，统一语义字重并移除未使用的 MiSans 资源，改善中英混排清晰度并减小 Renderer 资源体积
- [renderer] 收紧侧栏底部“设置/帮助”区域高度，减少纵向留白并为侧栏内容释放更多空间
- [架构] 明确桌面端与后续 CLI 的共享核心、产品定位和能力复用边界，避免多客户端重复实现协议、状态与业务逻辑
- [Agent] 将旧项目可信记录和桌面运行状态从可迁移 `config.json` 幂等搬入机器本地 SQLite，并保留 JSONC 注释、未知字段与多端并发写入语义
- [Agent/renderer] 将会话工具行的展开指示器移至摘要内容后方，并支持按文件展开单次编辑产生的逐行 Diff，旧记录缺少完整证据时保持不可展开
- [desktop/renderer] 将侧栏产品模式菜单扩展为 Coding、Working、Chat 三个可持久化占位入口，并补充 Codex 风格的两行功能说明
- [renderer] 按 Codex 的信息层级重组配置来源、智能体默认设置和诊断区域，统一下拉框摆放并消除重复审批名称
- [desktop/renderer] 桌面端导入或重开项目时自动信任项目配置来源，并移除仅适用于 CLI 的手动信任状态入口
- [renderer] 统一移除共享交互行的文字装饰，避免链接型菜单项显示下划线
- [renderer] 精简供应商目录的信息层级，移除重复标题与说明，并将筛选结果数并入搜索工具栏
- [renderer] 为 Composer 变更摘要增加严格顺序的胶囊位移与回底按钮进出动画，并在减少动态效果时立即完成切换
- [renderer] 移除 Composer 变更摘要透明布局容器的额外内边距，并同步对齐计划预览宽度
- [renderer] 移除 Composer 变更摘要外层装饰，统一状态胶囊与回底按钮高度，并仅在时间线离开底部时显示回底按钮
- [renderer] 将应用更新入口从设置菜单移至侧栏底部状态胶囊，在检查、下载、安装和失败阶段替换帮助按钮并提供进度与重试反馈
- [renderer] 将 Composer 变更摘要重构为状态胶囊与回到底部按钮，并保留计划预览、Review 入口及完成、失败和中断语义
- [renderer] 将生产界面的浮层与抬升表面统一为克制的纯黑阴影，消除亮暗主题中的发光感
- [renderer] 将侧栏、工作台及 Review 文件树调整为真实宽高与 flex 布局实时拖动，使相邻内容随指针自然重排并仅在结束时持久化尺寸
- [Agent/renderer] 子代理改为共享工作区并行执行，并在完成后按真实工具修改立即向父任务上报状态与文件
- [renderer] 将全局错误详情格式化与提示组件改为异常发生时按需加载，避免非错误路径占用 `/new` 首屏预算
- [desktop/renderer] 统一侧栏、菜单、Composer、设置、Review 与会话摘要的紧凑交互行规格和状态反馈，减少同类控件的尺寸、圆角与浮层效果漂移。
- [renderer] 收紧会话摘要与中等宽度阅读区，并调整响应式断点，使约 1920px 窗口同时打开侧栏和 Review 时仍保留置顶摘要
- [renderer] 移除共享动作按钮阴影，并降低卡片、弹窗与浮层的全局阴影层级
- [配置] 将用户与项目持久配置真源改为支持 JSONC 的 `config.json`，升级时从旧 `config.toml` 一次迁移且保留原文件，便于手动备份和换机恢复
- [renderer] 对齐 Codex Electron 的紧凑 Dropdown、Popover 与右键菜单密度，缩短菜单行、浮层留白和内容型弹层尺寸，同时保留摘要面板布局
- [renderer] 会话与项目悬浮卡复用统一信息骨架，会话标题支持单击内联重命名，项目统计按活动任务计算
- [renderer] 将 canonical 会话助手回复的复制按钮改为常驻显示，便于直接发现和使用
- [renderer] 将“新特性”从一级页面调整为全局 Dialog，查看版本记录时保留当前工作上下文
- [renderer] 将“新特性”Dialog 调整为版本列表与更新内容双滚动区，历史版本切换和长更新日志可独立浏览
- [desktop] 重构工作台分栏为容器驱动的响应式比例布局，窗口缩放和多面板并排时保留用户尺寸偏好
- [ci] Renderer 性能预算改为非阻塞观测：完整性能场景仍会执行并上传报告，共享 runner 的绝对时延不再直接阻塞合并，待样本稳定后再升级为同机相对门禁

### Fixed

- [desktop/renderer] 修正时间线分类、空状态、任务标题与工作区元信息贴近侧栏边缘的问题，统一为 Codex 式双层 8px 横向基线
- [desktop/renderer] 修复 Windows 自定义安装目录中的编辑器与开发工具无法出现在外部打开菜单的问题，补齐 Visual Studio、GitHub Desktop、File Explorer、Windows Terminal 和 IntelliJ IDEA 检测，并统一应用图标与失效默认项回退
- [release] agent-runtime-verifier CLI 统一支持 `--name value` 与 `--name=value` 两种参数形式，并将 Agent 路径解析为绝对路径后再启动与验证，避免 Windows 上相对路径启动拿不到子进程 pid 导致进程树清理失败
- [release] release-parity 锚点链验证改在 Windows PowerShell 5.1 完成：用 ExtraStore 与 AllowUnknownCertificateAuthority 构建链后固定链根 thumbprint 必须等于锚证书，移除对 PowerShell 7 的依赖（本地开发机 Store 版 pwsh 别名无法被 Bun 直接启动），根存储依旧不写入
- [release] release-parity 合成签名流程修复：运行上下文与证书创建拆分为独立步骤，证书受信根导入与清理改用 X509Store，避免 PowerShell 7 下 Import-PfxCertificate 挂起及用户根存储的 UI 限制
- [release/test] 修正发布契约测试与 Authenticode 拒绝路径测试的 CI 环境差异：契约断言按 LF 归一化读取 workflow，Authenticode 用例改用确定未签名的非 PE 文件验证拒绝路径，不再依赖本机/CI bun.exe 的签名状态
- [Agent] 统一 Windows 测试夹具清理到共享 helper：teardown 先关闭数据库、watcher、子进程与服务再删除路径，EBUSY/EPERM/ENOTEMPTY 按固定约 5 秒窗口重试并严格顺序清理，重试时强制 GC 释放 Bun sqlite 延迟持有的 -wal/-shm 句柄，持续句柄占用成为真实测试失败而非被静默吞掉
- [desktop/release] 将打包 ConPTY 冒烟的单阶段预算提高到 30 秒、进程总预算提高到 90 秒，避免 GitHub-hosted Windows 冷启动长尾误判安装包损坏，同时保留严格超时
- [Agent/release] 将 Windows 全仓测试数据库夹具的可恢复清理等待扩展到 5 秒，避免短暂文件占用误阻塞测试并卡住发布，保证普通 PR CI 的单元测试正常执行，同时持续占用时仍保留失败
- [renderer/release] 为会话处理过程的原生 disclosure 提供稳定可访问名称，避免空摘要在 Review 场景触发 WCAG `summary-name` 违规，保证普通 PR `release-parity` 的 a11y 检查正常执行
- [renderer/release] 外观主题编辑器在异步 code-theme seed 完成前声明 busy，并将预览强调色调整到 WCAG AA 对比度后再运行 a11y 扫描，避免未完成样式与 `#339cff` 白底低对比度，保证普通 PR `release-parity` 的 a11y 检查正常执行
- [desktop/release] 打包桌面启动 Sidecar 时若 Windows 服务账户缺少 Documents 已知文件夹，则回退到其 home 下的 Documents，并将环境求值、进程创建与 stdin 关闭分阶段诊断，避免自托管发布 Runner 在创建 Agent 前反复失败
- [desktop/release] Sidecar 连接失败日志新增固定枚举的启动阶段与错误码，发布 smoke 可在不输出路径、异常正文或凭据的前提下区分托管地址、命令解析、进程创建、Agent 就绪与桌面加载故障
- [release] Windows 打包 smoke 不再把 `CODEPILOTX_*`、GitHub Actions、runner 或签名发布变量传入产品进程，仅注入当前测试白名单，避免 Windows 环境块膨胀导致 Sidecar 无法创建并阻止 CI 凭据进入桌面与 Agent
- [release] Windows 打包 smoke 在持久 runner 上最多等待 180 秒接收 `desktop.ready`，同时在桌面进程先退出时立即失败，避免冷启动抖动误报且不掩盖真实崩溃
- [release] Windows 打包 smoke 超时时仅输出最近的安全事件名轨迹，为持久 runner 启动卡点保留诊断证据且不暴露路径、消息或凭据
- [renderer/release] Renderer a11y 首次 Vite 页面预热使用独立 240 秒预算，正式 WCAG 场景仍保留默认短预算，避免持久 Windows runner 冷编译超过 120 秒时中止整套审计
- [desktop/release] Sidecar 为签名 Agent 冷启动保留 60 秒 ready 消息窗口，并让 packaged smoke 输出有限枚举的失败类型，避免持久 runner 反复提前终止同一合法启动
- [release] Windows 打包 smoke 显式清除 runner 注入的托管 Agent URL 并固定隔离 userData，确保验证刚打包的 owned Agent 而非外部服务
- [renderer/release] Visual 与 a11y Playwright 测试通过配置白名单启动器动态分配严格回环端口并正确传递失败状态，a11y 复用正式 `new` 场景路由在审计前以独立 120 秒预算预热首次 Vite 页面且单个 WCAG 场景仍保持默认 30 秒，同时提高 Review diff 小字号文本及增删高亮背景的 WCAG AA 对比度，避免持久 Windows runner 残留进程、冷启动误报或假绿结果，保证普通 PR CI 与 `release-parity` 正常执行
- [Auth Broker/test] 并发 PKCE 交换测试按响应状态识别并显式验证唯一成功与重放请求，不再假定 Promise.all 中第一个请求必定先取得 attempt，避免不同 runner 调度顺序造成误报
- [Agent/release] Local environment 生命周期在 Windows 复用 Agent 既有的 PowerShell 可执行文件解析，优先使用可用的 pwsh 并以 SystemRoot 下 Windows PowerShell 回退，避免 release runner 的服务 PATH 缺少 powershell.exe 时 setup 误报失败
- [Agent/test] ConfigService 关闭时等待文件 watcher 完成释放，配置迁移测试复用数据库 reset 的 GC 辅助有界 EBUSY 重试，避免 Windows 句柄滞留误报失败
- [desktop/release] 修复 Windows 打包重复从源码编译已提供官方 N-API 预构建产物的 node-pty、导致缺少本机 Spectre C++ 组件时无法产出安装包的问题，并保留打包态 ConPTY 实际运行校验
- [Agent/desktop/renderer] 修复 Handoff 重放与崩溃恢复、托管 worktree 并发变更、终端 Action 换代接入、PTY 单实例及输出镜像积压问题，并让 Local environment 结构化编辑保留嵌套 JSONC 注释和未知键
- [desktop] 修复集成终端 desktop-host RPC 空闲租约过期后持续复用旧连接的问题，遇到明确未授权响应时重新握手并限次重试
- [renderer] 修复集成终端按内容固有宽度收缩、未横向铺满整个底部面板的问题
- [desktop] 修复开发编排器未将 Agent 标记为桌面托管进程、导致集成终端无法建立 desktop-host RPC 连接的问题，并为初始化拒绝增加安全错误码日志
- [renderer] 修复侧栏底部“设置”入口的悬停背景被局部透明样式覆盖的问题，恢复统一的圆角反馈
- [Agent/desktop] 桌面设置保存只写相对有效配置真正变化的叶子，避免修改侧栏或外观时把 Profile 覆盖值物化回用户配置
- [renderer] 修复新对话首条消息在路由切换间隙复用已消费 inputId 的问题，避免后续新任务提示“inputId 已被其他请求使用”。
- [renderer] 修复 Composer 胶囊未按当前对话接入真实 Git Diff 统计，并移除单条命令的冗余命令组展示
- [Agent/renderer] 修复开发态首次进入会话时 Vite 瞬时 504 被懒加载缓存为持续错误的问题，增加代理有限重试与单次自动重载兜底
- [desktop] 修复 Electron 主进程打包 JSONC 解析器时遗留相对 require、导致开发启动无法加载 `./impl/format` 的问题
- [Agent/renderer] 修复 Review 批量 Diff 在新 Renderer 与旧 Agent 版本错配时永久加载的问题，增加能力降级、读取超时及慢请求阶段诊断
- [renderer] 修复平滑回到底部途中中间滚动事件重新显示按钮的问题，确保 Composer 摘要退出动画完整播放
- [release] 发布机 workflow 的脚本步骤显式设置 TEMP/TMP 为 runner 工作区临时目录，避免服务账户系统 TEMP（C:\Windows\TEMP）与磁盘真实目录大小写不一致导致路径断言类单元测试失败
- [desktop/renderer] 修复设置搜索输入未连接现有键盘结果处理器的问题，恢复方向键选择、Enter 导航和搜索结果定位。
- [desktop/renderer/test] 更新 Settings 综合视觉用例对统一动作按钮契约的断言，避免继续校验已移除的旧无边框样式。
- [desktop/renderer] 修复紧凑交互行悬停色被错误映射为主表面背景的问题，还原 Codex 的透明叠加层级，并让侧栏、Composer 与会话摘要获得清晰一致的 hover 反馈。
- [renderer] 修复分支与项目搜索弹层底部动作区被列表压缩并落入 Composer 功能栏的问题
- [Agent/Desktop] 修复 Windows 开发环境中文件原子覆盖失败及 Agent 自重启中断对话的问题，并在重启恢复时正确收尾运行中的工具调用
- [renderer] 修复 Composer 功能栏与输入主体背景层级相同的问题，通过主题主表面与面板表面派生更深的功能栏层级
- [renderer] 修复 MetaChip 悬停和展开状态背景不明显的问题，使用主题化次级按钮状态增强交互辨识度
- [renderer] 将任务命令面板蒙层统一为深色遮罩，避免深色主题下页面背景泛白
- [renderer] 修复新任务建议卡片悬停时背景反向变暗的问题，使默认态与悬停态的表面层级和 Codex 保持一致
- [renderer] 修复模型搜索子菜单的网格列错位，避免模型名称被挤压成单字符省略
- [renderer] 全面修正 Radix 组件语义、键盘焦点和 WCAG 2.2 AA 无障碍问题
- [renderer] 修复侧栏“展开显示”和“折叠显示”操作行高度大于任务行的问题，统一任务、项目与置顶列表的紧凑布局
- [renderer] 补全任务/设置侧栏、右侧/底部工作台面板及会话/项目悬浮卡的退出动画，并隔离大 Diff 关闭过程中的逐帧重排，避免重开左侧栏后工作区错位
- [renderer] 对齐 Codex 审阅来源分组与文件筛选区域，并在文件树展示新增、修改、删除等 Git 状态图标及目录变更标记
- [renderer] 修复工作区总变更较大时小文件误用旧虚拟 Diff 的问题，统一普通与虚拟审阅渲染，并补齐 Codex 风格语法色、标记条、hunk 和文件图标
- [renderer] 重构主题语义背景与 Review Diff 配色，Codex 主题的增删色现在派生可读的行级和文字级高亮，并补齐右侧面板背景
- [renderer] 修复侧栏可排序会话、项目和置顶项仅悬停时提前显示拖动光标的问题，改为实际拖拽期间显示
- [Agent/renderer] 修复模型选择器遗漏已配置 Provider、误显示未登录 OAuth Provider 及历史会话 Provider 与模型错位的问题
- [desktop] 稳定开发环境的 HMR 直连与动态模块加载失败恢复，避免瞬态更新导致持续白屏
- [renderer] 修复重命名对话弹窗的受控输入值被原标题反复恢复的问题，并移除存在系统冲突的 `Ctrl+Alt+R` 快捷键
- [renderer] 修复手工重命名已持久化但顶部和侧栏未立即显示的问题，统一所有入口的会话状态更新链路
- [Agent/Desktop] 修复 Electron 克隆仓库、创建分支和切换分支误用浏览器 mock 的问题，改由受 capability 约束的 Agent RPC 执行真实 Git 并返回最新工作区状态
- [agent] 修复 Review 刷新竞态与 linked worktree Git 元数据漏监听，并新增批量暂存、取消暂存和还原能力，确保快照最终收敛且批量操作只刷新一次
- [desktop] Review 使用分级 Diff 加载和虚拟文件树，并在大规模会话与并发文件更新期间保持真实布局拖拽。
- [agent] 更新会话标题时综合首轮目标与近期已完成对话，避免提交、推送等单次收尾操作覆盖会话主线
- [Agent/renderer] 为“新特性”内置当前版本更新记录，并在 GitHub 限流或离线时回退显示，避免 Dialog 只剩错误状态
- [renderer] 修复顶部帮助菜单“新特性”点击无响应的问题，使其可以打开版本更新记录 Dialog
- [release] Windows 打包校验会重试清理被短暂占用的临时目录，发布流程改用 Release ID 校验、上传和发布草稿，避免文件锁与草稿标签查询语义导致人工签名标签发布误失败
- [agent] 数据迁移临时库使用 DELETE journal 并延长文件锁重试窗口，避免 Bun 在 Windows 上残留 WAL 句柄导致原子发布误失败。
- [agent] 数据迁移失败后的临时库清理不再覆盖原始校验错误，残留临时文件会在下次启动前继续清理，避免 Windows 文件锁改变故障语义。
- [agent] 数据迁移与校验连接改用一次性查询助手并严格关闭，迁移期间不再缓存 Statement，彻底释放 Windows 上 SQLite 文件句柄，避免合并迁移偶发 EBUSY。
- [renderer] 修复任务侧栏长标题硬截断和动作区固定占位问题，溢出标题改为渐隐并在悬停时滚动展示完整内容
- [renderer] 修复 Composer 执行计划弹层被按胶囊内容收缩的定位包含块挤压到约 220px 的问题，改为相对完整摘要区域内容自适应居中（最小约 480px、最大 760px，不足时继续缩小）且不产生横向溢出，并保持胶囊尺寸与悬停/焦点关闭等现有行为不变
- [Agent/renderer] 修复动态权限请求未进入桌面审批投影、无法授权及响应后卡片无法及时关闭的问题，并支持主与子 Agent 选择更小的授权范围

### Fixed

- [renderer] 统一右侧 Dock 与主工作区的背景色，消除工作台分栏之间的非预期色差
- [renderer] 修复侧栏仅任务和项目区域滚动的问题，使“新建任务”下方的导航、提示、时间线与项目内容共享滚动区域，并保持头部、新建任务和账户栏固定；内容滚过固定入口时显示边界分隔线

### Removed

- [renderer/test] 移除不应入库的 Workbench 视觉截图基线并忽略后续本地产物，避免二进制快照污染仓库历史
- [renderer] 移除不可达的旧会话渲染、workflow 事件调试入口及桌面调试模式，统一使用 canonical 会话与标准弹层行为
- [release] 移除 Beta 自动升版、Release PR 编排、仓库发布 Skill、预检证明与回执及每日发布机巡检，版本改回人工准备并通过签名标签触发打包发布

### Security

- [dependencies] 升级 fast-uri 至 3.1.5、ip-address 至 10.4.0，并将 undici 统一对齐到 8.10.0，修复新增的 host confusion、IP 前导零八进制解析 SSRF 与跨用户信息泄露/解析崩溃公告（GHSA-7p8r-x3mc-p8w7、GHSA-mwp4-54f8-5fhr、GHSA-4cwx-7wf7-3272）
- [release/dependencies] 将 `brace-expansion` 统一升级到 5.0.9，修复可通过无界中间数组触发拒绝服务的 `GHSA-rgw5-rvv9-x895`
- [renderer/pi-agent-core] 将 Markdown HTML 清洗、指令属性和跨环境路径修剪改为单次线性扫描或标准路径 API，避免嵌套标签绕过清洗及攻击者可控输入触发 ReDoS
- [Agent] auth.json 的外部修改检测改用仅驻留进程内的精确快照，避免对凭据内容生成可离线猜测的摘要

- [agent] 分叉 setup 路径变量和输出仅用于受信任的有界内存执行链路，不写入历史、事件、日志或环境增量
- [Agent/desktop] 集成终端输出默认进入有界脱敏内存镜像，`terminal.read` 遵循任务全局权限策略，且输出继续禁止写入 SQLite、事件或日志
- [Agent/desktop] Local environment 脚本按项目与配置摘要显式信任，setup 环境增量采用受限原子文件保存，Action 命令、环境值和原始输出不进入 renderer RPC、SQLite、事件或日志
- [Agent/desktop] 托管 worktree 的复制、恢复和删除验证受管根目录、普通文件及 symlink/reparse 边界；终端输出仅在内存中有界保留并经审批、控制字符过滤和敏感信息清理后提供给 Agent
- [Agent] Profile 禁止保存 Provider 凭据、MCP、Hook 和机器设施配置，项目向上查找同时排除用户 `config.json`，避免可移植文件携带秘密或被误判为项目来源
- [agent] Git 命令统一采用字面 pathspec、流式输出限制和公开错误 allowlist，阻止批量 Review 路径扩展、未跟踪符号链接越界读取及 stderr 敏感信息泄露
- [ci] 安全 CI 仅在 PR 上运行，避免同一提交的 push 与 pull_request 使用相同检查上下文时，非门禁 push 抖动错误阻塞受保护分支合并；CodeQL 仍扫描受保护分支 push
- [ci] 新增覆盖版本一致性、High/Critical 依赖审计、类型检查、单元测试、Renderer CSS 规则和全仓构建的 Windows CI，并通过最小权限、不可变 Actions 提交、禁用持久凭据、超时与并发取消降低供应链风险
- [dependencies] 将 MCP SDK、Hono、Wrangler、Electron、electron-builder 与 Vite 升级到包含安全修复的版本，并为暂不可升级的 React Router 公告增加有负责人和到期日的审计豁免
- [governance] 明确私密漏洞报告的确认、初步评估与持续同步目标，让报告者能够预期安全响应节奏

## 0.2.0-beta.3 — 2026-07-29

### Fixed

- [release] 修复 Windows 临时目录短暂占用和 GitHub 草稿 Release 无法按标签回读造成的发布失败，并将草稿校验、附件上传与发布切换为不可歧义的 Release ID 流程

## 0.2.0-beta.2 — 2026-07-29

### Added

- [renderer] 会话时间线新增可持久化的处理过程、命令组和单条命令三级折叠，并将文件改动固定显示在最终回复之后
- [renderer] 调试模式新增仅驻留内存的会话性能指标，展示 SSE 速率、流式投影耗时、React 提交、长任务与 JS 堆趋势且不记录会话内容
- [desktop] 新增从 GitHub Releases 查看当前版本及历史更新日志的“新特性”页面，并在发布流水线中自动生成 Release
- [Agent/Desktop] 新增本地用量统计、多厂商余额与套餐查询及独立加密计费凭据，使使用情况和计费页可统一查看应用消耗与账户额度
- [Agent/Desktop] 新增 `test:plan`、`test:plan:rpc` 与显式付费的 `test:plan:live`，可在隔离数据目录中自动验证 Plan 桌面全流程、协议事件及刷新恢复
- [desktop] 新增 Codex 风格“编辑项目”弹窗、项目图标颜色选择器和“设置 → 环境”两级页面，分离目录编辑与默认模型、指令、共享来源管理
- [desktop] 新增统一 Slash Commands 注册与分发机制，接通会话命令、技能菜单和 `$` 技能调用，并修复技能提交格式
- [projects] 新增稳定 projectId、多目录、项目指令、共享来源和项目管理抽屉，使一个项目可以承载多条独立任务
- [desktop] 新会话任务建议会结合最近任务、Git 状态和长期记忆生成，并在智能建议不可用时保留本地建议
- [desktop] 新增 Codex 风格会话 Hover Card，集中展示会话时间、所属项目和最近工作分支
- [renderer] 新增全局上下文编辑菜单并接通顶部“编辑”命令，输入框、编辑器和业务右键入口共享撤销、剪贴板及选区操作
- [renderer] 新增 Coding/Working 工作模式入口和拉取请求占位页，完善桌面侧边栏的产品导航
- [renderer] 新增统一的“设置 → 插件”管理页，在同一入口管理内置插件、MCP 服务器和当前工作区技能
- [agent] 新增技能目录查询、受控详情读取和持久化启停能力，禁用状态从下一回合起同时作用于主任务与子任务
- [agent] 新增原生 MCP 运行时，支持 stdio、Streamable HTTP 与兼容 SSE 回退，并将工具和资源接入每轮不可变工具目录
- [agent] 内置默认启用的 Context7 MCP，支持匿名访问及通过 CONTEXT7_API_KEY 环境变量提高请求限额
- [agent] 新增可切换 stdio/HTTP 的共享 MCP 测试服务器，覆盖工具、资源、Prompt、认证和传输故障场景
- [agent] 新增长期可运行的 MCP 对话调试实验室，提供调用记录、脚本化多轮对话、断言、故障注入及 stdio/HTTP 启动命令
- [agent] MCP 运行时新增 Server instructions、原始工具白名单/黑名单、必需 Server、分级审批和 Streamable HTTP OAuth，并为调试实验室增加完整 PKCE OAuth 探针

### Fixed

- [Agent/Desktop] 修复旧数据库迁移和损坏外观设置仍创建额外备份文件的问题，继续通过临时库校验、原子发布和精确重置保留业务数据且不复制敏感内容
- [Desktop] 修复 Pi Provider v2 环境变量凭据已使模型可用时仍被误判为“未配置模型”、导致无法发送消息的问题
- [renderer] 移除 Markdown 表格表头的独立背景、文字颜色和字重覆盖，恢复继承式展示
- [renderer] 移除会话处理组内容容器的默认缩进，由外层与命令组变体分别控制内容间距
- [renderer] 移除会话处理组完成状态的勾选图标并改用 Flex 标题布局，避免状态图标与文字重叠
- [renderer] 修复历史过程文字错误显示助手复制操作的问题，仅在最终回复区域提供复制按钮
- [renderer] 修复会话处理标题、生命周期、命令组及工具摘要字号偏小的问题，统一使用 14px UI 字体
- [renderer] 修复结构化工具详情显示包装 JSON 且生命周期操作计入命令数量的问题，改为展示主参数、核心结果和独立状态行
- [Agent/renderer] 修复会话工具摘要暴露内部工具名且文件修改未进入时间线的问题，按实时状态展示语义操作并恢复过程文件行与最终改动汇总
- [Agent/renderer] 修复中间助手说明被误判为最终回复的问题，使整轮处理文字、工具活动与子代理状态可由外层处理过程统一折叠
- [renderer] 修复会话命令时间线错误使用整轮耗时和“Bash 完成”文案的问题，改为按命令计数、展示单条耗时并支持分别复制命令与结果
- [Agent/Renderer] 修复自动标题、手工重命名和标题更新错误刷新会话活跃时间的问题，并恢复已受影响历史会话的原有排序
- [Renderer] 修复会话 Hover Card 二级动态模块偶发加载失败并触发页面错误边界的问题
- [Renderer] 修复重命名对话输入框在会话刷新或输入时反复全选的问题，恢复中文输入与正常提交
- [renderer] 移除输入区变更摘要栏默认态与悬停态的阴影，保持界面视觉更轻量
- [renderer] 统一 Markdown 行内代码、代码块与 canonical 工具输出的无边框 5% 前景色混合背景
- [Renderer] 更新会话标题时在顶部、侧栏和 Hover Card 显示会话级 shimmer 加载反馈
- [renderer] 修复 canonical 过程输出与文件补丁未跟随外观代码字体设置的问题
- [renderer] 统一 Markdown 代码块、表格与 canonical 过程详情的侧栏主题背景，恢复内容区域的视觉层级
- [Renderer] 修复 canonical 会话已有用户输入但 legacy 消息未加载时“更新会话标题”仍被禁用的问题
- [Agent/Renderer] 补齐顶部会话重命名及快捷键，并支持根据最新完成内容重新生成短标题
- [Agent/Renderer] 会话首条消息现在异步生成最多 20 字符的语义标题，并统一截短历史长标题展示，避免顶部与侧栏被超长标题占满
- [renderer] 修复会话切换时旧时间线重复渲染、legacy 全量快照重复投影、折叠工具卡提前挂载及同工作区重复刷新的卡顿
- [renderer] 修复多轮流式对话重复分发 token 事件、逐事件复制 canonical 状态和无界保留 live 去重 ID 导致的掉帧与内存增长
- [Agent] 修复 Shell 风险分类把源码凭据命名中的 `nc` 子串误认作网络命令的问题，普通 Git 暂存、提交和源码搜索不再被误报为凭据外传
- [renderer] 补齐桌面 RPC 握手中的 Pi Provider 配置与认证 capability，恢复模型配置、凭据管理和 OAuth 会话调用
- [Agent/Protocol] 修正审批、提问及中断恢复事件的 v4 载荷漂移，新的 durable event 与 SSE replay 统一通过 manifest 校验
- [renderer] 统一侧栏账户菜单、命令面板、宠物商店与设置页的宠物图标，避免同一功能出现不同视觉符号
- [renderer] 图标分片动态加载失败时保留通用文件或文件夹图标并清除失败缓存，避免打开会话时弹出全局错误且后续图标持续缺失
- [renderer] 让弹层内搜索框自动填满可用内容宽度并禁止菜单横向溢出，修复项目切换弹层出现横向滚动条的问题
- [Agent/Desktop] 修复桌面启动导航竞态、Electron 控制台与 CSP 警告，并用 Pi 约束工具稳定任务建议结构化输出，避免正常模型 RPC 被误报为慢请求
- [Agent] 支持标准 unified hunk 并强化文件工具调用约束，减少 apply_patch 上下文歧义和写文件失败
- [renderer] 完成审阅、模型中心、记忆设置与可搜索下拉的统一搜索控件迁移，修复图标错位、键盘交互和 Renderer 类型检查失败
- [renderer] 统一搜索与可搜索下拉控件的图标、清除、焦点和键盘行为，并修复模型菜单样式受设置页加载顺序影响及旧搜索响应覆盖新结果的问题
- [renderer/desktop] 修复会话时间线 SCSS 截断导致的 Renderer 编译失败，并为桌面页面补充内容安全策略，避免启动时出现 CSP 安全警告
- [Agent] 修复 Windows SRT 误选 Microsoft Store PowerShell 导致工具命令拒绝访问，并强化文件路径与 apply_patch 的模型调用契约，减少无效工具重试
- [Agent] 修复 Windows 大型工作区因重复 Read/Write ACL 传播导致的 SRT 初始化超时，并将故障 worker 的 EPIPE 收敛为单次工具失败，避免 Agent 整体退出
- [renderer] 将会话和项目尾部元素间距调整为 `gap-3`，统一审批状态与操作控件的布局
- [renderer] 侧栏分组的操作按钮和折叠箭头默认隐藏，仅在悬停分组标题时显示；箭头展开状态即时响应
- [agent] 修复 Windows CRLF 文件的多行 Edit 失配、普通源码写入被安全规则误拒和 SRT 故障 worker 被复用的问题，恢复工作区可靠写入并保留沙箱失败关闭
- [Agent] 保留未来版本数据库的未知结构与 user_version，并将已知旧 history 数据代际原地迁移到前向兼容基线
- [Desktop] 合并相同桌面设置快照的并发保存请求，并串行发送不同快照，减少 Windows 配置写入竞争
- [agent] 串行化 config.toml 写入，修复工作空间依赖迁移在 Windows 上返回内部错误
- [Agent/Desktop] 修复 MCP 项目信任、持久化顺序及合法环境变量引用处理
- [Agent] 修复不同工作树切换时清空全局会话，并允许旧版本忽略未来增量存储结构
- [Agent/Desktop] 修复 API Key 测试丢失厂商失败原因并展示 RPC 异常堆栈的问题，失败结果现在会脱敏后作为普通状态反馈返回
- [renderer] 修复项目模型改造导致的侧栏视觉回归和项目置顶失效，同路径项目现在按稳定 projectId 独立置顶
- [renderer] 修复普通弹层菜单项使用固定小字号的问题，使菜单文字统一跟随外观设置中的界面字号
- [renderer] 统一下拉菜单与上下文菜单二级弹层的水平间距，避免子菜单贴近或覆盖父菜单边缘
- [renderer] 修复侧栏剩余用量子菜单与主菜单距离过近的问题，增加两级菜单之间的水平间隙
- [renderer] 修复侧栏账户菜单仅跟随设置触发器宽度的问题，使菜单铺满侧栏内容区并保留一致的左右间隙
- [renderer] 修复侧栏账户菜单宽度脱离侧栏、账号信息与宠物入口缺失及额度信息拥挤的问题，菜单现在跟随侧栏宽度并通过二级菜单展示剩余用量
- [renderer] 修复统一动作按钮未使用标准前景色的问题，同时保留危险和禁用状态的语义颜色
- [desktop] 修复设置页与仓库克隆弹窗无法启动 GitHub 登录及登录失败静默无提示的问题
- [agent] 修复兼容技能目录间的 Junction 别名导致整个技能目录扫描失败的问题，同时继续拒绝指向配置根之外的链接
- [renderer] 修复 Radix Dropdown、Context Menu、Popover 及子菜单被旧定位样式覆盖的问题，恢复锚点定位、视口碰撞翻转和统一实色外观
- [renderer] 修复普通设置下拉框无法显示当前选项文字、控件缩成仅剩箭头的问题，选项标签改为跟随 UI 字号

### Changed

- [renderer] 会话生命周期状态行改用计划、权限、提问和子代理操作各自的语义图标，并为运行状态增加扫光反馈
- [renderer] 已完成的命令组标题增加终端语义图标，便于区分处理过程与命令集合
- [renderer] 移除处理组完成态图标的额外绿色覆盖，使语义图标继续继承时间线中性色
- [renderer] 收紧命令组与单条过程卡的内容缩进，移除命令列表左侧边框和标题内边距
- [renderer] 统一命令详情卡的垂直外边距并移除窄屏左侧缩进
- [renderer] 将输入框发送选项按钮恢复为语音输入麦克风入口，为后续语音功能保留固定位置
- [renderer] 将输入区计划摘要改为悬停或聚焦预览，并支持点击文件变更直接在右侧打开审阅面板
- [renderer] 单条命令卡改用向右和向下两个独立 Chevron 图标表示收起与展开状态
- [renderer] 会话处理过程与命令组改用向右和向下两个独立 Chevron 图标表示收起与展开状态
- [renderer] 将右键菜单与侧栏行的 flex/grid 布局改为显式语义选择，移除纯文本菜单与简单导航的空列占位并保留图标菜单及项目、会话行的跨行对齐
- [renderer] 互换侧栏“项目”分组的整理与添加按钮位置，使整理菜单位于添加项目按钮左侧
- [renderer] 互换侧栏“最近”分组的整理与新建任务按钮位置，使整理菜单位于新建任务按钮左侧
- [renderer] 菜单项布局改由菜单容器显式选择 flex 或 grid，纯文本选择菜单不再保留空图标列，带图标菜单继续保持多列对齐
- [Agent/Desktop] Shell 静态风险默认采用平衡级别，并可在设置页切换严格、平衡或宽松策略，将可疑但非灾难级命令接入现有审批流程
- [Agent] 将模型 Provider 配置升级为 Pi 原生 v2，支持三类兼容 API、自定义模型、安全端点发现和独立原子缓存，并对无法可靠迁移的旧配置停用后给出安全诊断
- [Agent] 文件编辑主链对齐 Pi 批量 Edit，并将 apply_patch 调整为按需约束工具，减少模型生成补丁格式失败
- [Agent/Desktop] Windows 命令执行改为 Pi Hook 门禁后的本机直跑，移除 SRT 初始化与安装界面，并补充分阶段脱敏执行日志
- [renderer] 统一弹层菜单选中勾的尾部右对齐布局，并调整侧栏工作模式与整理菜单的选中态排列
- [renderer] 将项目 Hover Card 最大宽度调整为 300px，保持紧凑布局并支持路径换行
- [renderer] 将项目 Hover Card 最大宽度调整为 350px
- [renderer] 将项目 Hover Card 最大宽度进一步收窄至 360px，减少短内容场景的空白
- [renderer] 将项目 Hover Card 最大宽度调整为 450px，减少浮层对会话内容的遮挡
- [renderer] 对齐侧栏整理菜单的分组标题与排序层级，匹配 Codex 的菜单结构
- [renderer] 将侧栏整理菜单的选中勾移至菜单项左侧，贴合 Codex 的菜单布局
- [renderer] 将项目 Hover Card 调整为 Codex 风格，显示完整会话统计和全部项目目录
- [renderer] 统一项目和会话 Hover Card 的侧栏外定位与即时打开行为，改善侧栏浮层访问体验
- [renderer] 为“置顶、项目、最近”侧栏分组增加 Motion 高度与透明度展开/收缩动画，并遵循 reduced-motion 设置
- [Agent/Desktop] 将模型默认文件编辑入口切换为多文件 `apply_patch`，保留延迟兼容的 `Edit`，并补齐 Read 快照、敏感路径整单审批和安全错误反馈
- [renderer] 将输入框执行计划状态改为按完成步骤递增的圆形进度，并在会话执行出错时显示错误图标
- [renderer] 将输入框上方的执行计划摘要对齐 Codex 的默认折叠交互和紧凑滚动样式，减少长计划遮挡会话内容
- [renderer] 让执行计划摘要按内容自适应宽度，并将文件增删统计分组展示
- [renderer] 调整输入框执行计划浮层的水平偏移与摘要间距，使展开位置更贴合会话布局
- [renderer] 侧栏恢复按项目或单列表组织、独立任务排序和持久手动顺序，并补齐项目悬浮编辑、置顶混排及项目页面同步。
- [renderer] 将主会话执行计划从时间线迁入输入框上方的变更摘要，以紧凑步骤卡和当前步骤状态集中展示执行进度
- [Agent/Desktop] 打通供应商、账户连接与用量成本数据流，账户和用量页面仅展示已配置厂商，并将凭据、余额套餐与历史分析职责分离
- [Agent/Desktop] 重构普通 Chat 的 Turn、实时 steer、持久 FIFO、精确中断、权限和结构化提问链路，使运行中补充消息按明确意图可靠投递
- [agent/renderer] 收敛多供应商 Prompt 缓存策略，补齐 GPT-5.6 显式稳定前缀缓存及缓存读取、写入和未缓存用量展示
- [renderer] 侧栏恢复 Codex 风格三列项目行、独立折叠箭头和悬浮操作，并将高级项目配置统一迁移到“设置 → 环境”
- [projects] 项目任务改为持久化 cwd、运行根和指令来源快照，侧栏固定为置顶任务、项目任务与无项目任务三层结构
- [renderer] 统一文字及图文动作按钮的尺寸、圆角和主题自适应中性容器，并修复浅色主题出现暗色按钮背景的问题
- [Agent/Desktop] 将 Plan 重构为 `<proposed_plan>` 对话式只读流程，并为 Chat 主任务新增独立的执行进度计划
- [renderer] 新会话首页移除“查看全部模板”入口，保持界面聚焦于动态任务建议
- [配置] 将持久偏好迁移为用户与项目 config.toml 真源，使设置页、外部编辑和自然语言配置共享同一配置。
- [renderer] 为 GitHub 资料、在线技能、模型目录、社区宠物和用量计费统一首屏 shimmer 骨架及远程图片占位
- [renderer] 按 Codex 个人资料页结构重排 GitHub 资料、统计与活动展示，并改善暗色主题和加载状态
- [agent] Windows SRT 改为最多 8 个独立 worker 并发执行，每条命令使用独立策略与临时目录，移除主进程全局初始化队列
- [security] GitHub 登录升级为 PKCE、回环回调与 Cloudflare 令牌 Broker，并在退出时撤销远端令牌
- [auth-broker] Staging Broker 与桌面默认登录地址统一切换为 `auth-staging.codepilotx.top`
- [agent] 明确一等工具的垂直切片、运行时边界和 MCP → Web → LSP 能力建设顺序，避免继续扩大集中式工具文件
- [desktop] 沙盒运行环境改为启动后台扫描并缓存状态，配置页仅在手动刷新时重新执行完整探测
- [desktop] 工作空间依赖项改为启动后台扫描并缓存状态，进入设置页不再重复探测本机工具
- [observability] 统一 Agent 与桌面结构化日志目录，增加安全的开发终端执行流并过滤健康检查、静态资源和用户内容
- [renderer] 将独立 MCP 设置入口并入插件管理页，同时保留插件与 skills.sh 商店作为发现和安装入口
- [renderer] MCP 管理页改用真实 Agent 配置与连接状态，提供结构化编辑、高级 JSON、覆盖关系、能力计数和重载摘要
- [agent] MCP 配置变更采用 generation lease，从下一轮主任务或子任务生效，当前运行中的 turn 保持一致快照
- [agent] MCP 测试 fixture 与开发调试服务器共享同一套工具、状态和传输实现，避免测试行为与实际调试入口分叉
- [renderer] MCP Dialog 改为 Codex 风格结构化分组与折叠高级配置，增加 OAuth 登录/退出和 Composer `/mcp` 直达入口；必需 Server 从下一 turn 起阻断不可用连接
- [renderer] 重置并收敛侧边栏状态模型，调整项目、固定任务和最近任务的默认展示顺序
- [release] 建立统一版本管理规则：根 `package.json` 为唯一版本来源，三个应用 manifest 同步，引入 `version:check` 和 `version:prepare` 脚本
- [release] 新增 `docs/release/versioning.md` 记录版本生命周期与发布步骤
- [release] 新增根 `CHANGELOG.md`，按 `Unreleased` + 版本归档结构维护变更记录
- [release] PR 必须为 `Unreleased` 区段至少新增一条项目符号
- [release] 统一安装包名称及运行时版本为 `0.2.0-beta.1`
- [release] 提取 `scripts/semver-utils.ts` 提供 SemVer 解析与比较函数
- [release] 新增 `scripts/version-policy.test.ts` 版本策略聚焦测试（20 项）

### Security

- [Agent] Shell 网络风险改为按真实可执行命令位置和敏感数据流识别，并在所有安全级别保留系统凭据提取、策略篡改和灾难级破坏的不可绕过拒绝
- [Agent/Desktop] Provider 仅暴露手动选择的单一活动凭据，禁用、删除或请求失败均不自动切换 Key，并隔离 Anthropic 订阅 OAuth 与推理凭据
- [projects] 多根工作区统一执行 realpath、符号链接和沙盒边界校验，附加目录仅在显式项目范围内允许受控读写
- [agent] 固化 SRT 0.0.65 安装代际与 WFP `60080–60095` 端口范围，并在 worker、协议或 ACL 清理异常时失败关闭且不自动重试命令
- [github] OAuth 登录新增只读 `read:org` 授权与校验，修复组织资料查询因权限不足而失败的问题
- [agent] 将普通 MCP 工具权限独立为 `mcpTools`，仅依赖结构化工具来源判定，并拒绝持久化静态凭据及泄露工作区路径的更新事件
- [agent] MCP 会话诊断上下文仅允许 stdio 配置显式开启，并通过脱敏、限量的请求 `_meta` 暴露当前调用所属会话摘要
- [agent] MCP OAuth 凭据使用现有主密钥加密保存，授权流程采用 PKCE、一次性 state、十分钟回调期限和 Server URL 哈希绑定，且审批预授权不能绕过线程级硬门禁

### Removed

- [Provider] 移除旧 `provider-runtime`、`provider-plugin`、AI SDK 依赖与 models.dev 快照资源，模型请求、目录和 OAuth 统一由 Pi 提供
- [desktop] 移除玻璃表面、窗口 Acrylic、半透明侧边栏设置及主题导入导出，并将外观设置升级为 V6

## 0.2.0-beta.1 — 2026-07-25

### Added

- [desktop] 初始 Windows x64 安装包构建与签名流程
- [desktop] Electron 主进程、preload、窗口、Agent sidecar 集成
- [agent] 会话管理、SQLite 存储、RPC 协议（thread-rpc-v4）
- [renderer] React + Vite 渲染器、会话视图与工作台布局
- [packages] 共享领域契约、provider 插件系统、AI 模型目录与故障转移
- [ci] PR 与 tag 触发 CI，支持静默安装验证与 smoke 测试
