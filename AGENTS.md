# AGENTS.md

## 适用范围与优先级

- 本文件适用于整个 CodePilotX 仓库；更深目录中的 `AGENTS.md` 可以补充或覆盖对应目录的规则。
- 所有文本文件必须按 UTF-8 读取和写入。
- 开始修改前必须检查当前实现、相关测试和 dirty worktree。现有修改及未跟踪文件默认属于用户，禁止回退、覆盖或顺手整理。
- 需求、边界或高影响取舍不明确时先询问用户；明确且低风险的仓库内实现步骤可直接执行。
- 大型或可并行任务使用子代理；小型、强耦合任务由当前 Agent 直接完成。
- 优先移动、复用或改造现有实现；能安全复制已有逻辑时，不创建平行实现。
- 只编写能保护本次行为的必要测试，不添加无关测试或大面积快照。

## 仓库与技术栈

- CodePilotX 是 Windows-first TypeScript monorepo，统一使用 Bun 1.3.14。
- 未经明确架构决策，不得新增、合并、删除或重新划分 workspace。
- `apps/agent/` 负责会话、SQLite、provider、工具、权限、编排和 HTTP/SSE。
- `apps/desktop/electron/` 负责 Electron 主进程、preload、窗口、Agent sidecar 和 Windows 打包。
- `apps/desktop/renderer/` 负责 React + Vite renderer。
- `packages/` 负责共享领域契约、RPC 协议、view projection、模型 schema、provider 插件与 runtime。

## CLI 与桌面端产品边界

- `apps/agent/` 与 `packages/` 承载所有客户端共享的会话、存储、Provider、模型、工具、权限、审批、编排、Git、Review、Skills、Plugins、MCP、配置、事件、RPC 和 projection 核心能力。
- Desktop、未来 CLI/TUI 必须通过 `@codepilotx/agent-protocol`、`@codepilotx/shared` 和 `@codepilotx/session-view` 使用共享能力；禁止客户端直接读取 SQLite、解析原始 transport event 或复制领域状态机。
- Desktop 与未来 CLI 默认共享本地项目操作、聊天、模型与推理设置、权限与沙箱、`AGENTS.md`/config、Skills、Plugins、MCP、Web Search、图片、Review、Goal、Subagent 和云端协作能力。
- 桌面端默认定位为 GUI 工作台，优先建设 Projects、多文件夹、多聊天和活动管理、Scheduled tasks、Browser、Computer Use、Voice、Appshots、文件与 Visualization/Artifact 预览批注、Review pane、行级评论、Git 操作、托管 worktree、Handoff、通知、Pets 和集成终端。
- 未来 CLI 默认定位为终端与自动化入口，优先建设交互式 TUI、启动参数与子命令、单次运行权限控制、非交互执行、stdin/stdout/stderr、JSONL、结构化输出、Shell 管道、脚本、CI、completion、keymap、主题、状态栏、终端会话、后台命令和诊断控制。
- 上述定位是默认产品方向，不是永久禁止能力跨端；需要跨端时先在共享层补齐 service/contract，再分别实现符合各端交互习惯的 UI/TUI adapter。
- 某能力当前只存在于一端，不能成为在客户端内复制 Provider、会话、权限、工具、Git、存储、协议或事件实现的理由。
- 当前仓库没有独立 CLI workspace；创建、删除或重新划分 CLI workspace 仍需单独、明确的架构决策，本节不构成创建授权。
- 不要求桌面端与 CLI 的每个版本严格同步；版本和功能差异必须通过 capability negotiation、可选能力和向前兼容协议处理。

## 当前目录约定

### Agent

