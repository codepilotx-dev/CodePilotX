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

## 验证

- 类型检查：`bun run --cwd apps/agent typecheck`
- 行为变化时运行：`bun run --cwd apps/agent test`
- 入口、编译或 sidecar 产物变化时运行：`bun run build:agent`
- RPC、schema、outbox 或 recovery 变化时，必须运行相关回归测试和根目录 `bun run typecheck`。
