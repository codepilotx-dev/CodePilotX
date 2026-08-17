# CodePilotX 插件平台架构

> 状态：Developer Preview 开发中（Release A：Application Plugin Platform；Release B：Replaceable System Profile）。
> 本文记录固定元内核与可替换业务服务的边界、两层插件 ABI、生命周期与信任模型。

## 1. 设计依据

- [Cordis 论文](https://github.com/cordiverse/paper/blob/main/paper.pdf)：副作用逆序回收、响应式 service dependency、fiber 生命周期、transactional reload。
- [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)：业务服务可从 Profile 配置替换。
- [DeepSeek Dynamic Host Guard](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/cordis-host-runner/src/guard.ts)：动态插件只获得受控 façade，不能取得 framework internals。
- [DeepSeek Dynamic Host Trust Stance](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/cordis-host-runner/README.md#trust-stance)：`node:vm` 不是安全边界，动态包应视同获得 bash 权限。

## 2. 固定元内核（不可替换）

以下能力不参与插件替换，任何 System Profile 都不得改变其语义：

- 插件包校验、Inventory、Profile Resolver、SDK ABI negotiation。
- `thread-rpc-v4` 方法、event、wire error 与 capability negotiation。
- canonical session projection（`session-view`）。
- Electron main、preload、IPC、导航与 URL 安全。
- CodePilotX profile/history 数据库的所有权与迁移（兼容基线不因插件平台递增）。
- System Profile boot fallback 与 last-good 指针。

## 3. 可替换业务服务

通过 `codepilotx.*@1` 系列 System Service Contract 提供替换点（落地 PR：8A–8D）：

| 契约 | 默认实现 | 可替换行为 |
|---|---|---|
| `codepilotx.model-runtime@1` | Pi catalog/runtime 包装 | 模型目录与请求 facade |
| `codepilotx.tool-runtime@1` | Tool Pipeline 包装 | 工具定义与执行 runtime |
| `codepilotx.permission-policy@1` | PermissionDecisionEngine 包装 | 审批决策策略（v4 checkpoint shape 固定） |
| `codepilotx.agent-loop@1` | Pi orchestration 包装 | Agent Loop（固定输入/输出契约） |
| `codepilotx.session-persistence@1` | SQLite event store/repositories 包装 | 追加/重放/恢复（须过 conformance suite） |

## 4. 两层插件 ABI

| 类型 | ABI | 运行位置 | 能力 | 更新方式 |
|---|---|---|---|---|
| Application declarative | Manifest + Host adapters | 不执行插件代码 | Settings、Skills、Commands、Views、MCP 声明 | generation |
| Application process | JSON-RPC `cpx-plugin-rpc@1` | 每插件独立子进程 | Tools、service、actions、KV、Host broker | generation |
| System/Profile | TypeScript/Bun System API | Agent 进程内 | 替换业务 service providers | staging 后重启 |

Application 插件之间禁止直接 import；service I/O 必须是 JSON Schema 可表达数据。
System 插件是自包含 bundle；禁止运行时补依赖与安装脚本。

## 5. Manifest v1 摘要

- `id` 必须是 publisher 命名空间（`publisher.name`）。
- `engines.pluginApi` 必须与 SDK 的 `^1` 兼容（SDK 内置 mini semver）。
- tier/runtime 组合受约束：application 不能声明 system runtime，system 不能声明 process/declarative runtime。
- 未知 required 贡献阻止激活；未知 optional 贡献忽略并产生诊断。
- 插件工具不能声明 `never-review`；process permission 只约束 Host broker，不构成 OS 沙箱。
- `files` 值必须是 sha256；安装时逐文件校验（见 Package 格式文档）。

权威 JSON Schema：`packages/plugin-sdk/schema/plugin-manifest.v1.schema.json`、
`packages/plugin-sdk/schema/application-wire.v1.schema.json`。

## 6. Application Protocol v1（`cpx-plugin-rpc@1`）

- stdio JSON-RPC，不开放监听端口；单条消息上限 1 MiB。
- 每条消息携带 protocol version、plugin id、generation、request id。
- initialize 超时 10 秒；优雅 shutdown 超时 5 秒，超时后清理完整进程树。
- Host→Plugin：`plugin/initialize`、`plugin/configChanged`、`plugin/toolExecute`、
  `plugin/commandExecute`、`plugin/viewRender`、`plugin/viewAction`、`plugin/serviceCall`、
  `plugin/quiesce`、`plugin/shutdown`。
- Plugin→Host：`host/log`、`host/serviceCall`、`host/kvGet`、`host/kvPut`、`host/kvDelete`、
  `host/viewInvalidate`、`host/progress`、`host/credentialUse`。
- 错误只返回安全 error code/message/retryable；原始 stack 只在 Developer Mode 诊断页展示。
- Runner 环境使用最小 allowlist，不注入 Agent bearer token、Provider key、SQLite path 或完整环境变量。

## 7. Service dependency

- Service key：`publisher.service-name@major`；版本范围使用 SemVer。
- required 缺失 → `waiting`（不启动 runner）；required cycle 拒绝 staging 并返回循环路径。
- singleton 多 Provider 必须显式选择；optional 缺失不阻止启动。
- Provider 消失：先阻止新 lease，再按反向拓扑停用 consumer；恢复后按正向拓扑重激活。
- Provider update 通过新 generation 发布，不修改运行中 consumer 的绑定。

## 8. 可逆生命周期与 generation

- Host 侧注册 API 由 Host 创建 disposer 并挂入 scope；插件返回 disposer 只作补充。
- Runner crash、pipe 中断或强制 disable 时，Host 仍能撤销工具定义、命令、视图、设置、
  service provider/subscription、MCP 声明、KV watch、progress 监听。
- 外部网络写入、GitHub 操作或第三方 API 调用不宣称可逆；只能 withholding 或业务补偿。
- main turn 与 subagent 同时 acquire generation lease；staging 全部健康才切 active pointer；
  retired generation 等 leases=0 后 quiesce/shutdown。
- 普通 disable 停止新 lease 并等待 drain；强制 disable 取消调用并杀进程树。
- crash loop 达到阈值自动 disable 并保留安全诊断。

## 9. System Profile 生命周期

- generation 固定 plugin id、version、digest、provider selection、config、dependency graph。
- `stage` 只校验不改变当前 runtime；`applyOnRestart` 写 pending generation。
- Agent boot 尝试 pending；全部 provider 激活成功才标记 active/last-good。
- 启动失败写安全诊断，Electron sidecar 用 last-good 重启一次，禁止无限 fallback loop。
- 默认 Profile 显式注册当前实现；System scope 生命周期为 process lifetime；
  Agent shutdown 逆序释放 providers；Profile 切换必须重启，首版不支持热切换。

## 10. 信任模型

- 插件是**完全可信本机代码**，拥有当前 Windows 用户权限；独立进程只提供故障隔离，不是安全沙箱。
- Developer Mode 默认关闭；每个新 digest 需要独立信任确认。
- 信任文案必须明确写出（H2 人工确认）：
  > 此插件是完全受信任的本机代码，可使用当前 Windows 用户权限访问文件、网络和进程。
  > 独立进程只提供故障隔离，不是安全沙箱。
- System 插件可以改变业务安全语义（如自定义 Permission Policy），但 UI 必须持续显示
  "自定义运行时 Profile" 并在应用前要求确认与重启。

## 11. 后置项（不进入首版）

- 不可信 WASM/AppContainer runtime、Marketplace/远程 Registry、Publisher PKI/TUF/透明日志、
  自动静默更新、任意 HTML/React/JS 插件 UI、插件专用 WebContents、Native DLL/Node addon、
  Application 插件直接包依赖、插件自定义共享数据库 migration、任意新增 thread-rpc-v4 方法、
  workflow/subagent profile contribution、跨平台 sandbox runner。

## 12. Package 格式（`.cpxplugin`）

`.cpxplugin` 是自包含的 ZIP 归档（仅 store/deflate，拒绝加密与 ZIP64），结构：

- 包根包含 `manifest.json`；`manifest.files` 是包内相对路径 → sha256 清单，
  必须与实际文件集合**精确一致**；`manifest.json` 自身哈希自指无法成立，
  宿主安装时跳过该条目的哈希匹配（SDK 打包工具写入格式合法的占位值）。
- 路径统一 `/` 分隔；拒绝绝对路径、`..`、ADS/盘符冒号、控制字符、
  Windows device name（CON/PRN/AUX/NUL/COM1…/LPT1…）、symlink、重复路径与
  大小写折叠冲突；拒绝 install/postinstall/prepare 等任何安装脚本。
- 上限：5000 个文件、单文件 64 MiB、解压总大小 256 MiB、归档 256 MiB。
- 包 digest = canonical sha256（`manifest` + 全部文件路径/哈希，与 key 顺序无关）；
  安装后状态只能是 `installed-disabled`，digest 变化重置 enablement。
- 卸载删除包文件，但保留 `data/<pluginId>` 数据目录、KV 与配置。

作者侧使用 SDK 打包工具自动补全哈希（见下节），不需要手算。

## 13. 开发工具与本地开发目录链接

`@codepilotx/plugin-sdk` 提供 `bun run plugin`（`scripts/plugin-cli.ts`）：

```text
bun run plugin validate <manifest.json>                    # manifest 校验（安全错误码）
bun run plugin pack <directory> [-o <out.cpxplugin>]       # 打包（自动补全 files 哈希）
bun run plugin conformance:runner <executable> [args...]   # runner wire conformance
    --plugin-id <id> --generation <g> [--token <token>] [--timeout <ms>]
bun run plugin conformance:persistence <provider.ts>       # session-persistence conformance
    [--dataRoot <dir>]
```

输出只包含安全错误码与相对路径，不打印凭据、环境变量或敏感绝对路径；
conformance 失败退出码为 1。`conformance:persistence` 仅用于插件作者对自身
provider 的本地开发验证（脚本 default export 一个 provider 对象）；
宿主运行时加载仍然只走 SystemProfileLoader。

**本地开发目录链接**（迭代开发，不重新打包）：在 Desktop 插件管理页（或
`plugin/linkDirectory` RPC）链接开发目录——宿主只记录 canonical path 与目录
digest，不复制文件；目录文件变化后 `rescan` 产生 staged digest，**不自动执行**；
重启 Agent 后按新 digest 重新做信任确认再启用。链接目录不要求哈希与
`manifest.files` 精确一致（文件正在迭代）。

## 14. Developer Mode 与凭据 broker

- Developer Mode 默认关闭；关闭时 process/System 包不能启用，UI 只显示 inventory。
- 每个新 digest 需要独立信任确认，不继承旧 digest 的信任。
- 插件 diagnostics 可以保留 plugin-local stack，但只在 Developer Mode 诊断页展示，
  不跨 v4 wire。
- 凭据经 `host/credentialUse` brokered 使用：Host 只返回引用，明文不跨 wire、
  不出现在 runner 环境变量、日志或错误中；插件数据目录按 plugin ID 隔离。

## 15. System Plugin API（可替换业务服务契约）

System 插件是自包含 bundle（禁止运行时补依赖与安装脚本），在 Agent 进程内
经 SystemProfileLoader 激活。可替换契约（`codepilotx.*@1`，SDK
`src/system/contracts.ts` 为权威定义）：

| 契约 | 输入/输出要点 |
|---|---|
| `codepilotx.model-runtime@1` | 模型目录 facade（`model/list` 加载路径） |
| `codepilotx.tool-runtime@1` | 工具目录 facade（叠加进 ToolRegistry） |
| `codepilotx.permission-policy@1` | `decide` 返回 allow/review/deny；映射回固定 approval checkpoint shape |
| `codepilotx.agent-loop@1` | `runTurn` 固定输入/输出；paused/error/interrupted 语义保持 |
| `codepilotx.session-persistence@1` | open/append/transaction/flush/replay/cursor/checkpoint/recovery/shutdown；staging 前必须过 conformance |

每个 System 插件获得 `systemDataRoot/<pluginId>/<generationId>/` 专属数据根
（注入 `SystemPluginContext.dataRoot`）；无激活 provider 时默认实现行为完全不变；
声明了但未注册的 contract fail-closed，不破坏 last-good。

## 16. 兼容矩阵与 Release 状态

- `thread-rpc-v4` 方法、event、wire error 与 capability negotiation 固定；
  canonical session projection 固定；Electron 安全外壳固定。
- profile schema 3 / history schema 21 兼容基线不因插件平台递增；
  schema 4 只新增独立插件表（旧客户端打开保持 `user_version` 与未知表）。
- 默认 Profile 引入插件平台前后产生相同的 v4 方法、事件、prompt/tool snapshot
  与 canonical projection（无激活 provider 时逐位一致）。
- Release A（Application Plugin Platform）与 Release B（Replaceable System
  Profile）当前为 Developer Preview 开发中。
- **完成状态对账（2026-08-16）**：本文档描述的 H0–H8 人工验收记录不代表
  "已实现且已自动测试"。以下条目区分"已实现并自动测试"与"已设计/部分实现"：
  - 已实现并自动测试：Runtime Scope 可逆释放（`AgentRuntimeScopeImpl`）、
    静态贡献注册（`core/skills/mcp/subagents@builtin`）、per-turn frozen
    ToolCatalog（含 contributed tool 经 `ToolExecutor` 统一管线执行与重复
    SDK name fail-closed）、统一工具五阶段管线（resolve→inspect→authorize→
    execute→finalize）、语义事件判别联合 + 单一 `PiRuntimeProjector`
    （savepoint 事务提交后发布、失败 `discardPending`）、Provider 请求快照
    （schema 32 表 + RPC + capability 门禁）、统一 Turn Inbox 原子认领 +
    持久 step 状态机（schema 33 `runtime_steps`/`runtime_context_snapshots`）、
    model-visible context invariant（发送前持久化 + digest 一致才放行）、
    启动恢复（running step 标记 interrupted、未完成 claim 释放）、
    waterfall interceptor（顺序执行、`next()` 单次、short-circuit 语义）、
    右侧"请求"Tab（三态 availability、增量 created event、gate restore）。
  - 部分实现/需继续：Application Plugin generation 与 broker 每次调用门禁、
    System Profile last-good 切换闭环、插件桌面管理 View 的 availability
    与陈旧 generation 丢弃、Runtime Composition Plan 的独立 resolver。
- 本文档的架构图与契约描述与代码事实一致的部分以自动测试为准；
  未覆盖路径仍需人工验收，不应以文档状态替代测试结果。
- 已知限制与不进入首版的能力见第 11 节后置项；插件是**完全可信本机代码**，
  独立进程只提供故障隔离，不是安全沙箱（见第 10 节信任模型）。
