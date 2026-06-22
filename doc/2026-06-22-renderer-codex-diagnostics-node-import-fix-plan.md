# Renderer Codex 诊断 Node 依赖修复计划

## 背景
- 桌面端白屏错误为：`node:crypto` 被 Vite externalized，renderer 访问 `createHash` 失败。
- 触发点是 renderer 的 Codex context diagnostics 直接导入了带 `node:crypto`、`node:fs/promises`、`node:path` 顶层依赖的 core 模块。

## 本轮改动
- 增加浏览器安全的 Codex context diagnostics shared 模块，不包含 Node 内置模块导入。
- renderer 改为导入 shared 模块，通过现有文件 API 读取内容。
- Node 文件系统版 core 模块继续保留 Node 读取能力。
- 新增回归测试，防止 renderer 诊断入口再次直接导入带 Node 内置模块的模块。

## 验证
- 运行 renderer Codex diagnostics 测试。
- 运行新增窗口快捷键测试。
- 运行 `bun run desktop:typecheck`。

## 后续
- F12 打开 DevTools 后，如果还有白屏，继续按 Console 首个错误定位 renderer 初始化链路。
