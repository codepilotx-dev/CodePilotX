import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const ALLOWED_BROWSER_ACTIONS = new Set([
  'open_url',
  'click',
  'type',
  'press',
  'wait_for',
  'snapshot',
  'screenshot',
  'evaluate_readonly',
  'get_resource',
])

export type DesktopBrowserAutomationAction = {
  action: string
  [key: string]: unknown
}

export type DesktopBrowserAutomationBridgeServer = {
  port: number
  close(): Promise<void>
}

export type DesktopBrowserAutomationBridge = {
  start(): Promise<DesktopBrowserAutomationBridgeServer>
}

export function createDesktopBrowserAutomationBridge(options: {
  token: string
  port?: number
  handleAction(input: DesktopBrowserAutomationAction): Promise<unknown>
}): DesktopBrowserAutomationBridge {
  return {
    async start(): Promise<DesktopBrowserAutomationBridgeServer> {
      const server = createServer((request, response) => {
        void handleRequest(options, request, response)
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 0, '127.0.0.1', () => {
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
    token: string
    handleAction(input: DesktopBrowserAutomationAction): Promise<unknown>
  },
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/browser/action') {
    writeText(response, 404, 'Not found')
    return
  }
  if (request.headers.authorization !== `Bearer ${options.token}`) {
    writeText(response, 401, 'Unauthorized')
    return
  }

  let input: DesktopBrowserAutomationAction
  try {
    input = await readActionBody(request)
  } catch (error) {
    writeText(
      response,
      400,
      error instanceof Error ? error.message : String(error),
    )
    return
  }
  if (!ALLOWED_BROWSER_ACTIONS.has(input.action)) {
    writeText(response, 400, `Unsupported browser action: ${input.action}`)
    return
  }

  try {
    writeJson(response, 200, await options.handleAction(input))
  } catch (error) {
    writeText(
      response,
      500,
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function readActionBody(
  request: IncomingMessage,
): Promise<DesktopBrowserAutomationAction> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = raw ? JSON.parse(raw) : {}
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Browser action body must be an object.')
  }
  const action = (parsed as { action?: unknown }).action
  if (typeof action !== 'string' || !action.trim()) {
    throw new Error('Browser action is required.')
  }
  return { ...(parsed as Record<string, unknown>), action }
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