- `apps/agent/src/bootstrap.ts` 只能作为 composition root，不放业务逻辑。
- `storage/database/` 负责连接、最终 schema、数据代际和事务基础设施。
- `storage/repositories/` 按领域保存实际 SQL。
- `storage/events/` 负责 event store、outbox 和事件发布。
- `storage/recovery/` 负责中断运行恢复。
- `AgentDatabase` 只负责连接、最终 schema、repository 装配和恢复入口；禁止重新堆回领域 SQL。
- 跨 repository 原子操作必须复用同一 SQLite 连接和 transaction。
- `transport/rpc/` 使用注册式 handler registry；`RpcRouter` 只负责鉴权、初始化/capability 门禁、方法查找和统一错误编码。
- RPC handler 负责参数解码和调用 service，禁止直接写 SQL。
- Review、GitHub、orchestration、subagent 的新职责必须放入对应领域目录，禁止继续扩大单文件聚合服务。

### Electron

- `apps/desktop/electron/src/main.ts` 是唯一启动与依赖装配入口，只保留单实例、生命周期和模块装配。
- Sidecar、窗口、IPC、安全、设置和日志分别放在 `sidecar/`、`windows/`、`ipc/`、`security/`、`settings/`、`logging/`。
- 保留 sidecar watchdog、就绪超时、优雅退出、单实例、安全 URL 校验和 API key 剪贴板定时清理。
- preload 只暴露明确且类型化的方法；禁止向 renderer 暴露 Node、Electron、文件系统或任意 IPC 调用能力。
- IPC channel、参数和返回类型必须集中维护，并由 main 与 preload 共享。

### Renderer

- Renderer 禁止直接访问 Node、Electron、SQLite、凭据或文件系统；系统能力只能经过 typed preload bridge 或 Agent client。
- 所有文字动作按钮及“图标 + 文字”动作按钮必须复用 `components/ui/Button`，并使用统一高度、内边距、圆角、边框和主题自适应中性背景；禁止通过 primary/secondary 变体区分视觉层级。危险、选中、禁用、加载和焦点状态可以保留语义差异。纯图标工具按钮、导航、标签页、分段控件和开关必须使用各自组件，不得套用动作按钮容器。
- Desktop client 的稳定入口是 `services/desktop-client/index.ts`；入口只负责环境选择、组合和公开导出。
- Session 按 `conversation/`、`composer/`、`timeline/`、`approvals/`、`workflow/`、`summary/`、`subagents/`、`state/` 维护。
- Review 按 `workspace/`、`diff/`、`comments/`、`source/`、`state/` 维护；diff 解析和展示逻辑只能有一个实现来源。
- Layout 按 `shell/`、`dock/`、`tabs/`、`panels/` 维护。
- 保持 `routes.tsx` 与 workbench registry 的 lazy import 和代码分割边界。
- 新代码不得继续扩大 2000 行以上的聚合组件；修改现有超大组件时，优先抽出本次涉及的独立职责。
- 不得无意改变视觉设计、快捷键、焦点、主题、reduced-motion、popover 定位或会话恢复行为。

### Packages

- 保留现有包名和 workspace 边界。
- `@codepilotx/agent-protocol` 是 RPC method、event、wire error 和 capability schema 的唯一来源。
- `@codepilotx/shared/thread` 只保存 thread 领域模型，不得重新引入 RPC 编排类型。
- `session-view` 维护 canonical projection 和 thread projection，不新增旧 timeline 兼容层。
- `pi-ai` 是 Provider、模型目录、请求和 OAuth 的唯一底层；CodePilotX 只维护 Pi 配置门面、加密活动凭据绑定和产品编排，不得恢复平行 Provider runtime 或自动 Key failover。
- 不为生成型 `material-icon-theme` 或小型 `model-schema` 强行增加无意义目录层级。
- 只允许包级公开入口和稳定模块门面使用 `index.ts`；禁止建立全仓 barrel。

## 协议、数据代际与兼容策略

