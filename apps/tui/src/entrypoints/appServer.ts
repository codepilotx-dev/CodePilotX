/**
 * app-server sidecar 入口。
 *
 * 以子进程方式运行，通过 JSON-RPC over stdio 与 Desktop 主进程通信。
 *
 * 职责：
 *   - 创建带权限感知的 ThreadRuntime（canUseTool 通过 JSON-RPC 向 Desktop 询问）
 *   - 处理 JSON-RPC 请求（initialize、thread/start、turn/start 等）
 *   - 通过 thread/event 通知向 Desktop 推送事件
 *   - 通过 pending/tool/permission → control/submit 模式处理工具权限
 */

import { randomUUID } from 'node:crypto'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node'
import { JsonRpcAppServer } from '@codepilotx/core/appServer/server.js'
import { THREAD_EVENT_NOTIFICATION } from '../appServer/protocol.js'
import { AppServerThreadRegistry } from '../appServer/registry.js'
import type { ThreadRuntimeLike } from '../appServer/registry.js'
import { ThreadRuntime } from '../workflow/ThreadRuntime.js'
import type {
  ThreadRuntimeSettings,
  ThreadRuntimeLifecycleResult,
  ThreadRuntimeStartResult,
} from '../workflow/ThreadRuntime.js'
import type {
  ThreadEvent,
  ThreadId,
  TurnItemEvent,
} from '@codepilotx/core/agent/workflow.js'
import type {
  JsonRpcItemInjectParams,
  JsonRpcThreadForkParams,
  JsonRpcThreadResumeParams,
  JsonRpcTurnStartParams,
} from '../appServer/protocol.js'

// ── 建立 JSON-RPC 连接（双向） ──────────────────────────────────────

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
)

// ── 权限请求管理 ────────────────────────────────────────────────────

type _PermissionDecision = {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  alwaysAllow?: boolean
  message?: string
}

const pendingPermissions = new Map<
  string,
  {
    resolve: (decision: _PermissionDecision) => void
    reject: (err: Error) => void
  }
>()

// Desktop → Sidecar: 接收权限决策回复
connection.onRequest('control/submit', (params: { requestId: string; decision: _PermissionDecision }) => {
  const pending = pendingPermissions.get(params.requestId)
  if (pending) {
    sidecarLog('permission_response_received', { requestId: params.requestId })
    pending.resolve(params.decision)
    pendingPermissions.delete(params.requestId)
  } else {
    sidecarLog('permission_response_orphan', { requestId: params.requestId })
  }
})

// ── 权限感知的 ThreadRuntimeLike ────────────────────────────────────

const baseRuntime = new ThreadRuntime()

/**
 * 构建一个 `canUseTool` 回调。
 *
 * 实际签名是 `CanUseToolFn`（接受 5-6 个参数），此处简化为 any 以兼容。
 * 运行时值：从参数中提取工具名和输入，序列化为 JSON-RPC 通知发给 Desktop，
 * 等待 control/submit 回复后再返回决策。
 *
 * 参考：apps/tui/src/hooks/useCanUseTool.tsx:44
 */
function createSidecarCanUseTool(): any {
  return async (...args: unknown[]) => {
    // args: [tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision?]
    const tool = args[0] as { name?: string } | undefined
    const input = args[1] as Record<string, unknown> | undefined
    const toolUseID = args[4] as string | undefined
    const toolName = tool?.name ?? 'Tool'
    const requestId = randomUUID()

    sidecarLog('permission_request_sending', { requestId, toolName })

    return new Promise<_PermissionDecision>((resolve, reject) => {
      pendingPermissions.set(requestId, { resolve, reject })

      connection.sendNotification('pending/tool/permission', {
        requestId,
        toolName,
        toolUseId: toolUseID ?? '',
        input: input ?? {},
        description: `Tool: ${toolName}`,
      })

      // 60 秒超时
      setTimeout(() => {
        if (pendingPermissions.delete(requestId)) {
          sidecarLog('permission_request_timeout', { requestId })
          reject(new Error(`Permission request ${requestId} timed out`))
        }
      }, 60_000)
    })
  }
}

