/**
 * HTTP app-server entrypoint —— 通过 loopback HTTP API + SSE 暴露运行时。
 *
 * 用法：
 *   bun apps/tui/src/entrypoints/appServerHttp.ts
 *
 * 环境变量：
 *   CODEPILOTX_SIDECAR_SESSION_ID  — 会话 ID（可选）
 *   HTTP_APP_SERVER_PORT           — 端口（默认 0 = 自动分配）
 *   HTTP_APP_SERVER_AUTH_TOKEN     — 自定义 token（默认自动生成）
 *
 * 端点：
 *   GET  /healthz   — 健康检查
 *   GET  /events    — SSE event stream
 *   POST /jsonrpc   — JSON-RPC 请求
 *
 * 参考：
 *   - codex-main: start_websocket_acceptor + healthz
 *   - opencode: ServerAuth
 */

import { randomUUID } from 'node:crypto'
import { HttpAppServer } from '@codepilotx/core/appServer/httpServer.js'
import { JsonRpcAppServer } from '@codepilotx/core/appServer/server.js'
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import { AppServerThreadRegistry } from '../appServer/registry.js'
import { ThreadRuntime } from '../workflow/ThreadRuntime.js'
import type {
  ThreadRuntimeSettings,
  ThreadRuntimeLifecycleResult,
  ThreadRuntimeStartResult,
} from '../workflow/ThreadRuntime.js'
import type { ThreadRuntimeLike } from '../appServer/registry.js'
import type {
  ThreadId,
  TurnItemEvent,
} from '@codepilotx/core/agent/workflow.js'
import type {
  JsonRpcItemInjectParams,
  JsonRpcThreadForkParams,
  JsonRpcThreadResumeParams,
  JsonRpcTurnStartParams,
} from '../appServer/protocol.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'

// 1. 读取配置
const port = parseInt(process.env.HTTP_APP_SERVER_PORT ?? '0', 10)
const customToken = process.env.HTTP_APP_SERVER_AUTH_TOKEN || undefined

// 2. 权限请求存储
const pendingPermissions = new Map<
  string,
  {
    resolve: (decision: { behavior: string }) => void
    reject: (err: Error) => void
  }
>()

// 3. 构建 canUseTool 回调
function createCanUseTool(): CanUseToolFn {
  return async (...args: unknown[]) => {
    const tool = args[0] as { name?: string } | undefined
    const toolUseID = args[4] as string | undefined
    const requestId = randomUUID()

    serverLog('permission_request', { requestId, toolName: tool?.name })

    return new Promise((resolve, reject) => {
      pendingPermissions.set(requestId, { resolve, reject })

      // 超时保护
      setTimeout(() => {
        if (pendingPermissions.delete(requestId)) {
          reject(new Error(`Permission request ${requestId} timed out`))
        }
      }, 60_000)
    })
  }
}

const canUseTool = createCanUseTool()
const baseRuntime = new ThreadRuntime()

const sidecarRuntime: ThreadRuntimeLike = {
  startThread(settings: ThreadRuntimeSettings): ThreadRuntimeStartResult {
    return baseRuntime.startThread({ ...settings, canUseTool } as any)
  },
  resumeThread(threadId: ThreadId, settings: ThreadRuntimeSettings, state?: any): ThreadRuntimeLifecycleResult {
    return baseRuntime.resumeThread(threadId, { ...settings, canUseTool } as any, state)
  },
  forkThread(sourceThreadId: ThreadId, options?: any): ThreadRuntimeLifecycleResult {
    return baseRuntime.forkThread(sourceThreadId, options)
  },
  async *sendTurn(threadId: ThreadId, input: any, options?: any): AsyncGenerator<ThreadEvent, void, unknown> {
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
  injectItem(threadId: ThreadId, turnId: string, item: any, type?: any): TurnItemEvent {
    return baseRuntime.injectItem(threadId, turnId, item, type)
  },
}

const registry = new AppServerThreadRegistry(sidecarRuntime)
const jsonRpcServer = new JsonRpcAppServer(registry, {
  onThreadEvent: (event: ThreadEvent) => {
    httpServer.broadcastEvent(event)
  },
})

// 4. JSON-RPC 请求处理方法
async function handleJsonRpc(body: unknown): Promise<unknown> {
  const request = body as {
    jsonrpc?: string
    id?: number | string
    method?: string
    params?: unknown
  }

  if (!request || request.jsonrpc !== '2.0' || !request.method) {
    return {
      jsonrpc: '2.0',
      id: request?.id ?? null,
      error: { code: -32600, message: 'Invalid Request' },
    }
  }

  const { method, params, id } = request
  const server = jsonRpcServer

  try {
    let result: unknown
    switch (method) {
      case 'initialize':
        result = await server.initialize()
        break
      case 'thread/start':
        result = await server.startThread(params as never)
        break
      case 'thread/resume':
        result = await server.resumeThread(params as never)
        break
      case 'thread/fork':
        result = await server.forkThread(params as never)
        break
      case 'turn/start':
        result = await server.startTurn(params as never)
        break
      case 'turn/interrupt':
        result = await server.interruptTurn(params as never)
        break
      case 'turn/rollback':
        result = await server.rollbackTurn(params as never)
        break
      case 'item/inject':
        result = await server.injectItem(params as never)
        break
      case 'session/getSnapshot':
        result = await server.getSessionSnapshot(params as never)
        break
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }
    }
    return { jsonrpc: '2.0', id, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message },
    }
  }
}

// 5. 创建 HTTP 服务器
const httpServer = new HttpAppServer(
  { port, host: '127.0.0.1', authToken: customToken },
  { handleJsonRpc },
)

await httpServer.start()

serverLog(`started on port ${httpServer.port}`)

// 输出端口信息到 stdout（方便父进程读取）
console.log(JSON.stringify({
  type: 'app_server_ready',
  port: httpServer.port,
  authToken: httpServer.authToken,
}))

function serverLog(message: string, data?: Record<string, unknown>): void {
  console.error(`[app-server-http] ${new Date().toISOString()} ${message} ${data ? JSON.stringify(data) : ''}`)
}
