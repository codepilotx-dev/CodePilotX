# AGENTS.md

## 适用范围与规则层级

- 本文件适用于整个 CodePilotX 仓库。
- 下级 `AGENTS.md` 可以补充本目录的实现与验证要求。只有明确声明替代关系时，下级规则才能覆盖根文件中的局部目录约定。
- 下级规则不得弱化本文件的工作区保护、凭据安全、数据兼容、协议唯一性和提交授权规则。

## 工作方式与工作区保护

- 所有文本文件必须按 UTF-8 读取和写入。
- 修改前必须检查当前实现、相关测试和 dirty worktree。现有修改及未跟踪文件默认属于用户，禁止回退、覆盖或顺手整理。
- 需求、边界或高影响取舍不明确时，必须先询问用户。明确且低风险的仓库内实现步骤可以直接执行。
- 优先移动、复用或改造现有实现。能安全复制已有逻辑时，不创建平行实现。
- 只编写能保护本次行为的必要测试，禁止添加无关测试或大面积快照。

## 子代理与外部 Coding Agent

“子代理”指由当前 Agent 编排、在同一任务内承担独立子问题的内部协作者。“外部 Coding Agent”指通过 OpenCode 等工具启动的外部执行 session。内部子代理仍受当前任务权限和工作区规则约束；外部 Coding Agent 额外受本节的模型、allowlist、session 和独立验收规则约束。

### 子代理分工

- 大型或可并行任务使用子代理；小型、强耦合任务由当前 Agent 直接完成。
- 子代理只能处理边界明确的子任务，不得独立决定架构、数据兼容策略、安全边界或验收标准。

### 模型资格

- MiniMax 全系列模型，包括 `minimax-cn-coding-plan/*`、`opencode/minimax-*` 和 `opencode-go/minimax-*`，只能用于只读文档查阅、代码库探索、检索、解释和方案调研。
- MiniMax 禁止修改代码、测试、配置、文档、锁文件或其他工作区内容，也禁止执行会生成或改写仓库文件的安装、格式化、代码生成和修复命令。
- 即使用户指定 MiniMax 编码，主 Agent 也不得向其授予写权限或派发实现工作。主 Agent 必须亲自实现，或在用户接受后改用允许编码的模型。
- MiniMax 的分析结论只能作为线索，不能代替主 Agent 的代码审查或验收证据。
- 用户未指定外部模型时，范围明确、行为冻结、涉及 1～3 个文件的外部实现或测试任务默认只考虑 `deepseek/deepseek-v4-flash`。
- 使用 DeepSeek 前必须运行 `opencode models`，确认候选模型仍可调用。候选不可用时，只能选择同一 provider 下当前可用的同系列 DeepSeek 模型并记录实际模型 ID，或由主 Agent 亲自实现。禁止静默改用 MiniMax 或其他未知模型。
- 需要较长上下文或多文件改造时，由主 Agent 亲自完成，不得改派 MiniMax 编码。

### 任务冻结

- 每个外部实现阶段默认只处理一个明确行为、1～3 个生产文件和 1～2 个必要测试，并以约 30～60 分钟内可独立闭环为宜。
- Harness、存储、恢复、协议和生产接入等多层改造必须拆成可构建、可验收的严格串行阶段。
- 每个阶段开始前必须记录 HEAD、dirty worktree、暂存区和受保护文件 hash。
- 外部 Coding Agent 只能修改冻结 allowlist。发现真实依赖要求扩大范围时，必须停止并报告，不得擅自继续或留下不可构建的中间状态。
- 行为测试和验收语义一经冻结，禁止为了变绿而删除、跳过、弱化或改写测试，也禁止通过拆分 Turn 等方式改变被验证对象。实现无法满足时，必须保留失败证据并停止。

### 执行与停止

- 每个阶段固定一个模型和独立 session。已确认缺陷必须继续回传同一 session。
- 同一问题连续三轮未修复、模型持续越界或测试不诚实时，必须停止该 session。主 Agent 复核工作区后，决定亲自实现或重新冻结任务并更换允许编码的候选模型。
- 禁止两个模型同时修改共享 worktree，也禁止对大型核心重构使用长时间无人监管的 `--auto` 运行。
- 外部 Coding Agent 不得执行任务未明确授权的 `git stash`、`git reset`、`git checkout`、`git restore`、`git clean`、commit、push、fetch、全仓格式化或依赖更新。检查基线时只能使用只读 Git 命令。
- 禁止通过无边界 `any`、`as any`、`@ts-ignore`、关闭检查或吞掉错误绕过类型与安全契约。确有既存动态边界时，范围必须最小、原因必须明确，并由主 Agent 复核。
- 禁止静默忽略不支持的 Hook、配置或状态变化来伪装 fail-closed。安全拒绝必须具有明确、可测试且不泄露敏感信息的错误语义。

