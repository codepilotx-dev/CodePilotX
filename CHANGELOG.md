# Changelog

所有显著的变更均记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [SemVer](https://semver.org/lang/zh-CN/)（含预发布后缀）。

> 当前产品基线为 `0.2.0-beta.1`，此前历史不追溯。

## Unreleased

### Added

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

### Changed

- [Agent/Desktop] 打通供应商、账户连接与用量成本数据流，账户和用量页面仅展示已配置厂商，并将凭据、余额套餐与历史分析职责分离
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

- [projects] 多根工作区统一执行 realpath、符号链接和沙盒边界校验，附加目录仅在显式项目范围内允许受控读写
- [agent] 固化 SRT 0.0.65 安装代际与 WFP `60080–60095` 端口范围，并在 worker、协议或 ACL 清理异常时失败关闭且不自动重试命令
- [github] OAuth 登录新增只读 `read:org` 授权与校验，修复组织资料查询因权限不足而失败的问题
- [agent] 将普通 MCP 工具权限独立为 `mcpTools`，仅依赖结构化工具来源判定，并拒绝持久化静态凭据及泄露工作区路径的更新事件
- [agent] MCP 会话诊断上下文仅允许 stdio 配置显式开启，并通过脱敏、限量的请求 `_meta` 暴露当前调用所属会话摘要
- [agent] MCP OAuth 凭据使用现有主密钥加密保存，授权流程采用 PKCE、一次性 state、十分钟回调期限和 Server URL 哈希绑定，且审批预授权不能绕过线程级硬门禁

### Removed

- [desktop] 移除玻璃表面、窗口 Acrylic、半透明侧边栏设置及主题导入导出，并将外观设置升级为 V6

## 0.2.0-beta.1 — 2026-07-25

### Added

- [desktop] 初始 Windows x64 安装包构建与签名流程
- [desktop] Electron 主进程、preload、窗口、Agent sidecar 集成
- [agent] 会话管理、SQLite 存储、RPC 协议（thread-rpc-v4）
- [renderer] React + Vite 渲染器、会话视图与工作台布局
- [packages] 共享领域契约、provider 插件系统、AI 模型目录与故障转移
- [ci] PR 与 tag 触发 CI，支持静默安装验证与 smoke 测试
