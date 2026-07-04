# Sidecar 生命周期

## 概述

Sidecar 是 Desktop 默认的运行时模式。它在单独的进程中运行 agent runtime，通过 JSON-RPC over stdio 与 Desktop 主进程通信。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop 主进程                                              │
│                                                             │
│  createDesktopAgentRuntime()                                │
│    → preference === 'auto' / 'sidecar'                      │
│      → SidecarDesktopAgentRuntime                           │
│        → SidecarManager                                     │
│          → spawn entrypoints/appServer.ts (子进程)           │
│          → JSON-RPC over stdio                              │
│                                                             │
│    → preference === 'embedded-headless' (显式)               │
│      → InProcessDesktopAgentRuntime (回退路径)               │
│                                                             │
│    → preference === 'subprocess' (显式)                      │
│      → CliDesktopAgentRuntime (旧 CLI 子进程路径)            │
└─────────────────────────────────────────────────────────────┘
```

## 生命周期

```
┌──────────┐
│  Created  │  SidecarManager 构造（尚未启动）
└────┬─────┘
     │ start()
     ▼
┌──────────┐   spawn → JSON-RPC 连接 → initialize
│ Starting  │   超时 15s
└────┬─────┘
     │ initialize 成功
     ▼
┌──────────┐  可以处理请求
│ Running   │
└────┬─────┘
     │ stop() / 进程退出 / 异常
     ▼
┌──────────┐  清理子进程 → 释放连接
│ Stopped   │
└──────────┘
```

## SidecarManager API

定义在 `apps/desktop/src/main/sidecarManager.ts`

| 方法 | 说明 |
|---|---|
| `start()` | 启动子进程，建立 JSON-RPC 连接，发送 initialize 握手 |
| `stop()` | 关闭连接，kill 子进程，清理资源 |
| `startThread(params)` | 发送 thread/start 请求 |
| `startTurn(params)` | 发送 turn/start 请求（同步等待完成） |
| `interruptTurn(params)` | 发送 turn/interrupt 请求 |
| `getSessionSnapshot(params)` | 发送 session/getSnapshot 请求 |
| `respondPermission(id, decision)` | 响应子进程的权限请求 |

## 事件

| 事件 | 类型 | 说明 |
|---|---|---|
| `threadEvent` | `ThreadEvent` | 服务端推送的事件（turn.started, item.completed 等） |
| `sessionSnapshotUpdated` | `JsonRpcSessionSnapshot` | 会话快照更新 |
| `crash` | `Error` | 子进程异常退出 |
| `permissionRequest` | `SidecarPermissionContext` | 服务端请求工具权限 |

## 权限请求流程

```
Sidecar (子进程)                          Desktop (主进程)
      │                                       │
      │── pending/tool/permission (通知) ─────→│
      │                                       │── 显示权限对话框
      │                                       │── 用户决策
      │←── control/submit (请求) ─────────────│
      │── control/submit 响应 ───────────────→│
      │                                       │
```

## 故障恢复

| 场景 | 行为 |
|---|---|
| 子进程启动失败 | 抛出 `SidecarStartError`；若 preference 为 `'auto'`，回退到 `InProcessDesktopAgentRuntime` |
| 子进程运行中 crash | SidecarManager 发射 `crash` 事件，SidecarDesktopAgentRuntime 记录日志 |
| 子进程挂起 | 通过 AbortSignal 中断 turn，超时保护（60s 权限超时、15s 启动超时） |
| 显式使用 sidecar 但失败 | `preference === 'sidecar'` → 抛出 `SidecarStartError`，不静默回退 |

## Env 开关

| 环境变量 | 值 | 说明 |
|---|---|---|
| `CODEPILOTX_DESKTOP_RUNTIME` | `auto`（默认） | 自动选择：sidecar → embedded |
| `CODEPILOTX_DESKTOP_RUNTIME` | `sidecar` | 强制 sidecar 模式，失败时抛错 |
| `CODEPILOTX_DESKTOP_RUNTIME` | `embedded-headless` | 强制嵌入式模式 |
| `CODEPILOTX_DESKTOP_RUNTIME` | `subprocess` | 强制 CLI 子进程模式 |

## Sidecar 环境变量

Sidecar 进程通过 `CODEPILOTX_SIDECAR_*` 环境变量接收配置。
完整列表见 `sidecarManager.ts` 的 `buildSidecarEnv()` 函数。
