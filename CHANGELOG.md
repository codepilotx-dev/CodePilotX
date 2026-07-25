# Changelog

所有显著的变更均记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [SemVer](https://semver.org/lang/zh-CN/)（含预发布后缀）。

> 当前产品基线为 `0.2.0-beta.1`，此前历史不追溯。

## Unreleased

### Added

- [renderer] 新增 Coding/Working 工作模式入口和拉取请求占位页，完善桌面侧边栏的产品导航
- [renderer] 新增统一的“设置 → 插件”管理页，在同一入口管理内置插件、MCP 服务器和当前工作区技能
- [agent] 新增技能目录查询、受控详情读取和持久化启停能力，禁用状态从下一回合起同时作用于主任务与子任务

### Fixed

- [agent] 修复兼容技能目录间的 Junction 别名导致整个技能目录扫描失败的问题，同时继续拒绝指向配置根之外的链接
- [renderer] 修复 Radix Dropdown、Context Menu、Popover 及子菜单被旧定位样式覆盖的问题，恢复锚点定位、视口碰撞翻转和统一实色外观

### Changed

- [agent] 明确一等工具的垂直切片、运行时边界和 MCP → Web → LSP 能力建设顺序，避免继续扩大集中式工具文件
- [observability] 统一 Agent 与桌面结构化日志目录，增加安全的开发终端执行流并过滤健康检查、静态资源和用户内容
- [renderer] 将独立 MCP 设置入口并入插件管理页，同时保留插件与 skills.sh 商店作为发现和安装入口
- [renderer] 重置并收敛侧边栏状态模型，调整项目、固定任务和最近任务的默认展示顺序
- [release] 建立统一版本管理规则：根 `package.json` 为唯一版本来源，三个应用 manifest 同步，引入 `version:check` 和 `version:prepare` 脚本
- [release] 新增 `docs/release/versioning.md` 记录版本生命周期与发布步骤
- [release] 新增根 `CHANGELOG.md`，按 `Unreleased` + 版本归档结构维护变更记录
- [release] PR 必须为 `Unreleased` 区段至少新增一条项目符号
- [release] 统一安装包名称及运行时版本为 `0.2.0-beta.1`
- [release] 提取 `scripts/semver-utils.ts` 提供 SemVer 解析与比较函数
- [release] 新增 `scripts/version-policy.test.ts` 版本策略聚焦测试（20 项）

### Removed

- [desktop] 移除玻璃表面、窗口 Acrylic、半透明侧边栏设置及主题导入导出，并将外观设置升级为 V6

## 0.2.0-beta.1 — 2026-07-25

### Added

- [desktop] 初始 Windows x64 安装包构建与签名流程
- [desktop] Electron 主进程、preload、窗口、Agent sidecar 集成
- [agent] 会话管理、SQLite 存储、RPC 协议（thread-rpc-v4）
- [renderer] React + Vite 渲染器、会话视图与工作台布局
- [packages] 共享领域契约、provider 插件系统、AI 模型目录与故障转移
- [ci] PR 与 tag 触发 CI，支持静默安装验证与 smoke 测试
