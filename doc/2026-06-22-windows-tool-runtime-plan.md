# Windows 工具运行环境修复计划

## Summary
- 实施前先把本计划保存到 `D:\VueProject\ClaudeCode\doc\2026-06-22-windows-tool-runtime-plan.md`，再进入代码修改。
- 当前桌面 agent 在 Windows 环境下报告：
  - `Glob` 依赖的 ripgrep 未安装在预期路径。
  - `Bash` 需要 POSIX shell，但当前 Windows 环境没有配置。
- 本轮目标是定位工具运行环境配置问题，优先修复 Windows 下工具可用性；如果不能安全修复，则至少让错误信息给出可执行的 fallback。

## Key Changes
- 检查 `Glob` / `Grep` / `Bash` 工具实现和桌面 agent runtime 启动环境。
- 对 `rg` 查找增加 Windows 兼容路径：
  - 优先使用项目依赖或 bundled binary。
  - 其次使用 PATH 中的 `rg.exe`。
  - 找不到时给出明确错误，避免误报成模型能力不足。
- 对 `Bash` 在 Windows 下的 shell 选择做保守处理：
  - 优先识别 Git Bash / MSYS / WSL 等可用 POSIX shell。
  - 找不到时不伪装为可运行 Bash，提示配置路径或切换 PowerShell-compatible tool。
- 第二轮修复：
  - Windows 下默认启用 `PowerShellTool`，除非用户显式通过环境变量关闭。
  - Windows 下只有检测到可用 `bash.exe` / `zsh` 时才暴露 `BashTool`；否则从模型工具池移除，避免模型继续调用必失败的 Bash。
  - 保留非 Windows 平台现有 Bash 行为。
- 补充相关纯函数或工具选择测试。

## Test Plan
- 运行相关工具/runtime 测试。
- 运行 `bun run typecheck`。
- 手动验证桌面 agent 再次执行项目总结类任务时：
  - `Glob` 不再因 rg 路径缺失直接失败，或错误信息明确说明缺失路径。
  - `Bash` 不再只报 POSIX shell 缺失而没有下一步。
  - Windows 无 Git Bash 时，模型工具池包含 `PowerShell`，不包含 `Bash`。
  - Windows 有 Git Bash 时，`Bash` 仍可用。

## Assumptions
- 不引入新的大型依赖。
- 不改模型提示词来掩盖工具失败，优先修工具运行环境。
- 如果本机确实没有 POSIX shell，本轮只做检测和清晰提示，不强行安装。
