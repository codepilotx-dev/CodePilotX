# CodePilotX 云后端架构方案

## 目标

把手机 App、桌面 App、VS Code / Cursor 插件和 CLI 都收敛到统一 API。客户端只负责交互、展示和少量本地集成，真正的任务调度、Agent 生命周期、代码执行、会话状态、GitHub 集成、Sandbox、Docker/VM 和模型调用全部由 CodePilotX 后端服务负责。

```text
        手机 App
           |
        桌面 App
           |
 VS Code / Cursor 插件
           |
          CLI
           |
────────────── API ──────────────
           |
     CodePilotX 后端服务
           |
 ┌─────────┴─────────┐
 |                   |
任务调度          Agent 管理
 |                   |
代码执行          会话管理
 |                   |
Sandbox          GitHub 集成
 |                   |
Docker/VM       模型调用
```

## 分层架构

### 客户端层

客户端包括手机 App、桌面 App、VS Code / Cursor 插件和 CLI。它们共享同一套后端 API，不各自实现 Agent runtime。

客户端职责：

- 登录、组织/项目选择、会话列表、会话详情和消息输入。
- 展示流式事件，包括模型输出、工具调用、文件变更、执行日志、权限请求和任务状态。
- 发起用户操作，例如发送消息、取消任务、批准权限、创建 PR、下载产物。
- 只保留必要的本地能力，例如桌面端文件选择、插件侧编辑器上下文采集、CLI 本地登录和配置。

客户端不直接做：

- 模型调用。
- 代码执行。
- GitHub 写操作。
- 沙箱调度。
- 长期会话状态持久化。

### API 层

API 是所有客户端唯一入口，建议同时提供 HTTPS 请求和 WebSocket/SSE 事件流。

核心职责：

- 认证、组织隔离、项目隔离和权限校验。
- 客户端版本兼容和协议协商。
- 请求限流、幂等键、审计日志和基础风控。
- 将同步请求转成后台任务。
- 将后端事件流转发给客户端。

建议的外部接口：

```text
POST   /sessions
GET    /sessions
GET    /sessions/:sessionId
POST   /sessions/:sessionId/messages
GET    /sessions/:sessionId/events
POST   /sessions/:sessionId/permissions/:requestId/respond
POST   /tasks/:taskId/cancel
GET    /artifacts/:artifactId
POST   /github/installations/:installationId/repos/:repoId/connect
```

### CodePilotX 后端服务层

后端服务可以先做成模块化单体，后续按压力和团队边界拆成独立服务。第一版重点是逻辑边界清楚，而不是一开始就微服务化。

#### Task Scheduler

负责任务调度。

- 接收用户消息、GitHub webhook、定时任务和系统任务。
- 创建 `Task`，维护等待、运行、取消、失败、完成状态。
- 控制同一 session 内串行，不同 session 可并行。
- 支持优先级、超时、重试、取消、去重和并发配额。
- 把可运行任务分发给 Agent Manager。

#### Agent Manager

负责 Agent 生命周期。

- 创建、恢复、暂停、取消 Agent run。
- 组装模型上下文，包括会话历史、repo 信息、文件摘要、工具结果和系统指令。
- 管理工具调用循环：模型请求工具，Agent Manager 决定是否需要权限、是否派发执行。
- 支持子 Agent，但子 Agent 必须有独立 session/run 标识。
- 将模型输出、工具调用、工具结果和错误统一写成 session event。

#### Session Manager

负责会话状态。

- 管理 session、thread、turn、message、event、permission request。
- 提供会话恢复、事件重放、快照、fork 和归档能力。
- 保证事件递增序列，客户端断线后可从 sequence 继续订阅。
- 存储 UI 可重建的结构化事件，不要求客户端解析原始模型响应。

#### Code Execution Service

负责代码和命令执行。

- 接收 Agent Manager 下发的执行请求。
- 通过 Sandbox Manager 获取隔离环境。
- 执行 shell、读写文件、应用 patch、运行测试、收集日志。
- 把 stdout/stderr、退出码、文件变更和产物写回 Artifact Storage。
- 不直接接受客户端请求。

#### Sandbox Manager

负责执行隔离。

- 为每个 task 或 run 分配 sandbox。
- 控制文件系统、网络、进程、CPU、内存、磁盘、超时和密钥挂载。
- 第一版可以使用 Docker 容器。
- 后续扩展 VM、Firecracker 或 Kubernetes worker。
- 所有敏感凭据只通过短期挂载或临时 token 注入。

