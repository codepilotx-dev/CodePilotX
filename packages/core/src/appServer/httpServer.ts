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
import { randomBytes } from 'node:crypto'
import type { ThreadEvent } from '../agent/workflow.js'

// ── 类型 ─────────────────────────────────────────────────────────────────

export type HttpAppServerConfig = {
  /** 监听端口（默认 0 = 自动分配） */
  port?: number
  /** 监听地址（默认 127.0.0.1 = loopback-only） */
  host?: string
  /** 自定义 auth token（默认自动生成 32 字节 hex） */
  authToken?: string
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

function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost'
}

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
  private _started = false

  constructor(
    config: HttpAppServerConfig,
    private deps: HttpAppServerDeps,
  ) {
    this._authToken = config.authToken ?? generateToken()
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
          console.error(
            `[http-app-server] listening on http://${host}:${this._port} (authToken: ${this._authToken.slice(0, 8)}...)`,
          )
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
    // CORS headers（loopback-only，宽策略）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Auth verification（非 loopback 需要 token）
    if (!this.verifyAuth(req)) {
      logRequest(req.method, req.url, 401)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Missing or invalid X-Auth-Token' }))
      return
    }

    const urlPath = req.url ?? '/'

    switch (urlPath) {
      case '/healthz':
        return this.handleHealthz(res)

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
    const socket = req.socket
    const address = socket.remoteAddress
    // loopback 跳过 auth
    if (address && isLoopback(address)) {
      return true
    }
    const token = req.headers['x-auth-token']
    return token === this._authToken
  }

  // ── Healthz ────────────────────────────────────────────────────────────

  private handleHealthz(res: ServerResponse): void {
    logRequest('GET', '/healthz', 200)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      port: this._port,
      sseClients: this.sseManager.clientCount,
    }))
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

    try {
      const body = await collectBody(req)
      const result = await this.deps.handleJsonRpc(body)

      logRequest('POST', '/jsonrpc', 200)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logRequest('POST', '/jsonrpc', 500)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message },
      }))
    }
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────

function collectBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
