# CodePilotX 本地开发

CodePilotX 是一个面向本地开发工作流的 AI coding agent 产品，提供命令行、终端 TUI 和桌面端体验。它可以在项目目录中读取上下文、执行工具、管理会话、协助修改代码，并支持插件、MCP、远程会话、桌面集成和多种模型/provider 配置。

本仓库是 CodePilotX 的本地开发工程，使用 Bun 作为主要运行时和构建工具。当前 rebrand 已将本地产品名、CLI 命令、workspace 包名、桌面元数据和构建产物切换为 CodePilotX，同时保留 Claude/Anthropic 相关 provider、模型 ID、`claude.ai` 远端能力以及 `.claude` / `CLAUDE.md` 生态兼容。

源码拆分为三个工作区：

- `apps/tui/`: CLI 和终端 TUI。
- `apps/desktop/`: Electron 桌面端。
- `packages/core/`: 共享类型和桌面端需要复用的核心入口。

## 环境要求

- Bun 1.3 或更新版本
- Node.js 22 或更新版本

## 安装依赖

```sh
bun install
```

## CLI/TUI

开发运行：

```sh
bun run dev
```

这个命令会先构建 `apps/tui/src/entrypoints/cli.tsx` 到 `dist/codepilotx.js`，然后启动 CLI/TUI。

只构建 CLI：

```sh
bun run build
```

构建后运行：

```sh
bun dist/codepilotx.js
```

快速验证 CLI：

```sh
bun run smoke
```

`smoke` 会执行：

```sh
bun dist/codepilotx.js --version
bun dist/codepilotx.js --help
```

## 桌面端

开发运行桌面端：

```sh
bun run desktop:dev
```

这个命令会依次执行：

1. 构建桌面端使用的本地 agent: `dist/desktop-agent/codepilotx-local.exe`
2. 构建 Electron main、preload、renderer: `dist/desktop/`
3. 启动 Electron: `electron dist/desktop/main/index.js`

只构建桌面端：

```sh
bun run desktop:build
```

只构建桌面 agent：

```sh
bun run desktop:agent:build
```

如果已经构建过，也可以手动启动：

```sh
electron dist/desktop/main/index.js
```

## Windows 打包

```sh
bun run desktop:dist:win
```

输出目录：

```text
release/desktop/
```

## 配置路径

CodePilotX 默认使用新的配置目录：

```text
~/.codepilotx/
```

全局配置默认写入：

```text
~/.codepilotx/.config.json
```

配置目录优先级：

1. `CODEPILOTX_CONFIG_DIR`
2. `CLAUDE_CONFIG_DIR`，作为旧环境变量兼容
3. `~/.codepilotx`

首次读取全局配置时，如果新配置不存在，会尝试从旧配置复制：

- `~/.claude.json`
- `~/.claude/.config.json`
- `CLAUDE_CONFIG_DIR` 指向目录下的旧配置

复制成功后读写新文件；复制失败时才回退读取旧文件。项目级 `.claude/`、`CLAUDE.md` 和 Claude/Anthropic provider 相关名称仍按生态兼容要求保留。

## 常用检查

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

完整 rebrand 验证建议：

```sh
bun run typecheck
bun run build
bun run smoke
bun run desktop:agent:build
bun run desktop:build
```

## 本地验收

当前本地开发目标：

- `bun dist/codepilotx.js --version` 可以运行。
- `bun dist/codepilotx.js --help` 可以运行，并显示 `Usage: codepilotx ...`。
- CLI 可以进入正常认证或提示词流程，不会因为缺少项目元数据崩溃。
- 桌面端可以构建到 `dist/desktop/`。
- 桌面 agent 可以构建到 `dist/desktop-agent/codepilotx-local.exe`。

完整认证请求、内部 Anthropic-only 功能、私有 MCP 集成和部分原生平台集成不属于当前本地恢复目标。

## 注意事项

- `.ts` 和 `.tsx` 文件中的 import 仍然保留 `.js` 后缀风格。
- 不要手改 `packages/core/src/types/generated/` 下的生成文件。
- 桌面端源码不要直接依赖未暴露的 TUI 内部实现；需要共享能力时通过 `packages/core/` 或既有 workspace alias 暴露。
- 私有 `@ant/*` 和 native 包在公开包不可用时由本地 stubs 表示。
- Claude 模型 ID、Anthropic SDK 包名、`claude.ai` 远端 URL 和 provider/auth 逻辑不是产品命名，除非是纯用户界面文案，否则不要改名。
