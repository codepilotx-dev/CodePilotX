# AGENTS.md

## 适用范围

本文件适用于 `apps/agent/`，并补充仓库根目录规则。本文件只能增加 Agent 实现细则，不得弱化根规则。

## 职责与依赖

- `src/index.ts` 是可执行入口，`src/bootstrap.ts` 是 composition root；两者都不得承载业务逻辑。
- Agent 保持 Bun + Effect 模块化单体，禁止把业务逻辑移动到 Electron 或 Renderer。
- HTTP、RPC、SSE、projection 和 Renderer proxy 放在 `src/transport/`。
- 会话状态与历史放在 `src/session/`，执行编排放在 `src/orchestration/`。
- Review、GitHub、orchestration 和 subagent 的新职责必须放入对应领域目录，禁止继续扩大单文件聚合服务。
- Harness 是 App Agent 内部、由 CodePilotX 自主维护的执行内核，不建立 Pi 上游同步或版本对齐流程；Provider、模型请求与 OAuth 仍统一使用 `pi-ai`。
- Agent 实现跨客户端业务能力。只有浏览器、窗口、剪贴板、系统通知等真实 OS 集成才能通过明确的 adapter/capability 区分。
- Agent 向客户端输出稳定的状态、进度、审批、问题、Review 和工具结果，禁止输出依赖 React、DOM 或 TUI 的展示结构。
- Desktop 与未来 CLI 必须复用同一权限、沙箱、工具执行、checkpoint、中断恢复、Git 和存储语义。
- 禁止为了 CLI 自动化新增平行 Provider runtime、会话存储、审批引擎或直接 SQL 路径。
- 未来 CLI 的进程部署方式留给单独架构决策；其领域能力必须复用 Agent service/runtime 和 v4 协议。

## 存储与恢复

- SQLite 按 `storage/database/`、`storage/repositories/`、`storage/events/`、`storage/recovery/` 分层。
- 实际 SQL 必须位于领域 repository。`AgentDatabase` 只负责连接、最终 schema、repository 装配和恢复入口。
- 所有 repository 必须复用同一 SQLite 连接和事务状态。业务状态与 outbox event 必须在同一 transaction 中提交。
- 新数据库一次性创建当前最终 schema。已知旧 schema 通过顺序、事务化迁移升级并保留数据。
- history schema 21 和 profile schema 3 是向前兼容基线，不是当前最终 schema 版本。
- 新功能优先新增独立表。核心表只能增加 nullable 或带兼容默认值的字段，禁止让新触发器、约束、必填列或枚举值破坏旧客户端读写。
- 同一应用的更高 schema 必须允许旧客户端使用已知能力，并保留 `user_version`、未知表、未知字段和未知记录。
- 未知或不受支持的数据文件必须原样保留并拒绝覆盖。禁止删除数据库、`-wal`、`-shm` 或父目录来恢复启动。
- 必须保留 WAL、外键、busy timeout、transactional outbox、事件顺序、SSE replay、checkpoint 和 interrupted recovery。
- 凭据必须经过现有加密凭据仓库和 Bun secrets 流程，禁止写入 SQLite、event、日志或错误。

## RPC v4

- `@codepilotx/agent-protocol` 是 RPC method、event、wire error 和 capability 的唯一来源。
- `transport/rpc/RpcRouter.ts` 只负责连接状态、鉴权、capability、registry 分派和统一错误编码。
- 方法实现按领域放入 `transport/rpc/handlers/`。handler 只负责参数解码和调用 service，禁止直接执行 SQL。
- `thread/create` 只接受 `workspace`。
- 禁止恢复 v3、legacy dispatcher、migration adapter 或兼容参数。
- 错误响应不得泄露原始异常、命令环境、凭据或敏感绝对路径。

## 工具与 Harness

- `src/tool/ToolRegistry.ts`、`ToolExecutor.ts` 和 `ToolExposurePlan.ts` 只维护通用工具定义、注册、暴露、执行与权限基础设施。禁止继续向这些文件堆入可独立拆分的工具业务逻辑。
- 新增一等内建工具时，以 `src/tool/<ToolName>/` 作为垂直边界，按实际需要放置 definition、schema、prompt、formatter、安全校验和辅助逻辑。禁止为了目录数量制造空壳文件。
- 修改现有集中式工具时，本次职责能够独立时必须同步抽到对应工具目录。优先移动、复用或改造现有实现，禁止创建平行实现。
- 工具 UI 归 Renderer 所有。Agent 只输出稳定、可投影的工具结果和进度数据，禁止放置 React 展示组件。
- 提问、Skills、Plan 和子 Agent 等产品生命周期工具继续由对应领域 service 持有，并通过 orchestration adapter callback 暴露。禁止在 `src/tool/` 中复制状态机或 checkpoint 实现。
- 新增工具必须接入 `ToolRegistry -> ToolExposurePlan -> ToolExecutor -> PermissionDecisionEngine` 链路，并保持审批、沙箱、幂等、延迟暴露和中断恢复语义。
- Harness 内置或适配的工具也必须回到产品执行链路，禁止以独立工具工厂绕过注册、权限和审批。
- 参考成熟工具实现时，必须先映射 CodePilotX 现有领域边界、权限模型和桌面架构，禁止机械复制目录、命名或重复逻辑。
- 新增工具能力时，默认先补齐 MCP 工具、资源读取与认证闭环，再实现 Web Search/Web Fetch，最后建设 LSP 代码智能。更低优先级工具必须有明确产品需求后再加入。

## 验证

- 类型检查：`bun run --cwd apps/agent typecheck`。
- 行为变化时运行：`bun run --cwd apps/agent test`。
- 入口、编译或 sidecar 产物变化时运行：`bun run build:agent`。
- RPC、schema、outbox 或 recovery 变化时，必须运行相关回归测试和根目录 `bun run typecheck`。
