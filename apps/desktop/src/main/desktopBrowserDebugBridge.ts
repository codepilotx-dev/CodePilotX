import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DESKTOP_API_METHODS, type DesktopApiMethod } from '../shared/ipcChannels.js'
import { validateDesktopApiArgs } from '../shared/desktopApiSchema.js'
import { decodeDesktopBridgeArgs } from '../shared/desktopBridgeArgs.js'
import type { DesktopApiHandlers } from './ipc.js'

export const DEFAULT_DESKTOP_BROWSER_DEBUG_PORT = 53271

const desktopApiMethods = new Set<string>(DESKTOP_API_METHODS)
const desktopEventChannels = [
  'desktop:agent-event',
  'desktop:workflow-event',
  'desktop:ui-command',
  'desktop:update-status',
] as const

export type DesktopBrowserDebugBridgeServer = {
  port: number
  close(): Promise<void>
}

export type DesktopBrowserDebugBridge = {
  start(): Promise<DesktopBrowserDebugBridgeServer | null>
}

export function resolveDesktopBrowserDebugPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = Number.parseInt(
    env.CODEPILOTX_DESKTOP_BROWSER_DEBUG_PORT ??
      env.CLAUDE_CODE_DESKTOP_BROWSER_DEBUG_PORT ??
      `${DEFAULT_DESKTOP_BROWSER_DEBUG_PORT}`,
    10,
  )
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DESKTOP_BROWSER_DEBUG_PORT
}

export function createDesktopBrowserDebugBridge(options: {
  handlers: DesktopApiHandlers
  events: EventEmitter
  enabled: boolean
  port?: number
  token?: string
}): DesktopBrowserDebugBridge {
  return {
    async start(): Promise<DesktopBrowserDebugBridgeServer | null> {
      if (!options.enabled) return null
      const server = createServer((request, response) => {
        void handleRequest(options, request, response)
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? resolveDesktopBrowserDebugPort(), '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      const address = server.address() as AddressInfo
      return {
        port: address.port,
        close: () =>
          new Promise(resolve => {
            server.close(() => resolve())
          }),
      }
    },
  }
}

async function handleRequest(
  options: {
    handlers: DesktopApiHandlers
    events: EventEmitter
    token?: string
  },
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // Require bearer token if configured (matching automation bridge pattern)
  if (options.token) {
    const authHeader = request.headers.authorization
    if (!authHeader || authHeader !== `Bearer ${options.token}`) {
      writeText(response, 401, 'Unauthorized')
      return
    }
  }
  setCorsHeaders(response)
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/desktop-events') {
    handleEvents(options.events, response)
    return
  }
  if (request.method !== 'POST' || !url.pathname.startsWith('/desktop-api/')) {
    writeText(response, 404, 'Not found')
    return
  }

  const method = decodeURIComponent(url.pathname.slice('/desktop-api/'.length))
  if (!desktopApiMethods.has(method)) {
    writeText(response, 404, `Unknown DesktopApi method: ${method}`)
    return
  }

  let args: unknown[]
  try {
    const body = await readJsonBody(request)
    args = validateDesktopApiArgs(
      method as DesktopApiMethod,
      Array.isArray(body.args) ? decodeDesktopBridgeArgs(body.args) : [],
    )
  } catch (error) {
    writeText(
      response,
      400,
      `Invalid DesktopApi arguments: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return
  }

  try {
    const handler = options.handlers[method as DesktopApiMethod] as (
      ...handlerArgs: unknown[]
    ) => unknown
    writeJson(response, 200, await handler(...args))
  } catch (error) {
    writeText(
      response,
      500,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function handleEvents(events: EventEmitter, response: ServerResponse): void {
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  })
  response.write(': connected\n\n')
  const listeners = desktopEventChannels.map(channel => {
    const listener = (payload: unknown) => {
      response.write(`event: ${channel}\n`)
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    events.on(channel, listener)
    return { channel, listener }
  })
  response.on('close', () => {
    for (const { channel, listener } of listeners) {
      events.off(channel, listener)
    }
  })
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', 'http://127.0.0.1')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type, authorization')
}

async function readJsonBody(request: IncomingMessage): Promise<{ args?: unknown }> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) as { args?: unknown } : {}
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

function writeText(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
  })
  response.end(message)
}
