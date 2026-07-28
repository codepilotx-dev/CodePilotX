# Changelog

所有显著的变更均记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [SemVer](https://semver.org/lang/zh-CN/)（含预发布后缀）。

> 当前产品基线为 `0.2.0-beta.1`，此前历史不追溯。

## Unreleased

### Added

- [governance] 采用 Apache License 2.0，并新增贡献指南、行为准则、安全披露策略、CODEOWNERS、Issue/PR 模板与 Dependabot 配置，明确公开协作和依赖维护边界

### Fixed

- [agent] 延长 Windows 数据迁移遇到临时文件锁时的重试窗口，降低杀毒扫描期间误失败的概率。

### Security

- [ci] 新增覆盖版本一致性、High/Critical 依赖审计、类型检查、单元测试、Renderer CSS 规则和全仓构建的 Windows CI，并通过最小权限、不可变 Actions 提交、禁用持久凭据、超时与并发取消降低供应链风险
- [dependencies] 将 MCP SDK、Hono、Wrangler、Electron、electron-builder 与 Vite 升级到包含安全修复的版本，并为暂不可升级的 React Router 公告增加有负责人和到期日的审计豁免
- [release] Beta 与稳定版安装包不再要求 Authenticode 代码签名，改由隔离的构建/发布权限、SHA-256 校验和、SPDX JSON SBOM、GitHub 构建来源与 SBOM attestation 提供来源和完整性证明；稳定版还需经过受保护环境批准

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
