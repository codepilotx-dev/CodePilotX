# Codex CLI 与当前项目全面差异分析

本文比较两个本地目录：

- 当前项目：`D:\VueProject\ClaudeCode`
- Codex CLI：`D:\GitHubProject\codex-main`

分析基于源码、配置和文档的只读检查。`D:\GitHubProject\codex-main` 当前目录本身不是 Git 仓库快照（没有 `.git`），因此本文不包含提交历史级别的差异。

## 高层结论

`D:\VueProject\ClaudeCode` 不是 Codex CLI 的轻改版，而是一个以 Claude Code 工作流为基础、面向多模型和桌面端的 TypeScript/Bun 项目。它的产品定位是 CodePilotX：本地 AI coding agent，重点放在 DeepSeek、MiniMax、多 provider、`/connect` 一键连接、Electron 桌面端，以及继续兼容 `.claude/`、`CLAUDE.md`、插件和 MCP 生态。

`D:\GitHubProject\codex-main` 是 OpenAI Codex 的 Rust-first 上游 monorepo。它的核心不是 TypeScript 查询循环，而是 Rust core、app-server JSON-RPC 协议、thread/turn/item 生命周期、OpenAI/ChatGPT 认证体系、稳定客户端协议和大规模测试体系。

最关键的差异可以概括为：

1. 当前项目是 TS/Bun 一体化 agent，Codex CLI 是 Rust core + 协议化客户端体系。
2. 当前项目的模型循环在 `QueryEngine + query()` 内部直接驱动，Codex 的模型循环由 Rust `run_turn()` 驱动并通过 app-server 暴露。
3. 当前项目更重 provider 适配和桌面产品集成，Codex 更重 OpenAI/ChatGPT 账号、协议边界、持久化和跨客户端能力。
4. 当前项目保留大量 Claude Code 生态路径和文案，Codex 使用 `~/.codex/config.toml`、`CODEX_HOME` 和 OpenAI/Codex 命名体系。
5. 当前项目测试规模较小，Codex 有明显更大的 Rust 测试、snapshot 和协议验证面。

## 仓库形态差异

| 维度 | 当前项目 `D:\VueProject\ClaudeCode` | Codex CLI `D:\GitHubProject\codex-main` |
| --- | --- | --- |
| 产品名 | CodePilotX | Codex CLI |
| 顶层形态 | Bun workspace：`apps/*`、`packages/*` | OpenAI monorepo：`codex-rs`、`codex-cli`、`sdk`、`docs`、`bazel` |
| 主要目录 | `apps/tui`、`apps/desktop`、`packages/core`、`stubs` | `codex-rs/core`、`codex-rs/app-server`、`codex-rs/tui`、`sdk/typescript`、`codex-cli` |
| 主要文件数量 | `apps`/`packages` 约 2100 个文件 | `codex-rs`/`codex-cli`/`sdk` 约 4800 个文件 |
| 主要源码类型 | `.ts`、`.tsx` 占绝对多数 | `.rs` 最多，另有 `.ts`、`.snap`、`.toml`、`.bazel`、`.py` |
| Git 状态 | 当前项目是 Git 仓库 | `codex-main` 目录无 `.git` |

当前项目更像一个从 Claude Code 形态演进出来的本地产品仓库，TS/TSX 覆盖 CLI、TUI、桌面端和 provider adapter。Codex CLI 则是 OpenAI 的核心 agent 平台仓库，Rust crates 非常细分，并且围绕协议、沙箱、状态、登录、模型 provider、插件、技能、MCP 和 app-server 拆分。

## 技术栈与构建差异

当前项目使用 Bun 作为主要运行和构建入口：

- `bun run build` 将 `apps/tui/src/entrypoints/cli.tsx` 打包到 `dist/codepilotx.js`。
- `bun run dev` 先构建再运行 `bun dist/codepilotx.js`。
- `bun run desktop:build` 使用 Vite 构建 Electron main、preload、renderer。
- `bun run desktop:dist:win` 构建 Windows 桌面安装包。
- TypeScript 配置以 `tsconfig.base.json` 为中心，`strict: false`，路径别名包括 `@codepilotx/core/*`、`@codepilotx/tui/*`、`@codepilotx/desktop/*`。

Codex CLI 使用 Rust/Cargo 为核心：

- `codex-cli/bin/codex.js` 是 npm 分发层，只负责按平台找到并启动 native `codex` 二进制。
- 主要开发命令由根目录 `justfile` 代理到 `codex-rs`。
- `just codex` 实际执行 `cargo run --bin codex`。
- `just test` 使用 `cargo nextest run`。
- `bazel build //codex-rs/cli:release_binaries` 用于 release binary。
- `pnpm` 只管理 `codex-cli`、`sdk/typescript` 和少量 npm 子包，不承载核心 agent。