#### GitHub Integration

负责 GitHub 相关能力。

- GitHub App 安装、repo 授权和 webhook 接收。
- clone/fetch/checkout/branch/commit/push/PR。
- 读取 issue、PR、review comment、CI 状态。
- 将 GitHub webhook 转成后台任务或 session event。
- 所有 GitHub 写操作必须经过权限策略控制。

#### Model Router

负责模型调用。

- 统一接入 OpenAI、Anthropic、DeepSeek、MiniMax 和 OpenAI-compatible provider。
- 根据任务类型、用户配置、成本、上下文长度和可用性选择模型。
- 支持重试、降级、超时、流式输出、用量统计和错误归一化。
- 统一保存 request id、token usage、latency、provider error。

#### File / Artifact Storage

负责文件和产物。

- 保存工作区快照、patch、执行日志、模型 transcript、附件、测试报告和 PR diff。
- 支持按 organization/project/session/task/run 归属查询。
- 小数据可放数据库，大文件放对象存储。
- 所有 artifact 都必须有权限校验和生命周期策略。

## 核心数据模型

```text
Organization
Project
Repository
Session
SessionEvent
Task
AgentRun
ExecutionJob
Sandbox
Artifact
ModelInvocation
PermissionRequest
GitHubInstallation
```

关键关系：

- `Project` 绑定一个或多个 `Repository`。
- `Session` 属于 `Project`，可以绑定 repo、branch、workspace snapshot。
- `Task` 属于 `Session`，由用户消息、webhook 或系统动作创建。
- `AgentRun` 属于 `Task`，表示一次 Agent 执行生命周期。
- `ExecutionJob` 属于 `AgentRun`，表示一次工具或命令执行。
- `SessionEvent` 是客户端 UI 的权威事件源。
- `Artifact` 保存执行和文件产物。

## 请求主流程

1. 用户从任意客户端发送消息。
2. API 校验身份、项目权限和限流。
3. Session Manager 写入用户消息事件。
4. Task Scheduler 创建任务并入队。
5. Agent Manager 领取任务，创建 AgentRun。
6. Agent Manager 通过 Model Router 发起模型调用。
7. 模型请求工具时，Agent Manager 创建 ExecutionJob。
8. Code Execution Service 请求 Sandbox Manager 分配 Docker/VM。
9. 执行结果写入 Artifact Storage，并转成 SessionEvent。
10. Agent Manager 继续模型循环，直到完成、失败或取消。
11. 客户端通过事件流实时更新 UI。

## 事件流设计

客户端只订阅 session 事件，不直接订阅内部服务日志。

常见事件类型：

```text
session.created
message.created
task.queued
task.started
agent.started
model.started
model.delta
model.completed
tool.requested
permission.requested
permission.resolved
execution.started
execution.output
execution.completed
file.changed
github.pr.created
task.completed
task.failed
task.cancelled
```

事件要求：

- 每个 session 内 sequence 单调递增。
- 客户端可带 `lastSequence` 断点续订。
- 事件 payload 必须结构化，避免客户端解析日志文本。
- 内部错误要映射成用户可读错误和可诊断 error code。

## 第一版落地建议

第一版不要同时追求所有执行层形态，先把后端闭环跑通。

v1 建议范围：

- 统一 API。
- Session Manager。
- Task Scheduler。
- Agent Manager。
- Model Router。
- Docker-based Code Execution。
- GitHub App 基础 clone、branch、commit、PR。
- Artifact Storage。
- WebSocket 或 SSE session event。

v1 暂缓：

- Firecracker。
- Kubernetes 多集群调度。
- 多 Git provider。
- 复杂计费。
- 企业级策略引擎。
- 离线移动端能力。

## 验收标准

- 手机 App、桌面 App、插件和 CLI 可以用同一套 API 创建 session、发送消息、接收事件。
- 后端可以从用户消息创建任务，调度 Agent，调用模型，执行代码，返回结构化事件。
- 代码执行必须在 Docker sandbox 内完成，不能直接在 API 或 Agent 进程中执行。
- GitHub repo 可以被 clone，Agent 可以修改代码并创建 PR。
- 客户端断线重连后，可以从 session event 恢复 UI。
- 任务取消后，AgentRun、ExecutionJob、Sandbox 都能停止或进入明确终态。
- 模型调用、代码执行、GitHub 操作都有可审计记录。
