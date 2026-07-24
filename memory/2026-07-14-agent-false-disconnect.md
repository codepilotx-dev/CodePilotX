# Agent 假性断连与无日志排障报告

- 症状：桌面端持续显示正在连接 Agent，用户看不到错误或 Agent 日志。
- 根因：`App.tsx` 的初始化 effect 间接依赖 `providers`；初始化中的 `loadProviders()` 每次更新该状态，导致 effect 无限重跑。实测每秒产生约 300–360 次重复项目与模型 API 请求，Renderer 内存快速上涨并卡死。Agent 实际已通过 `/api/ready`、Cookie 验证并与 Electron 建立连接。
- 日志问题：开发模式下 Electron 日志位于 AppData，Agent 日志位于 `apps/agent/.codepilotx/logs`，启动页只打开前者，因此 Agent 日志不可发现。
- 修复：项目初始化显式使用同一次请求返回的 Provider 快照，切断 React 依赖反馈环；开发模式统一 `CODEPILOTX_LOG_DIR`；启动页改用合法 data URL 并记录加载/状态更新失败；Renderer 页面加载增加 20 秒超时。
- 回归测试：`apps/desktop/renderer/test/model-selector.test.tsx` 覆盖项目模型基于本次 Provider 快照的回退。
- 验证：修复后空闲 10 秒仅新增 5 次预期 `/api/ready` 探测，初始化接口不再重复；类型检查、Renderer 2 项测试、Agent 13 项测试和完整构建通过。
- 状态：DONE