这意味着当前项目的开发体验更偏前端/Node/Bun 工程；Codex CLI 的核心开发体验更偏 Rust workspace、Bazel release 和协议 fixture 维护。

## 对话流与 Thread/Turn 架构差异

当前项目的核心入口在：

- `apps/tui/src/QueryEngine.ts`
- `apps/tui/src/query.ts`

`QueryEngine.submitMessage()` 负责用户输入处理、系统 prompt、memory/plugin/skill 上下文、`mutableMessages`、transcript、usage、permission denials 和 SDK/TUI 输出。真正的模型-工具循环在 `query()` async generator 里完成：构造 messages、上下文裁剪、调用模型、收集 assistant 输出、执行工具、把 `tool_result` 回灌为 user message，然后继续下一轮。

简化流程：

```text
用户输入
  -> QueryEngine.submitMessage()
  -> processUserInput / slash command / attachments
  -> mutableMessages 追加用户消息
  -> recordTranscript()
  -> query() async generator
  -> compact / context handling
  -> callModel()
  -> tool_use?
  -> runTools 或 StreamingToolExecutor
  -> tool_result 回灌
  -> 继续或结束
```

Codex CLI 的核心入口在：

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/app-server`
- `codex-rs/app-server-protocol`
- `codex-rs/protocol`

`run_turn()` 明确以 turn 为单位运行模型循环。外部客户端通常不直接调用模型循环，而是通过 app-server JSON-RPC 调用 `thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/steer`、`turn/interrupt` 等 API。运行过程中，服务器通过 `item/started`、`item/completed`、`item/agentMessage/delta`、`turn/completed` 等通知输出进度。

简化流程：

```text
客户端
  -> app-server JSON-RPC initialize
  -> thread/start 或 thread/resume
  -> turn/start
  -> core Session / run_turn()
  -> ResponseItem 输入构造
  -> 模型 sampling
  -> ToolCallRuntime 执行工具
  -> ResponseItem / TurnItem / EventMsg
  -> app-server notifications
  -> TUI / SDK / Desktop 消费事件
```

本质区别是：当前项目把主循环作为应用内函数链路处理；Codex 把主循环放在 Rust core，并将 thread/turn/item 当作产品级协议边界。

## Provider、Auth、Config 差异

当前项目的 provider 配置集中在 `apps/tui/src/utils/model/providerConfig.ts`，内置：

- Anthropic：`ANTHROPIC_API_KEY`
- OpenAI：`OPENAI_API_KEY`
- OpenRouter：`OPENROUTER_API_KEY`
- DeepSeek：`DEEPSEEK_API_KEY`
- MiniMax：`MINIMAX_API_KEY`
- Groq：`GROQ_API_KEY`
- Custom OpenAI-compatible：`CUSTOM_PROVIDER_API_KEY`

当前项目还会从 `models.dev` 拉 provider/model catalog，并使用 Vercel AI Gateway 目录补充模型图标；DeepSeek 上做余额查询、错误提示、模型 metadata 和 thinking/output token 适配。MiniMax 是独立 provider，并包含媒体工具链。

Codex CLI 的 provider 配置集中在 Rust `codex-rs/model-provider-info` 和 `codex-rs/config`。它的内置中心是 OpenAI/ChatGPT：

- ChatGPT OAuth / device code / managed auth
- API key：`OPENAI_API_KEY`
- Personal access token：`CODEX_ACCESS_TOKEN`
- 本地 auth 文件：`$CODEX_HOME/auth.json`
- 配置文件：`~/.codex/config.toml`
- 可配置 `model_providers`
- 支持 Ollama、LM Studio、Amazon Bedrock、自定义 OpenAI-compatible provider 等

当前项目的配置目录优先级：

1. `CODEPILOTX_CONFIG_DIR`
2. `CLAUDE_CONFIG_DIR`
3. `~/.codepilotx`

同时继续兼容：

- `~/.claude.json`
- `~/.claude/.config.json`
- 项目 `.claude/`
- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/agents`
- `.claude/skills`
- `.claude-plugin`

Codex CLI 的配置中心则是：

- `$CODEX_HOME`
- `~/.codex/config.toml`
- 项目 `.codex/config.toml`
- 系统/企业 managed config
- `requirements.toml`

## 桌面端、SDK、工具、权限、持久化差异

### 桌面端

当前项目有完整 Electron 桌面端：

- `apps/desktop/src/main`
- `apps/desktop/src/preload`
- `apps/desktop/src/renderer`
- 桌面设置页、provider 管理、DeepSeek 余额、模型选择、本地 agent runtime 等

桌面端通过本地 agent runtime 或子进程桥接 TS agent，并将 runtime event 映射为 UI 消息、工具日志、权限请求、diff 和 done。

