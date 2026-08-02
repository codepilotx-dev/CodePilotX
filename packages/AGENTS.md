# AGENTS.md

## 适用范围

本文件适用于 `packages/` 下所有 workspace，并补充仓库根目录规则。

## 包职责与依赖方向

- `model-schema` 定义 provider、model、integration、connection 和 credential 的基础 schema。
- `pi-agent-core` 保持上游同步，并承载 CodePilotX 的 deferred tools、动态执行、结构化结果和活动工具恢复补丁。
- Provider、模型目录、请求与 OAuth 统一由 `pi-ai` 提供；禁止恢复独立 Provider plugin/runtime 或自动 Key failover。
- `shared` 定义跨进程复用的应用领域模型；`shared/thread` 不拥有 RPC 编排类型。
- `agent-protocol` 是 v4 method、event、wire error、capability 和 runtime dispatcher 的唯一协议来源。
- `session-view` 只进行 canonical projection 和 thread projection 的纯转换。
- 依赖必须沿公开契约流动，禁止复制底层 schema 或制造循环依赖。

## 多客户端共享契约

- `agent-protocol` 是 Desktop、CLI/TUI 的唯一 RPC method、event、wire error 和 capability 来源。
- `session-view` 是所有交互客户端的唯一 canonical/thread projection；客户端只能在投影结果上附加自身的操作和展示，不得重新解释 durable snapshot 或 transport event。
- `shared`、`agent-protocol` 和 `session-view` 不得依赖 Electron、DOM、React、终端渲染库或具体 CLI 参数解析器。
- 表面差异通过 capability、可选字段和客户端 adapter 表达；禁止复制协议类型或建立 desktop/CLI 两套事件。
- 公共契约变化必须验证现有 Agent、Electron 和 renderer 消费者；未来 CLI 加入后也必须纳入同一验证范围。

## 公开接口与兼容策略

- 公共 API 通过包级 `src/index.ts` 或明确的 `package.json` export 暴露；消费者禁止 deep import 内部文件。
- 只允许包级公开入口和稳定门面使用 `index.ts`，禁止构造全仓 barrel。
- 当前协议和数据升级是破坏性开发版本升级。改变 schema、method 或 event 时，一次性迁移仓库内所有消费者。
- 除非用户明确要求，禁止添加 legacy export、migration adapter、双协议或临时兼容层。
- `thread/create` 只接受 `workspace`。

## Provider 上游代码

- 修改 `model-schema` 或 `pi-agent-core` 时遵守对应 `UPSTREAM.md`。
- 保留上游署名和许可证；优先复制或改造记录的上游实现。
- 不得恢复运行时 npm 安装、任意文件插件、不受限动态 import 或外部插件执行。
- 上游同步时更新来源、导入日期及 checksum/revision。
- 除非任务明确改变，保留 provider 注册顺序、安全过滤、静态 allowlist、failover 和错误规范化。

## 目录约定

- `shared/src/thread/` 按 permission、settings、items、queue、subagent 和 transport/domain boundary 维护。
- `agent-protocol/src/` 按 `methods/`、`wire/`、`runtime/` 维护。
- `session-view/src/` 保持 canonical 与 thread projection 分离。
- Pi Provider 配置解析、自定义 Provider factory、模型缓存与凭据适配保持为独立模块。
- 不为生成型 `material-icon-theme` 或小型 `model-schema` 强制增加无意义目录。

## 验证

- 运行受影响包的 `typecheck`。
- 只有行为变化或存在相关回归风险时运行包测试。
- 公共契约变化时，同时验证所有受影响的 Agent、Electron 和 renderer 消费者，并运行根目录 `bun run typecheck`。
- 交付前搜索 v3、legacy、migration export 和旧路径残留。
