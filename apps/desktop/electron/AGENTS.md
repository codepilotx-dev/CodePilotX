# AGENTS.md

## 适用范围

本文件适用于 `apps/desktop/electron/`，并补充仓库根目录规则。

## 职责与目录

- Electron 只负责窗口、preload、安全 cookie、Agent sidecar 生命周期、桌面集成和安装包。
- `src/main.ts` 只保留单实例、应用生命周期和依赖装配。
- Sidecar command、readiness 和 supervisor 放在 `src/sidecar/`。
- 窗口创建与外观控制放在 `src/windows/`。
- IPC 注册与桌面集成放在 `src/ipc/`。
- Cookie 与导航策略放在 `src/security/`。
- 设置契约与持久化放在 `src/settings/`，日志放在 `src/logging/`。
- 禁止把 provider、session、SQLite 或其他 Agent 业务状态移入 Electron。

## 桌面端定位

- Electron 只承载桌面壳与 OS 集成，包括窗口、托盘、通知、深链、剪贴板，以及 Browser、Computer Use、Voice、Appshots 等需要系统能力的 adapter。
- 桌面端业务能力继续通过 Agent sidecar 和 typed bridge 获取；不得通过启动 CLI 子进程复制 Agent 调用链。
- Desktop 专属能力可以有 Electron 实现，但其会话状态、审批、权限、工具结果和持久业务数据仍归 Agent 与共享契约所有。
- 新增系统能力时先定义集中式 IPC contract，再由 preload 暴露最小、类型化接口；renderer 不得获得任意命令、文件系统或 IPC 能力。

## 安全与 IPC

- 保持 `contextIsolation: true`、renderer 禁用 Node，并使用 sandbox。
- preload 只暴露最小、明确、类型化的方法，不得暴露任意 channel、Electron 对象、Node 模块、凭据或任意文件系统访问。
- 新 IPC 必须有集中定义的 channel、参数和返回类型，验证 renderer 输入，并同步更新 preload 与 renderer 共享契约。
- 保留 URL allowlist、导航拦截、auth cookie 验证和 API key 剪贴板 60 秒清理。
- 外观设置当前持久化版本为 4；旧版本或损坏文件必须精确删除 `appearance-settings.json` 后恢复默认。
- 设置重置日志不得包含路径、文件内容、凭据或会话内容。

## Sidecar 与打包

- 保留 watchdog、ready stdout/health probe、就绪超时、断线重连、`/api/shutdown` 和优雅退出。
- 保持开发与 packaged sidecar 路径兼容。
- 保留 Agent executable、renderer、model snapshot、third-party notices/licenses 的 `extraResources` 布局。

## 验证

- 类型检查：`bun run --cwd apps/desktop/electron typecheck`
- Electron 行为变化时运行相关 Bun 测试。
- 构建：`bun run build:desktop`
- 只有用户明确要求或安装包行为在范围内时，才运行 `bun run package:win`。