### 独立验收

- 外部 Coding Agent 的完成声明、测试摘要和绿色构建不作为最终依据。
- 主 Agent 必须独立检查实际 diff、allowlist、测试是否被改弱、所有生产调用方、聚焦行为测试、相关 typecheck/build 和 `git diff --check`。
- 新模型或新版本在接触 Harness、恢复、权限、协议和持久化核心前，必须先通过只新增冻结行为测试的微任务，验证范围服从、测试诚实性和类型质量。未通过微任务时，不得承接完整核心改造。

## 仓库与多客户端边界

- CodePilotX 是 Windows-first TypeScript monorepo，统一使用 Bun 1.3.14。
- 未经明确架构决策，禁止新增、合并、删除或重新划分 workspace。
- `apps/agent/` 负责客户端共享的会话、存储、Provider、模型、工具、权限、审批、编排、Git、Review、Skills、Plugins、MCP、配置、事件、RPC 和 projection 核心能力。
- `apps/desktop/electron/` 负责 Electron 主进程、preload、窗口、Agent sidecar、Windows 打包和真实 OS 集成。
- `apps/desktop/renderer/` 负责 React + Vite 桌面交互层。
- `packages/` 负责共享领域契约、RPC 协议、view projection、模型 schema、Provider 适配与 runtime 基础能力。
- Agent 业务模块不得依赖 Renderer 或 Electron。共享包不得依赖 Electron、DOM、React、终端渲染库或具体 CLI 参数解析器。
- 系统能力必须沿 `renderer -> typed bridge/Agent client -> Electron/Agent service -> repository` 流动。

### Desktop 与未来 CLI

- Desktop 和未来 CLI/TUI 必须通过 `@codepilotx/agent-protocol`、`@codepilotx/shared` 和 `@codepilotx/session-view` 使用共享能力。
- 禁止客户端直接读取 SQLite、解析原始 transport event，或复制 Provider、会话、权限、工具、Git、存储和领域状态机。
- Desktop 与未来 CLI 默认共享本地项目操作、聊天、模型与推理设置、权限与沙箱、`AGENTS.md`/config、Skills、Plugins、MCP、Web Search、图片、Review、Goal、Subagent 和云端协作能力。
- Desktop 默认定位为 GUI 工作台，优先承载 Projects、多文件夹、多聊天、活动管理、Scheduled tasks、Browser、Computer Use、Voice、Appshots、文件与 Visualization/Artifact 预览批注、Review pane、行级评论、Git 操作、托管 worktree、Handoff、通知、Pets 和集成终端。
- 未来 CLI 默认定位为终端与自动化入口，优先承载交互式 TUI、启动参数与子命令、单次权限控制、非交互执行、stdin/stdout/stderr、JSONL、结构化输出、Shell 管道、脚本、CI、completion、keymap、主题、状态栏、终端会话、后台命令和诊断控制。
- 上述定位不是永久的跨端禁令。跨端能力必须先在共享层补齐 service/contract，再为各客户端实现符合其交互习惯的 adapter。
- 当前仓库没有独立 CLI workspace。本节不构成创建、删除或重新划分 CLI workspace 的授权。
- 各客户端不要求版本和功能严格同步。能力差异必须通过 capability negotiation、可选能力和向前兼容协议表达，禁止根据版本字符串或失败结果猜测能力。

## 全局协议、数据与安全契约