const sidecarCanUseTool = createSidecarCanUseTool()

const sidecarRuntime: ThreadRuntimeLike = {
  startThread(settings: ThreadRuntimeSettings): ThreadRuntimeStartResult {
    return baseRuntime.startThread({ ...settings, canUseTool: sidecarCanUseTool as any })
  },

  resumeThread(
    threadId: ThreadId,
    settings: ThreadRuntimeSettings,
    state?: JsonRpcThreadResumeParams['state'],
  ): ThreadRuntimeLifecycleResult {
    return baseRuntime.resumeThread(
      threadId,
      { ...settings, canUseTool: sidecarCanUseTool as any },
      state as any, // JSON-RPC wire type → internal type, structurally compatible
    )
  },

  forkThread(
    sourceThreadId: ThreadId,
    options?: JsonRpcThreadForkParams['options'],
  ): ThreadRuntimeLifecycleResult {
    return baseRuntime.forkThread(sourceThreadId, options as any)
  },

  async *sendTurn(
    threadId: ThreadId,
    input: JsonRpcTurnStartParams['input'],
    options?: { uuid?: string; isMeta?: boolean; turnId?: string },
  ): AsyncGenerator<ThreadEvent, void, unknown> {
    for await (const event of baseRuntime.sendTurn(threadId, input, options)) {
      yield event
    }
  },

  interruptTurn(threadId: ThreadId, turnId?: string): ThreadEvent {
    return baseRuntime.interruptTurn(threadId, turnId)
  },

  rollbackTurn(threadId: ThreadId, turnId: string): ThreadEvent {
    return baseRuntime.rollbackTurn(threadId, turnId)
  },

  injectItem(
    threadId: ThreadId,
    turnId: string,
    item: JsonRpcItemInjectParams['item'],
    type?: JsonRpcItemInjectParams['eventType'],
  ): TurnItemEvent {
    return baseRuntime.injectItem(threadId, turnId, item, type)
  },
}

// ── 组装 JsonRpcAppServer ──────────────────────────────────────────

const registry = new AppServerThreadRegistry(sidecarRuntime)
const server = new JsonRpcAppServer(registry, {
  onThreadEvent: (event: ThreadEvent) => {
    connection.sendNotification(THREAD_EVENT_NOTIFICATION, { event })
  },
})

// ── 注册 JSON-RPC 方法处理器 ────────────────────────────────────────

function registerHandlers(conn: MessageConnection): void {
  conn.onRequest('initialize', () => server.initialize())
  conn.onRequest('thread/start', params => server.startThread(params as never))
  conn.onRequest('thread/resume', params => server.resumeThread(params as never))
  conn.onRequest('thread/fork', params => server.forkThread(params as never))
  conn.onRequest('turn/start', params => server.startTurn(params as never))
  conn.onRequest('turn/interrupt', params => server.interruptTurn(params as never))
  conn.onRequest('turn/rollback', params => server.rollbackTurn(params as never))
  conn.onRequest('item/inject', params => server.injectItem(params as never))
  conn.onRequest('session/getSnapshot', params => server.getSessionSnapshot(params as never))
}

registerHandlers(connection)

// ── 启动 ────────────────────────────────────────────────────────────

sidecarLog('sidecar_started', {
  sessionId: process.env.CODEPILOTX_SIDECAR_SESSION_ID,
})

connection.listen()

// ── 工具 ────────────────────────────────────────────────────────────

function sidecarLog(event: string, data?: Record<string, unknown>): void {
  // 日志输出到 stderr（stdout 是 JSON-RPC 通道）
  console.error(
    `[app-server-sidecar] ${new Date().toISOString()} ${event} ${data ? JSON.stringify(data) : ''}`,
  )
}