Codex CLI 不把桌面 UI 放在同一个 TS/Electron app 里。它更强调 `codex app-server`，让 VS Code、桌面端或其他 rich client 通过 JSON-RPC 协议消费 thread/turn/item 事件。

### SDK

当前项目的 SDK/headless 逻辑和 `QueryEngine` 深度绑定。`QueryEngine` 自身既维护状态，也产出 SDK/TUI 可消费消息。

Codex 的 TypeScript SDK 是薄客户端，主要职责是启动或连接 Codex 运行时、解析 JSONL/协议事件、收集最终 agent message。真正的 agent loop 在 Rust core。

### 工具执行

当前项目工具执行更贴近 Claude-style 模型消息：

- assistant 产生 `tool_use`
- TS runtime 调用工具
- 工具结果变成 user-side `tool_result`
- 下一轮模型继续

相关路径包括：

- `apps/tui/src/services/tools/StreamingToolExecutor.ts`
- `apps/tui/src/services/tools/toolOrchestration.ts`
- `apps/tui/src/tools/MiniMaxTool/*`

Codex 工具执行更贴近产品事件模型：

- model tool call 转为 `ResponseItem`
- `ToolCallRuntime` 调度执行
- shell、file edit、MCP、web search、image generation 等都可以转为 item/event
- UI/SDK 观察的是稳定 `item/*` 通知，而不仅是模型消息块

### 权限

当前项目权限判断主要靠：

- `canUseTool`
- permission mode
- hook permission decision
- tool-level checks
- filesystem dangerous path checks
- permission request / denial tracking

Codex CLI 权限更系统化：

- approval policy
- sandbox policy
- permission profile
- approvals reviewer
- Guardian / review
- app-server `permissionProfile/list`
- turn/thread 级权限覆盖

当前项目权限更贴工具调用；Codex 权限更贴 thread/turn 配置和客户端协议。

### 持久化

当前项目主要使用 transcript 和 message state：

- `mutableMessages`
- `recordTranscript()`
- session storage
- 桌面 session persistence

Codex 使用 rollout/thread-store/state：

- `ResponseItem`
- `RolloutItem`
- thread-store
- SQLite/state 层
- 支持 resume、fork、rollback、archive、delete、thread list、turn list

这让 Codex 的会话恢复和分支能力比当前项目更完整，也更适合多客户端订阅。

## 测试规模与工程成熟度差异

只读统计显示：

- 当前项目 `apps`/`packages` 下约 8 个 `.test.ts`/`.test.tsx`/`.spec.ts` 文件。
- Codex CLI 在 `codex-rs`/`sdk`/`codex-cli` 中约 1334 个测试、snapshot 或测试相关文件。

Codex 的测试面明显更大，尤其是 Rust core、session、config、login、model provider、app-server protocol、snapshot 等。当前项目虽然已经有构建和 typecheck 脚本，但更像快速产品化/适配型工程，测试体系还没有达到 Codex 上游那种协议和核心行为覆盖密度。

## 对当前项目的借鉴建议

如果当前项目继续服务现有 CLI/TUI/桌面 agent，不建议直接照搬 Codex 的 Rust app-server 架构。当前项目已有大量 TS 工具、hook、compact、desktop、provider 和 Claude 兼容逻辑，直接迁移会放大风险。

更现实的演进路线是渐进吸收 Codex 的协议边界：

1. 定义稳定的 `ThreadEvent` / `TurnItem` 层，减少桌面 UI 对内部 `Message` 结构的耦合。
2. 在 `QueryEngine` 外层增加 `ThreadRuntime` facade，显式表达 start、send、interrupt、resume、rollback。
3. 工具执行同时产出 model-facing `tool_result` 和 client-facing item event。
4. 把权限配置从工具局部判断逐步提升为 session/thread setting，同时保留工具级 override。
5. 将 transcript 从 message dump 逐步演进为 item/event log，为 fork、rollback、跨客户端订阅做准备。
6. 先补关键行为测试：provider selection、DeepSeek/MiniMax adapter、tool result 回灌、permission request、desktop runtime event 映射和 session persistence。

## 总结

当前项目的优势在于 TS/Bun 开发效率、多 provider 适配、DeepSeek/MiniMax 优化、Electron 桌面端和 Claude Code 生态兼容。Codex CLI 的优势在于 Rust core、稳定 app-server 协议、thread/turn/item 产品模型、OpenAI/ChatGPT 深度集成、权限和持久化体系，以及更成熟的大规模测试。

两者最值得对齐的不是语言栈，而是边界设计。当前项目短期应保留 TS runtime，把现有行为投影成更稳定的事件和生命周期模型；长期如果要支持更多客户端、远程会话、fork/rollback 和强持久化，再逐步靠近 Codex 的 thread/turn/item 架构。
