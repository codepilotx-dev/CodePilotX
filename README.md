# ClaudeCode 本地开发

这个仓库是 Bun 优先的 ClaudeCode 本地开发工程，当前源码已经拆成应用和共享包：

- `apps/tui/`：CLI 和终端 TUI。
- `apps/desktop/`：Electron 桌面端。
- `packages/core/`：共享类型和桌面端需要的共享入口。

## 环境要求

- Bun 1.3 或更新版本
- Node.js 22 或更新版本

## 安装依赖

```sh
bun install
```

## 运行 CLI/TUI

开发运行：

```sh
bun run dev
```

这个命令会先构建 `apps/tui/src/entrypoints/cli.tsx` 到 `dist/claude.js`，然后启动 CLI/TUI。

只构建 CLI：

```sh
bun run build
```

构建后直接运行：

```sh
bun dist/claude.js
```

快速验证 CLI：

```sh
bun run smoke
```

## 运行桌面端

开发运行桌面端：

```sh
bun run desktop:dev
```

这个命令会依次执行：

1. 编译桌面端使用的本地 agent：`dist/desktop-agent/claude-local.exe`
2. 构建 Electron main、preload、renderer：`dist/desktop/`
3. 启动 Electron：`electron dist/desktop/main/index.js`

只构建桌面端：

```sh
bun run desktop:build
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

## 常用检查

```sh
bun run deps:audit
bun run typecheck
bun run build
bun run smoke
bun run check
```

`bun run check` 会执行 typecheck、CLI build 和 smoke。

## 本地验收

当前本地开发目标：

- `bun dist/claude.js --version` 可以运行。
- `bun dist/claude.js --help` 可以运行。
- CLI 可以进入正常的预认证或提示词流程，不会因为缺少项目元数据崩溃。
- 桌面端可以构建到 `dist/desktop/`，桌面 agent 可以构建到 `dist/desktop-agent/claude-local.exe`。

完整认证请求、内部 Anthropic-only 功能、私有 MCP 集成和部分原生平台集成不属于当前本地恢复目标。

## 注意事项

- `.ts` 和 `.tsx` 文件中的 import 仍然保留 `.js` 后缀风格。
- 不要手改 `packages/core/src/types/generated/` 下的生成文件。
- 桌面端源码不要直接依赖 `apps/tui/`，需要共享能力时通过 `packages/core/` 暴露。
- 私有 `@ant/*` 和 native 包在公开包不可用时由本地 stubs 表示。