- `@codepilotx/agent-protocol` 是 RPC method、event、wire error 和 capability schema 的唯一来源。
- 当前唯一桌面通信协议是 `thread-rpc-v4`。禁止重新加入 v3 dispatcher、adapter、migration、legacy export 或双协议分支。
- `thread/create` 只接受 `workspace`，不得恢复 `projectId` 或 `projectID` 兼容参数。
- v4 错误必须使用统一、安全的 envelope。禁止返回原始异常、凭据、命令环境或敏感绝对路径。
- history schema 21 和 profile schema 3 是共享全局数据的向前兼容基线，不代表当前最终 schema 版本。
- application ID 只表示 CodePilotX 数据所有权，禁止将其作为功能版本或清库开关，也禁止因功能或 schema 更新而递增。
- 新功能优先新增旧客户端可忽略的独立表。核心表新增字段只能 nullable 或提供兼容默认值。
- 禁止新增要求旧写入方提供新字段的触发器、约束或必填列，也禁止改变旧代码会读取的枚举值语义。
- 禁止删除或重命名兼容基线字段。确需不兼容的数据模型时，必须使用独立存储并取得明确架构决策。
- 旧版本打开同一应用的更高 schema 时，必须保留其 `user_version`、未知表、未知字段和未知记录。禁止降级、清库或重写不认识的数据。
- schema、设置代际和默认数据变更必须提供前向迁移并保留用户数据。禁止通过更换数据库、setting key、application ID 或版本号直接丢弃已有数据。
- `config.toml` 必须使用 key-path 局部编辑，并保留旧版本不认识的配置键和值。
- 不受支持或不属于 CodePilotX 的数据文件必须原样保留并拒绝覆盖。禁止通过删除文件尝试恢复启动。
- 修复、迁移或重置流程不得擅自创建整套旧数据副本。用户明确要求的导出或备份不在此限，但不得覆盖、删除或改写源数据，也必须继续遵守凭据保护要求。
- 无论开发或稳定阶段，都不得删除整个 `userData`、数据目录、浏览器存储或非目标业务数据。禁止调用 `localStorage.clear()`。
- 重置日志只能记录无敏感信息的事件和原因，禁止记录路径、凭据、设置内容或会话内容。
- 仅允许维护从已知 CodePilotX 数据代际到兼容基线的局部迁移。禁止恢复旧协议、旧客户端 adapter 或平行存储实现。
- 必须保留 WAL、外键、同源开发代理、事务 outbox、事件顺序、SSE cursor replay、审批/提问 checkpoint 和中断恢复语义。
- API key 不得写入 SQLite，也不得出现在日志、事件、错误信息或测试快照中。

## 跨层桌面契约

### Windows 标题栏

- Windows 主窗口继续使用 hidden title bar 与 Electron Window Controls Overlay。Renderer 绘制标题栏，Windows/Electron 只绘制原生最小化、最大化和关闭按钮。
- Renderer 菜单栏与 Windows 原生窗口控制区统一为 `36px`。
- Window Controls Overlay 的背景必须保持完全透明并透出 Renderer 菜单栏；Electron 只根据主题同步原生窗口按钮图标色。
- 修改标题栏高度、主题或 Window Controls Overlay 时，必须同时验证 Electron 与 Renderer，并完整重启桌面进程。

## 验证、变更记录与提交

- 开发栈：`bun run dev`。
- 全仓类型检查：`bun run typecheck`。
- 分层构建：`bun run build:agent`、`bun run build:renderer`、`bun run build:desktop`。
- Renderer 样式检查：`bun run --cwd apps/desktop/renderer css:check`。
- 默认先运行受影响 workspace 的 typecheck 和相关测试。跨 workspace 契约变化必须验证所有消费者。
- RPC、共享契约、数据 schema 或 preload 接口变化后，必须运行对应应用测试和根目录 typecheck。
- Renderer 目录或 lazy import 变化后，必须运行 renderer build 并确认 chunk 可解析。
- 只有修改打包或发布行为，或用户明确要求时，才运行 `bun run package:win`。
- 禁止为了让检查通过而盲目更新 CSS、style 或 test 基线。
- 交付前必须搜索旧协议、旧路径和失效 import，并运行 `git diff --check`。
- 每个修改代码、配置或文档的任务，都必须在 `CHANGELOG.md` 的 `Unreleased` 区段新增至少一条项目符号，说明做了什么及影响。仅修改 `CHANGELOG.md` 自身时可以豁免。
- 修改历史区段不能代替新增说明。记录使用 `- [作用域] 中文说明` 格式，并归入 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed` 或 `Security`。
- 只有用户明确要求时才创建提交。
- 提交必须使用中文 Conventional Commit，例如 `feat(desktop)：中文说明`。类型和 scope 必须与实际改动及 workspace 对应。
