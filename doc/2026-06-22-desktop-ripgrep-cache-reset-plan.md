# 桌面端 ripgrep 缓存修复计划

## 背景
- 最新日志仍显示 `Glob` 使用 `dist/desktop/main/vendor/ripgrep/x64-win32/rg.exe` 并报 `ENOENT`。
- 进程已经是最新启动，说明不是旧进程问题。
- `ripgrep` 配置由 `memoize` 缓存；桌面运行时设置 `USE_BUILTIN_RIPGREP=0` 前，配置可能已经被其他初始化路径计算并缓存成 builtin vendor。

## 本轮改动
- 在 `apps/tui/src/utils/ripgrep.ts` 暴露清理 ripgrep 配置缓存的内部 helper。
- 桌面 headless runtime 设置桌面环境变量后，清理 ripgrep 配置缓存，确保 Glob/Grep 下一次解析时重新走系统 ripgrep。
- 增加单测覆盖：预先缓存 builtin 后，桌面 runtime 初始化应清掉缓存并切到系统 ripgrep。

## 验证
- 运行新增/相关 ripgrep 桌面 runtime 测试。
- 运行 `bun run test:codex-workflow`。
- 运行 `bun run desktop:typecheck`。

## 后续
- 重启 `bun run desktop:dev` 后再次测试 `Glob`，确认不再出现 vendor `rg.exe ENOENT`。
