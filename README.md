# CodePilotX

CodePilotX 是一个面向本地开发工作流的 AI coding agent。它提供 CLI、终端 TUI 和 Electron 桌面端，支持在项目目录中读取上下文、执行工具、管理会话、修改代码，并通过多 provider 适配层接入不同模型服务。

这个仓库的重点不是简单换壳，而是把 CodePilotX 的本地 agent 工作流扩展到更适合国内和多模型场景的模型后端，尤其针对 DeepSeek 和 MiniMax 做了工程化优化。

## 亮点

- 多模型 provider 架构：内置 Anthropic、OpenAI、OpenRouter、DeepSeek、MiniMax、Groq 和自定义 OpenAI-compatible 网关。
- 一键连接流程：通过 `/connect` 在 TUI 中选择 provider、输入 API key、拉取模型列表并保存默认模型。
- CLI + 桌面双入口：同一套本地 agent 能力可在终端和桌面端复用。
- 安全凭据存储：provider API key 支持环境变量，也支持写入本地 secure storage。
- 插件和 MCP 生态保留：继续兼容 `.claude/`、`CLAUDE.md`、插件、MCP、权限和工具调用体系。

## DeepSeek 优化

DeepSeek 使用 OpenAI-compatible API，但 CodePilotX 没有只做基础转发，而是围绕 agent 场景做了专门适配：

| 优化点 | 说明 |
| --- | --- |
| 内置模型档位 | 默认提供 `deepseek-v4-pro` 和 `deepseek-v4-flash`，桌面端展示为 `V4 Pro` / `V4 Flash`，便于区分高质量代码任务和快速经济任务。 |
| Thinking 映射 | 将本地 `thinkingConfig` 映射到 DeepSeek 的 `thinking` 与 `reasoning_effort` 参数，支持关闭、自适应和高强度推理。 |
| 缓存命中优化 | 根据 DeepSeek 缓存从 token 0 起匹配的特性，把 system prompt 拆成稳定段和动态段，尽量让跨轮请求复用稳定前缀。 |
| 固定用户隔离 | 为 DeepSeek 请求加入稳定 `user_id` 和 `X-User-Id`，让同一 CLI 进程多轮请求共享缓存空间，同时和其他实例隔离。 |
| 输出上限调优 | 针对 DeepSeek v4 设置更适合 agent 长回答、思考和工具调用的默认输出 token 上限，减少截断和整轮重试。 |
| 缓存用量解析 | 解析 `prompt_cache_hit_tokens`、`prompt_cache_miss_tokens` 和 `cached_tokens`，把缓存命中数据纳入统一 usage 结构。 |
| 余额检查 | 支持调用 `/user/balance` 获取 DeepSeek 账户余额状态，桌面端和 provider 服务可复用。 |
| 错误提示优化 | 对 DeepSeek 常见 HTTP 状态码提供明确说明，例如鉴权失败、余额不足、限流和服务繁忙。 |

相关实现主要在：

- `apps/tui/src/services/api/openaiCompatible.ts`
- `apps/tui/src/utils/model/providerConfig.ts`
- `apps/desktop/src/renderer/modelPresets.ts`

## MiniMax 优化

MiniMax 在 CodePilotX 中是独立 provider，不只是 OpenAI-compatible 的一个 URL。主聊天由内置 AI SDK 适配层处理，媒体能力建议交给 MiniMax 官方 CLI。

### 主聊天适配

- 使用 AI SDK `streamText` 和 `@ai-sdk/anthropic` 接入 MiniMax Anthropic-compatible endpoint。
- 默认使用 `https://api.minimaxi.com/anthropic/v1`，模型列表内置 `MiniMax-M2.7`、`MiniMax-M2.7-highspeed`、`MiniMax-M2.5`、`MiniMax-M2.1` 等。
- 将本地 Anthropic 风格消息转换为 AI SDK `ModelMessage`，保留 user、assistant、tool result、tool call 和 reasoning 内容。
- 将本地工具 schema 转成 AI SDK tool schema，让 MiniMax 主聊天也能参与 agent 工具调用。
- 统一映射 MiniMax 响应到本项目的 `AssistantMessage`，包括文本、thinking、tool_use、finish reason、request id 和 usage。
- 对 MiniMax 主聊天不支持的图片、文档输入给出明确错误，引导使用官方 MiniMax CLI 或提取文本后再进入主聊天。
- 对 MiniMax 常见错误码做中文化提示，包括限流、鉴权失败、余额不足、TPM/token 限制和参数错误。

### MiniMax 官方 CLI

媒体、视觉、语音、音乐、文件和额度等 MiniMax 工作流不再由 CodePilotX 内置插件维护。插件页中的 MiniMax 卡片会打开官方安装入口：