- 当前唯一桌面通信协议是 `thread-rpc-v4`。禁止重新加入 v3 dispatcher、adapter、migration、legacy export 或双协议分支。
- `thread/create` 只接受 `workspace`，不得恢复 `projectId`/`projectID` 兼容参数。
- v4 错误必须使用统一、安全的 envelope；禁止返回原始异常、凭据、命令环境或敏感绝对路径。
- history schema 21、profile schema 3 是共享全局数据的向前兼容基线；固定 application ID 只表示 CodePilotX 所有权，禁止因功能或 schema 更新而递增。
- 新功能优先新增旧客户端可忽略的独立表；核心表新增字段只能 nullable 或提供兼容默认值，禁止新增要求旧写入方提供新字段的触发器、约束或必填列。
- 禁止删除、重命名兼容基线字段，禁止改变旧代码会读取的枚举值语义；确需不兼容的数据模型时，必须使用独立存储并取得明确架构决策。
- 旧版本打开同一应用的更高 schema 时必须保留其 `user_version`、未知表、未知字段和未知记录，不得降级、清库或重写不认识的数据。
- schema、设置代际和默认数据变更必须提供前向迁移并保留用户数据；禁止通过更换数据库、setting key、application ID 或版本号直接丢弃已有数据。
- `config.toml` 必须继续使用 key-path 局部编辑，保留旧版本不认识的配置键和值。
- 不受支持或不属于 CodePilotX 的数据文件必须原样保留并拒绝覆盖；不得通过删除文件尝试恢复启动。
- 无论开发或稳定阶段，都不得删除整个 `userData`、数据目录、浏览器存储或非目标业务数据；禁止调用 `localStorage.clear()`；禁止创建旧数据备份。
- 重置日志只能记录无敏感信息的事件和原因，不记录路径、凭据、设置内容或会话内容。
- 仅允许维护从已知 CodePilotX 数据代际到兼容基线的局部迁移；禁止恢复旧协议、旧客户端 adapter 或平行存储实现。

## 必须保持的架构与安全语义

- 保留 WAL、外键、同源开发代理、事务 outbox、事件顺序、SSE cursor replay、审批/提问 checkpoint 和中断恢复语义。
- Agent 业务模块不得依赖 renderer 或 Electron。
- API key 不得写入 SQLite，也不得出现在日志、事件、错误信息或测试快照中。
- 系统能力必须沿既有方向流动：`renderer -> typed bridge/Agent client -> Electron/Agent service -> repository`。

## 验证规则

- 开发栈：`bun run dev`
- 全仓类型检查：`bun run typecheck`
- 分层构建：`bun run build:agent`、`bun run build:renderer`、`bun run build:desktop`
- Renderer 样式检查：`bun run --cwd apps/desktop/renderer css:check`
- 默认先运行受影响 workspace 的 typecheck 和相关测试；跨 workspace 契约变化必须验证所有消费者。
- RPC、共享契约、数据 schema 或 preload 接口变化后，必须运行对应应用测试以及根目录 typecheck。
- Renderer 目录或 lazy import 变化后必须运行 renderer build，确认 chunk 可解析。
- 只有修改打包或发布行为，或用户明确要求时，才运行 `bun run package:win`。
- 不得为了让检查通过而盲目更新 CSS、style 或 test 基线。
- 交付前搜索旧协议、旧路径和失效 import，并运行 `git diff --check`。

## 变更记录要求

- 每个修改代码、配置或文档的任务，都必须为 CHANGELOG.md 的 `Unreleased` 区段新增至少一条项目符号，说明"做了什么及影响"；仅修改 CHANGELOG.md 自身可以豁免。
- 从 CHANGELOG.md 历史区段修改不能代替新增说明。
- 记录应使用 `- [作用域] 中文说明` 的格式，按 `Added`、`Changed`、`Fixed`、`Deprecated`、`Removed`、`Security` 分类。

## 提交规则

- 只有用户明确要求时才创建提交。
- 使用中文 Conventional Commit，格式示例：`feat(desktop)：中文说明`。
- `feat` 与 scope 必须按实际改动类型和 workspace 调整。
