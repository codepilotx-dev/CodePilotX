/**
 * HttpAppServer —— 在 JSON-RPC stdio 基础上添加 loopback HTTP API + SSE event stream。
 *
 * 参考：
 *   - codex-main: app-server-transport 的 `start_websocket_acceptor` + `/healthz` + `auth`
 *   - opencode: ServerAuth (password-based Basic Auth)
 *   - claude-code-master: DirectConnectManager (WebSocket session + authToken)
 *
 * v3 设计：
 *   - loopback-only（127.0.0.1）绑定，默认随机 token 认证
 *   - POST /jsonrpc → 处理 JSON-RPC 请求
 *   - GET /events → SSE event stream（thread/event 通知）
 *   - GET /healthz → 健康检查
 *   - X-Auth-Token 头部认证
 */

import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { ThreadEvent } from '../agent/workflow.js'

// ── 类型 ─────────────────────────────────────────────────────────────────

export type HttpAppServerConfig = {
  /** 监听端口（默认 0 = 自动分配） */
  port?: number
  /** 监听地址（默认 127.0.0.1 = loopback-only） */
  host?: string
  /** 自定义 auth token（默认自动生成 32 字节 hex） */
  authToken?: string
  /** 允许发起浏览器请求的精确 Origin；无 Origin 的本地客户端不受影响。 */
  trustedOrigins?: readonly string[]
  /** JSON-RPC 请求体字节上限（默认 1 MiB）。 */
  maxBodyBytes?: number
}

export type HttpAppServerDeps = {
  /** 处理 JSON-RPC 请求体，返回 JSON-RPC 响应体 */
  handleJsonRpc: (body: unknown) => Promise<unknown>
  /** 事件广播：每个 thread/event 通知时调用 */
  onThreadEvent?: (event: ThreadEvent) => void
}

// ── SSE 客户端管理 ────────────────────────────────────────────────────────

class SseClientManager {
  readonly clients = new Set<ServerResponse>()

  add(res: ServerResponse): void {
    res.on('close', () => this.clients.delete(res))
    this.clients.add(res)
  }

  broadcast(event: ThreadEvent): void {
    const data = JSON.stringify({ event })
    for (const client of this.clients) {
      try {
        client.write(`event: thread/event\ndata: ${data}\n\n`)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  get clientCount(): number {
    return this.clients.size
  }
}

// ── Auth 工具 ────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

// ── Request 日志 ─────────────────────────────────────────────────────────

function logRequest(method: string | undefined, url: string | undefined, status: number): void {
  console.error(
    `[http-app-server] ${new Date().toISOString()} ${method ?? '?'} ${url ?? '?'} ${status}`,
  )
}

// ── HttpAppServer ────────────────────────────────────────────────────────

export class HttpAppServer {
  private server: http.Server
  private sseManager = new SseClientManager()
  private _port = 0
  private _authToken: string
  private trustedOrigins: ReadonlySet<string>
  private maxBodyBytes: number
  private _started = false

  constructor(
    config: HttpAppServerConfig,
    private deps: HttpAppServerDeps,
  ) {
    this._authToken = config.authToken ?? generateToken()
    this.trustedOrigins = new Set(config.trustedOrigins ?? [])
    this.maxBodyBytes = normalizeBodyLimit(config.maxBodyBytes)
    this.server = http.createServer((req, res) =>
      this.handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(502)
          res.end()
        }
      }),
    )
    // 在构造函数中仅创建 server，start() 时才 listen
  }

  /** 启动监听。*/
  async start(config?: HttpAppServerConfig): Promise<void> {
    if (this._started) return
    this._started = true

    const host = config?.host ?? '127.0.0.1'
    const port = config?.port ?? 0

    return new Promise(resolve => {
      this.server.listen(port, host, () => {
        const addr = this.server.address()
        if (addr && typeof addr === 'object') {
          this._port = addr.port
          console.error(`[http-app-server] listening on http://${host}:${this._port}`)
        }
        resolve()
      })
    })
  }

  get port(): number {
    return this._port
  }

  get authToken(): string {
    return this._authToken
  }

  /** 关闭服务器。*/
  async close(): Promise<void> {
    // 关闭所有 SSE 连接，否则 server.close() 会挂起等待
    for (const client of this.sseManager.clients) {
      try {
        client.destroy()
      } catch {
        // 忽略销毁错误
      }
    }
    this.sseManager.clients.clear()

    return new Promise(resolve => this.server.close(() => resolve()))
  }

  /** 手动触发向所有 SSE 客户端广播事件。*/
  broadcastEvent(event: ThreadEvent): void {
    this.sseManager.broadcast(event)
  }

  // ── 请求路由 ───────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin
    if (origin !== undefined) {
      res.setHeader('Vary', 'Origin')
      if (!this.trustedOrigins.has(origin)) {
        logRequest(req.method, req.url, 403)
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      res.setHeader('Access-Control-Allow-Origin', origin)
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
      res.writeHead(204)
      res.end()
      return
    }

    const urlPath = req.url ?? '/'

    // 健康检查只报告存活状态，不进入凭据边界。
    if (urlPath === '/healthz') {
      return this.handleHealthz(res)
    }

    if (!this.verifyAuth(req)) {
      logRequest(req.method, req.url, 401)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid X-Auth-Token' }))
      return
    }

    switch (urlPath) {
      case '/events':
        return this.handleSse(req, res)

      case '/jsonrpc':
        return this.handleJsonRpc(req, res)

      default:
        logRequest(req.method, req.url, 404)
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
    }
  }

  private verifyAuth(req: IncomingMessage): boolean {
    const token = req.headers['x-auth-token']
    if (typeof token !== 'string') return false
    const actual = Buffer.from(token, 'utf8')
    const expected = Buffer.from(this._authToken, 'utf8')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  // ── Healthz ────────────────────────────────────────────────────────────

  private handleHealthz(res: ServerResponse): void {
    logRequest('GET', '/healthz', 200)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  }

  // ── SSE ────────────────────────────────────────────────────────────────

  private handleSse(_req: IncomingMessage, res: ServerResponse): void {
    logRequest('GET', '/events', 200)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // 初始连接确认
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok' })}\n\n`)

    // 心跳
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 15_000)

    this.sseManager.add(res)

    res.on('close', () => {
      clearInterval(heartbeat)
    })
  }

  // ── JSON-RPC ───────────────────────────────────────────────────────────

  private async handleJsonRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      logRequest(req.method, req.url, 405)
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method Not Allowed' }))
      return
    }

    if (isDeclaredOversized(req, this.maxBodyBytes)) {
      logRequest('POST', '/jsonrpc', 413)
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Payload Too Large' }))
      return
    }

    try {
      const body = await collectBody(req, this.maxBodyBytes)
      const result = await this.deps.handleJsonRpc(body)

      logRequest('POST', '/jsonrpc', 200)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        logRequest('POST', '/jsonrpc', 413)
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Payload Too Large' }))
        return
      }
      logRequest('POST', '/jsonrpc', 500)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Internal server error' },
      }))
    }
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────

class BodyTooLargeError extends Error {}

function normalizeBodyLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_BODY_BYTES
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('maxBodyBytes must be a positive safe integer')
  }
  return value
}

function isDeclaredOversized(req: IncomingMessage, maxBodyBytes: number): boolean {
  const value = req.headers['content-length']
  if (value === undefined) return false
  const declaredBytes = Number(value)
  return Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes
}

function collectBody(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytesRead = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      bytesRead += chunk.length
      if (bytesRead > maxBodyBytes) {
        settled = true
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', error => {
      if (!settled) reject(error)
    })
  })
}