- MiniMax CLI 文档：<https://platform.minimax.io/docs/token-plan/minimax-cli>
- 官方仓库：<https://github.com/MiniMax-AI/cli>

官方推荐安装命令：

```bash
npm install -g mmx-cli
npx skills add MiniMax-AI/cli -y -g
```

相关实现主要在：

- `apps/tui/src/services/api/minimax.ts`
- `apps/tui/src/utils/model/providerConfig.ts`

## 快速开始

### 环境要求

- Bun 1.3 或更新版本
- Node.js 22 或更新版本

### 安装依赖

```sh
bun install
```

### 运行 CLI/TUI

```sh
bun run dev
```

这会先构建 `apps/tui/src/entrypoints/cli.tsx` 到 `dist/codepilotx.js`，然后启动 CLI/TUI。

只构建 CLI：

```sh
bun run build
```

构建后运行：

```sh
bun dist/codepilotx.js
```

### 连接 DeepSeek 或 MiniMax

在 TUI 中运行：

```text
/connect
```

然后选择：

- `DeepSeek`：使用 `https://api.deepseek.com`，也可通过 `DEEPSEEK_API_KEY` 提供 key。
- `MiniMax`：使用 `https://api.minimaxi.com/anthropic/v1`，也可通过 `MINIMAX_API_KEY` 提供 key。

连接完成后，所选 provider 和模型会写入本地配置，后续会话默认复用。

### 运行桌面端

```sh
bun run desktop:dev
```

这个命令会构建桌面端使用的本地 agent、Electron main/preload/renderer，并启动 Electron。

只构建桌面端：

```sh
bun run desktop:build
```

Windows 打包：

```sh
bun run desktop:dist:win
```

输出目录：

```text
release/desktop/
```

## 项目结构

```text
apps/tui/       CLI、终端 TUI、agent 主循环、provider 适配和工具系统
apps/desktop/   Electron 桌面端、设置页、provider 管理和本地 agent 启动
packages/core/  桌面端和 TUI 共享的类型、provider 抽象和运行时入口
scripts/        构建、审计和桌面开发脚本
stubs/          公开环境不可用的私有/native 包占位
```

## 常用命令

```sh
bun run deps:audit
bun run typecheck
bun run build
bun run smoke
bun run desktop:agent:build
bun run desktop:build
bun run check
```

`bun run check` 会执行 typecheck、CLI build 和 smoke。

## 配置目录

CodePilotX 默认使用：

```text
~/.codepilotx/
```

全局配置默认写入：

```text
~/.codepilotx/.config.json
```

配置目录优先级：

1. `CODEPILOTX_CONFIG_DIR`
2. `CLAUDE_CONFIG_DIR`
3. `~/.codepilotx`

首次读取全局配置时，如果新配置不存在，会尝试从旧配置迁移：

- `~/.claude.json`
- `~/.claude/.config.json`
- `CLAUDE_CONFIG_DIR` 指向目录下的旧配置

项目级 `.claude/`、`CLAUDE.md`、插件和 MCP 相关路径继续保留，方便复用既有 Claude Code 生态。

## 任务模型档位

CodePilotX 使用三档任务模型接口，不再暴露 Claude 家族名作为配置入口：

```json
{
  "CODEPILOTX_FAST_MODEL": "glm-4.5-air",
  "CODEPILOTX_DEFAULT_MODEL": "glm-5.2[1m]",
  "CODEPILOTX_DEEP_MODEL": "glm-5.2[1m]"
}
```

对应 CLI alias 为 `fast`、`default`、`deep`、`plan`。`plan` 在普通模式使用默认档位，在计划模式使用深度档位。

## 开发注意事项

- `.ts` 和 `.tsx` 文件中的 import 仍保留 `.js` 后缀风格。
- 不要手动修改 `packages/core/src/types/generated/` 下的生成文件。
- 桌面端不要直接依赖未暴露的 TUI 内部实现；需要共享能力时通过 `packages/core/` 或既有 workspace alias 暴露。
- 私有 `@ant/*` 和 native 包在公开环境不可用时由本地 stubs 表示。
- Claude 模型 ID、Anthropic SDK 包名、`claude.ai` 远端 URL 和 provider/auth 逻辑属于生态兼容层，不应作为普通产品文案重命名。

## 第三方字体

桌面端 UI 默认字体使用 MiSans（小米字体），通过本地 npm 依赖 `misans@4.1.0` 打包分发，不依赖 CDN。MiSans 由小米提供并可免费商用（Apache-2.0），来源：[dsrkafuu/misans](https://github.com/dsrkafuu/misans)。
