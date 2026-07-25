# AGENTS.md

## 适用范围

本文件适用于 `apps/agent/`，并补充仓库根目录规则。

## 架构边界

- `src/index.ts` 是可执行入口，`src/bootstrap.ts` 是 composition root；两者都不得承载业务逻辑。
- Agent 保持 Bun + Effect 模块化单体，不得把业务逻辑移动到 Electron 或 renderer。
- HTTP、RPC、SSE、projection 和 renderer proxy 放在 `src/transport/`。
- 会话状态与历史放在 `src/session/`，执行编排放在 `src/orchestration/`。
- SQLite 按 `storage/database/`、`storage/repositories/`、`storage/events/`、`storage/recovery/` 分层。
- 实际 SQL 必须位于领域 repository；`AgentDatabase` 只做连接、最终 schema、装配和恢复。
- 所有 repository 复用同一连接和事务状态。业务状态与 outbox event 必须在同一 transaction 中提交。

## RPC v4

- `@codepilotx/agent-protocol` 是 RPC method、event、wire error 和 capability 的唯一来源。
- `transport/rpc/RpcRouter.ts` 只负责连接状态、鉴权、capability、registry 分派和统一错误编码。
- 方法实现按领域放入 `transport/rpc/handlers/`；handler 负责解码与调用 service，禁止直接执行 SQL。
- `thread/create` 只接受 `workspace`。
- 禁止恢复 v3、legacy dispatcher、migration adapter 或兼容参数。
- 错误响应不得泄露原始异常、命令环境、凭据或敏感绝对路径。

## 存储与安全语义

- 新数据库一次性创建最终 schema；不得恢复逐版本 schema migration。
- 数据代际重置只能删除配置指向的数据库、`-wal` 和 `-shm`，不得删除父目录或创建备份。
- 保留 WAL、外键、busy timeout、transactional outbox、事件顺序、SSE replay、checkpoint 和 interrupted recovery。
- 凭据必须经过现有加密凭据仓库和 Bun secrets 流程；不得写入 SQLite、event、日志或错误。
- 新工具必须经过 `ToolRegistry` 和既有审批边界，禁止绕过权限检查。

## 工具架构与能力方向

- `src/tool/ToolRegistry.ts`、`ToolExecutor.ts` 和 `ToolExposurePlan.ts` 只维护通用的工具定义、注册、暴露、执行与权限基础设施；不得继续向这些文件堆入可独立拆分的工具业务逻辑。
- 新增一等内建工具时，以 `src/tool/<ToolName>/` 作为垂直边界，按实际需要放置 definition、schema、prompt、formatter、安全校验和辅助逻辑；不得为了目录数量制造空壳文件。
- 修改现有集中式工具时，若本次职责能够独立，应同步从聚合文件抽到对应工具目录；优先移动、复用或改造现有实现，不创建平行实现。
- 工具 UI 归 renderer 所有，不得为了仿照其他项目把 React 展示组件放入 Agent；Agent 仅输出稳定、可投影的工具结果和进度数据。
- 提问、Skills、Plan 和子 Agent 等产品生命周期工具继续由对应领域 service 持有，通过 orchestration adapter callback 暴露；不得在 `src/tool/` 中复制另一套状态机或 checkpoint 实现。
- 所有新增工具必须接入既有 `ToolRegistry -> ToolExposurePlan -> ToolExecutor -> PermissionDecisionEngine` 链路，并保持审批、沙箱、幂等、延迟暴露和中断恢复语义。
- 参考成熟工具实现时先映射 CodePilotX 现有领域边界、权限模型和桌面架构，不机械复制对方目录、命名或重复逻辑。
- 新增工具能力时默认按以下顺序推进：先补齐 MCP 工具、资源读取与认证闭环；再实现 Web Search/Web Fetch；最后建设 LSP 代码智能。更低优先级工具需有明确产品需求后再加入。

## 验证

- 类型检查：`bun run --cwd apps/agent typecheck`
- 行为变化时运行：`bun run --cwd apps/agent test`
- 入口、编译或 sidecar 产物变化时运行：`bun run build:agent`
- RPC、schema、outbox 或 recovery 变化时，必须运行相关回归测试和根目录 `bun run typecheck`。
