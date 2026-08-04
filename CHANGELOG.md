# Changelog

所有显著的变更均记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [SemVer](https://semver.org/lang/zh-CN/)（含预发布后缀）。

> 当前产品基线为 `0.2.0-beta.1`，此前历史不追溯。

## Unreleased

### Added

- [release] 新增 PR `release-parity` 门禁：在 GitHub-hosted runner 上执行 Renderer 最终状态 a11y、x64 Agent 构建、一次性自签证书合成签名与共享 Agent runtime verifier，并在 always 步骤按精确 thumbprint 删除证书、经 ownership marker 校验后清理临时目录；可信 Release PR 验证身份与 dry-run 回执后以同一 job 名快速成功
- [release] 新增每日 release runner canary：只读权限的 self-hosted 巡检每天构建、真实签名并运行共享 Agent runtime verifier，输出安全计时摘要，无 Prepare、Release PR、Finalize、tag、Release 或 Issue 副作用
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
- [release] 新增专用 Windows runner 驱动的两阶段 Beta 自动发布流程，在 main 静默期后自动升版、完整验证、创建 Release PR，并于远端 CI 通过后签名打标和发布 prerelease
- [release] 新增手动 Beta 发布 Skill，仅使用 dev 已提交内容创建 main PR，并在一次正式确认后复用完整验证、Release PR、签名标签及 prerelease 发布流程
- [Agent/renderer] 新增可选的明文 `auth.json` Provider 凭据仓库与本机加密仓库切换流程，迁移会先验证目标再清理源，并明确提示便携性与明文风险
- [Agent/renderer] 新增可跨重启保留的会话未读状态，后台任务完成或失败时显示前景色未读点并在打开会话后清除
- [desktop/renderer] 新增可配置的 Windows 任务系统通知，在权限、提问、完成和失败时提醒用户，并支持点击恢复应用并打开对应任务
- [governance] 采用 Apache License 2.0，并新增贡献指南、行为准则、安全披露策略、CODEOWNERS、Issue/PR 模板与 Dependabot 配置，明确公开协作和依赖维护边界
- [renderer] 新增可持久化的侧栏优先级聚焦视图，集中展示需关注任务并按最近一周自然日整理其余任务

### Changed

- [release] 更新 Beta 发布 Skill、手动运行手册与发布自动化文档：补充唯一运行上下文的创建与安全清理、`release-parity` 与可信 Release PR 快速路径、每日 canary 的只读职责、安全耗时指标的观察方式，以及本地预检失败轮不计数且不得定向重跑漂绿
- [release] 每个 self-hosted 发布 job（Prepare dry-run/live、Finalize、tag package）使用带 ownership marker 的唯一运行上下文隔离 TEMP/APPDATA/LOCALAPPDATA 与 Agent 数据目录，清理时重新校验 repository、run ID、attempt 与 UUID，Prepare 与 Finalize 共享仓库级 release-state 并发组防止并发修改发布状态
- [release] 从 Windows package verifier 抽出可复用的打包 Agent 运行时验证门面（PE x64、Authenticode、ready、/api/ready、thread-rpc-v4、Pi provider/model 目录、进程树退出与目录清理），供本地 verifier、PR 合成签名 parity、每日 canary 与最终 tag 复用
- [release] dry-run 回执新增经过范围校验的安全耗时指标（ConPTY、Agent ready、Desktop ready、签名打包、安装冒烟、总计），只记录毫秒数与计数，不参与证明信任判定，超过 12 分钟 P95 目标只警告
- [release] Beta 发布改为本地完整质量门禁与 SHA/tree 绑定的 SSH 签名证明，self-hosted 发布机只验证环境并生成可复用 dry-run 回执，最终标签产物在受保护发布机签名构建后由 GitHub-hosted job 证明来源并发布
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
- [release] 发布机 workflow 不再依赖 setup-bun 在线下载，改用发布机预装 Bun 1.3.14（PATH 提供），避免受限网络下工具链下载失败
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

- [release] 本地 Beta 预检清理临时 worktree 时在 Windows 上启用 core.longpaths，避免 bun/electron-builder 生成的超长 node_modules 路径导致 git 删除失败（Filename too long）
- [release] 本地 Beta 预检的 pwsh 调用在没有标准 PowerShell 7 安装时经 cmd.exe 按用户 PATH 解析执行（WindowsApps Store 别名无法被 Bun 直接启动），避免维护者工作站预检在安装冒烟步骤失败
- [release] agent-runtime-verifier CLI 统一支持 `--name value` 与 `--name=value` 两种参数形式，并将 Agent 路径解析为绝对路径后再启动与验证，避免 Windows 上相对路径启动拿不到子进程 pid 导致进程树清理失败
- [release] release-parity 锚点链验证改在 Windows PowerShell 5.1 完成：用 ExtraStore 与 AllowUnknownCertificateAuthority 构建链后固定链根 thumbprint 必须等于锚证书，移除对 PowerShell 7 的依赖（本地开发机 Store 版 pwsh 别名无法被 Bun 直接启动），根存储依旧不写入
- [release] release-parity 合成签名流程修复：运行上下文与证书创建拆分为独立步骤，证书受信根导入与清理改用 X509Store，避免 PowerShell 7 下 Import-PfxCertificate 挂起及用户根存储的 UI 限制
- [release/test] 修正发布契约测试与 Authenticode 拒绝路径测试的 CI 环境差异：契约断言按 LF 归一化读取 workflow，Authenticode 用例改用确定未签名的非 PE 文件验证拒绝路径，不再依赖本机/CI bun.exe 的签名状态
- [Agent] 统一 Windows 测试夹具清理到共享 helper：teardown 先关闭数据库、watcher、子进程与服务再删除路径，EBUSY/EPERM/ENOTEMPTY 按固定约 5 秒窗口重试并严格顺序清理，重试时强制 GC 释放 Bun sqlite 延迟持有的 -wal/-shm 句柄，持续句柄占用成为真实测试失败而非被静默吞掉
- [desktop/release] 将打包 ConPTY 冒烟的单阶段预算提高到 30 秒、进程总预算提高到 90 秒，避免 GitHub-hosted Windows 冷启动长尾误判安装包损坏，同时保留严格超时
- [Agent/release] 将 Windows 全仓测试数据库夹具的可恢复清理等待扩展到 5 秒，避免短暂文件占用误阻塞本地 Beta 预检，同时在持续占用时仍保留失败
- [renderer/release] 为会话处理过程的原生 disclosure 提供稳定可访问名称，避免空摘要在 Review 场景触发 WCAG `summary-name` 违规并阻塞本地 Beta 预检
- [release/test] 隔离 MCP 项目信任临时配置，将预检期望字段校验抽为纯断言，并为真实 SSH 密钥夹具保留独立时限，避免祖先配置污染与 Windows SSH 进程长尾导致全仓本地门禁不稳定
- [release] 固定 Pi Agent Core 生成声明为 LF，避免 Windows 本地预检在内容未变化时因换行符重写误判 worktree 不干净
- [release] 本地 Beta 预检复用当前 Bun 可执行文件并以目录语义移除空临时父目录，兼容仅暴露 PowerShell shim 的 Windows 工作站且不把清理异常遮蔽为质量门禁失败
- [renderer/release] 外观主题编辑器在异步 code-theme seed 完成前声明 busy，并将预览强调色调整到 WCAG AA 对比度后再运行 a11y 扫描，避免未完成样式与 `#339cff` 白底低对比度误阻塞 Beta
- [desktop/release] 打包桌面启动 Sidecar 时若 Windows 服务账户缺少 Documents 已知文件夹，则回退到其 home 下的 Documents，并将环境求值、进程创建与 stdin 关闭分阶段诊断，避免自托管发布 Runner 在创建 Agent 前反复失败
- [desktop/release] Sidecar 连接失败日志新增固定枚举的启动阶段与错误码，发布 smoke 可在不输出路径、异常正文或凭据的前提下区分托管地址、命令解析、进程创建、Agent 就绪与桌面加载故障
- [release] 临时 Release worktree 仅在 tracked/untracked 状态完全干净时无强制参数移除，失败现场存在变更时保留并拒绝自动清理
- [release] Windows 打包 smoke 不再把 `CODEPILOTX_*`、GitHub Actions、runner 或签名发布变量传入产品进程，仅注入当前测试白名单，避免 Windows 环境块膨胀导致 Sidecar 无法创建并阻止 CI 凭据进入桌面与 Agent
- [release] Windows 打包 smoke 在持久 runner 上最多等待 180 秒接收 `desktop.ready`，同时在桌面进程先退出时立即失败，避免冷启动抖动误报且不掩盖真实崩溃
- [release] Windows 打包 smoke 超时时仅输出最近的安全事件名轨迹，为持久 runner 启动卡点保留诊断证据且不暴露路径、消息或凭据
- [renderer/release] Renderer a11y 首次 Vite 页面预热使用独立 240 秒预算，正式 WCAG 场景仍保留默认短预算，避免持久 Windows runner 冷编译超过 120 秒时中止整套审计
- [desktop/release] Sidecar 为签名 Agent 冷启动保留 60 秒 ready 消息窗口，并让 packaged smoke 输出有限枚举的失败类型，避免持久 runner 反复提前终止同一合法启动
- [release] Windows 打包 smoke 显式清除 runner 注入的托管 Agent URL 并固定隔离 userData，确保验证刚打包的 owned Agent 而非外部服务
- [release] Prepare 的小时级 schedule 只排队等待，不再取消正在执行的手动 dry-run；main push 仍会取消已过期候选，避免未经重新确认继续发布
- [renderer/release] Visual 与 a11y Playwright 测试通过配置白名单启动器动态分配严格回环端口并正确传递失败状态，a11y 复用正式 `new` 场景路由在审计前以独立 120 秒预算预热首次 Vite 页面且单个 WCAG 场景仍保持默认 30 秒，同时提高 Review diff 小字号文本及增删高亮背景的 WCAG AA 对比度，避免持久 Windows runner 残留进程、冷启动误报或假绿结果阻断 Beta 发布
- [Auth Broker/test] 并发 PKCE 交换测试按响应状态识别并显式验证唯一成功与重放请求，不再假定 Promise.all 中第一个请求必定先取得 attempt，避免不同 runner 调度顺序造成误报
- [Agent/release] Local environment 生命周期在 Windows 复用 Agent 既有的 PowerShell 可执行文件解析，优先使用可用的 pwsh 并以 SystemRoot 下 Windows PowerShell 回退，避免 release runner 的服务 PATH 缺少 powershell.exe 时 setup 误报失败
- [release] Prepare 在 detached worktree 中直接创建并推送签名提交，不再于持久 Windows runner 留下本地发布分支，避免 dry-run 失败后重试及后续正式发布被同名分支阻断
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
- [release] 修复自动 Release PR 的版本一致性检查失败：升版刷新 lockfile 改用非冻结的 `bun install`，并按其既有格式同步三个 workspace 条目的版本号（bun 不会把 workspace 版本变更写回 bun.lock）
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
- [release] Windows 打包校验会重试清理被短暂占用的临时目录，发布流程改用 Release ID 校验、上传和发布草稿，避免文件锁与草稿标签查询语义导致可信 beta 发布误失败
- [agent] 数据迁移临时库使用 DELETE journal 并延长文件锁重试窗口，避免 Bun 在 Windows 上残留 WAL 句柄导致原子发布误失败。
- [agent] 数据迁移失败后的临时库清理不再覆盖原始校验错误，残留临时文件会在下次启动前继续清理，避免 Windows 文件锁改变故障语义。
- [agent] 数据迁移与校验连接改用一次性查询助手并严格关闭，迁移期间不再缓存 Statement，彻底释放 Windows 上 SQLite 文件句柄，避免合并迁移偶发 EBUSY。
- [renderer] 修复任务侧栏长标题硬截断和动作区固定占位问题，溢出标题改为渐隐并在悬停时滚动展示完整内容
- [renderer] 修复 Composer 执行计划弹层被按胶囊内容收缩的定位包含块挤压到约 220px 的问题，改为相对完整摘要区域内容自适应居中（最小约 480px、最大 760px，不足时继续缩小）且不产生横向溢出，并保持胶囊尺寸与悬停/焦点关闭等现有行为不变
- [Agent/renderer] 修复动态权限请求未进入桌面审批投影、无法授权及响应后卡片无法及时关闭的问题，并支持主与子 Agent 选择更小的授权范围

### Removed

- [renderer/test] 移除不应入库的 Workbench 视觉截图基线并忽略后续本地产物，避免二进制快照污染仓库历史
- [renderer] 移除不可达的旧会话渲染、workflow 事件调试入口及桌面调试模式，统一使用 canonical 会话与标准弹层行为

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
- [release] Beta 与稳定版安装包不再要求 Authenticode 代码签名，改由隔离的构建/发布权限、SHA-256 校验和、SPDX JSON SBOM、GitHub 构建来源与 SBOM attestation 提供来源和完整性证明；稳定版还需经过受保护环境批准
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
