# 桌面端强制系统 ripgrep 计划

## 背景
- 最新日志仍显示 `Glob` 调用 `dist/desktop/main/vendor/ripgrep/x64-win32/rg.exe` 并报 `ENOENT`。
- 已确认当前进程加载的是最新构建，系统 `rg.exe` 存在。
- 因此桌面 dev/runtime 不能继续“保留外部 USE_BUILTIN_RIPGREP 显式值”，否则外部环境或早期缓存仍会把工具链固定到缺失的 builtin vendor。

## 本轮改动
- 桌面运行时强制设置 `USE_BUILTIN_RIPGREP=0`。
- `desktop:dev` 启动 Electron 时强制传入 `USE_BUILTIN_RIPGREP=0`。
- 调整测试，覆盖桌面运行时会覆盖外部 builtin 设置。

## 验证
- 运行桌面 runtime env 测试和 ripgrep 缓存测试。
- 运行 `bun run test:codex-workflow`、`bun run desktop:typecheck`。

## 后续
- 重启 `bun run desktop:dev` 后再次测试 `Glob`，如果仍失败，再在 `ripgrepCommand()` 输出 mode/path 诊断。
