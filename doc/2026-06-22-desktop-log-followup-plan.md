# 桌面端日志后续修复计划

## 背景
- 最新 `log.md` 显示桌面端已经不再白屏，agent 可以完成对话。
- 剩余关键问题是 `Glob` 工具找不到 `dist/desktop/main/vendor/ripgrep/x64-win32/rg.exe`。
- 另一个噪声是 Codex context diagnostics 探测可选文件时，缺失文件被 Electron IPC 打成错误日志。

## 本轮改动
- 让桌面开发进程优先使用系统 `rg`，避免 dev 构建去找不存在的 vendor ripgrep。
- 增加一个桌面可选文件读取 helper，缺失时返回 `null`，避免正常的可选文件探测污染错误日志。
- renderer Codex diagnostics 读取 `.codex/config.toml`、`AGENTS.override.md`、`AGENTS.md` 时改走可选读取 helper。

## 验证
- 覆盖桌面 dev 环境变量会禁用内置 ripgrep 的脚本测试或 helper 测试。
- 覆盖可选 workspace 文件缺失返回 `null`。
- 运行 `bun run test:codex-workflow`、`bun run desktop:typecheck`。

## 后续
- 重启 `bun run desktop:dev` 后，再让桌面端执行一次“查找 package.json/说明项目结构”类请求，确认 `Glob` 不再报 `rg.exe ENOENT`。
