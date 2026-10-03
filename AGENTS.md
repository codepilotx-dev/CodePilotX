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

- 用户明确要求，或适用 Skill 明确规定时，可将边界清晰、相互独立的子问题交给子代理；否则由当前 Agent 完成。子代理不得独立决定架构、数据兼容策略、安全边界或验收标准。
- 仅在用户明确要求使用 OpenCode 等外部 Coding Agent 时，读取并遵守 [外部 Coding Agent 规则](docs/agent/external-coding-agent.md)；普通任务不得因此启动外部 Agent。

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
- 交付前必须按本次变更涉及的协议、路径和调用方搜索旧协议、旧路径和失效 import，并运行 `git diff --check`；纯文档修改检查引用，不扩展为全仓代码审计。
- 每个修改代码、配置或文档的任务，都必须在 `CHANGELOG.md` 的 `Unreleased` 区段新增至少一条项目符号，说明做了什么及影响。仅修改 `CHANGELOG.md` 自身时可以豁免。
- 修改历史区段不能代替新增说明。记录使用 `- [作用域] 中文说明` 格式，并归入 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed` 或 `Security`。
- 只有用户明确要求时才创建提交。
- 提交必须使用中文 Conventional Commit，例如 `feat(desktop)：中文说明`。类型和 scope 必须与实际改动及 workspace 对应。
