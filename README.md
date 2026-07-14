# CodePilotX

CodePilotX 是一个面向 Windows 的 Electron AI 编程助手。桌面壳只负责窗口与 Bun sidecar 生命周期；会话、模型、工具、权限、SQLite 和 SSE 全部集中在一个 Bun + Effect 模块化单体中。

## 目录

```text
apps/
├─ agent/                 Bun + Effect Agent 单体、HTTP/SSE、SQLite 与工具
└─ desktop/
   ├─ electron/           Electron main / preload / Windows 打包
   └─ renderer/           React 对话流与设置页
packages/shared/          Effect Schema、API、事件与会话 Part
resources/                内置 models.dev 精简快照
scripts/                  开发与构建编排
```

## 开发

环境要求：Windows、Bun 1.3.14。

```powershell
bun install
bun run dev
```

开发编排器会启动 Vite、随机端口的 Agent 以及 Electron。Electron 只加载 Agent origin；Agent 在开发环境反向代理 Vite，因此页面、Cookie、API 与 SSE 保持同源。

## 验证与构建

```powershell
bun run typecheck
bun run build:renderer
bun run build:agent
bun run build:desktop
bun run package:win
```

`package:win` 生成 Windows x64 NSIS 安装包。生产环境的 Agent 通过 `bun build --compile` 生成 sidecar exe，并由 electron-builder 放入 `extraResources`。

## 安全边界

- API Key 通过 `Bun.secrets` 写入 Windows Credential Manager，不写 SQLite。
- Electron 使用 HttpOnly、SameSite=Strict Cookie 与随机本地认证令牌。
- Renderer 不启用 Node.js；preload 只暴露最小窗口控制 API。
- 首版只注册项目根目录内的 UTF-8 读取与搜索工具；不会写文件、不会启动 PowerShell 或其他命令。
- `chat` 固定运行规划、拟议修改、审查三个 Agent 阶段；`plan` 只运行规划阶段。补丁和命令仅保存为待审阅提议。
- 项目路径在 SQLite 中保存，Provider 密钥仍由 Windows Credential Manager 保管；Agents SDK 远程 tracing 默认关闭。

## 数据与恢复

Agent 使用 `bun:sqlite`，启用 WAL、foreign keys 和 busy timeout。业务变更和事件 outbox 在同一事务提交；SSE 支持事件游标补发与 heartbeat。异常退出时运行中任务会固化为 interrupted，队列保留但不会自动重放有副作用的工具。
