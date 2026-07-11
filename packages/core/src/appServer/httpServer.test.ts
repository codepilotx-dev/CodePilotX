import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { IncomingMessage } from 'node:http'
import net from 'node:net'
import { HttpAppServer } from './httpServer.js'

const AUTH_TOKEN = 'test-auth-token'
const TRUSTED_ORIGIN = 'http://127.0.0.1:4173'

let server: HttpAppServer
let baseUrl: string
let handlerCalls = 0

function jsonRpcBody(method = 'initialize', id = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })
}

function authenticatedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Auth-Token': AUTH_TOKEN,
    ...extra,
  }
}

beforeAll(async () => {
  server = new HttpAppServer(
    {
      port: 0,
      host: '127.0.0.1',
      authToken: AUTH_TOKEN,
      trustedOrigins: [TRUSTED_ORIGIN],
    },
    {
      handleJsonRpc: async (body: unknown) => {
        handlerCalls += 1
        const req = body as { method?: string; id?: number }
        if (req.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: 1,
              capabilities: { transports: ['stdio'], methods: [], notifications: [] },
            },
          }
        }
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: 'Method not found' },
        }
      },
    },
  )
  await server.start()
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
})

test('loopback JSON-RPC requests require the configured token', async () => {
  const missing = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: jsonRpcBody(),
  })
  const wrong = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: authenticatedHeaders({ 'X-Auth-Token': 'wrong-token' }),
    body: jsonRpcBody(),
  })
  const valid = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: jsonRpcBody(),
  })

  expect(missing.status).toBe(401)
  expect(wrong.status).toBe(401)
  expect(valid.status).toBe(200)
})

test('health check stays unauthenticated and exposes only status', async () => {
  const res = await fetch(`${baseUrl}/healthz`)

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})

test('SSE requests require the configured token', async () => {
  const missing = await fetch(`${baseUrl}/events`)
  expect(missing.status).toBe(401)

  const valid = await fetch(`${baseUrl}/events`, {
    headers: { 'X-Auth-Token': AUTH_TOKEN },
  })
  expect(valid.status).toBe(200)
  expect(valid.headers.get('Content-Type')).toContain('text/event-stream')
  await valid.body?.cancel()
})

test('unknown browser origins are rejected before authenticated handlers run', async () => {
  const callsBefore = handlerCalls
  const rejected = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: authenticatedHeaders({ Origin: 'https://attacker.example' }),
    body: jsonRpcBody(),
  })
  const trusted = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: authenticatedHeaders({ Origin: TRUSTED_ORIGIN }),
    body: jsonRpcBody(),
  })
  const localClient = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: jsonRpcBody(),
  })

  expect(rejected.status).toBe(403)
  expect(handlerCalls).toBe(callsBefore + 2)
  expect(trusted.headers.get('Access-Control-Allow-Origin')).toBe(TRUSTED_ORIGIN)
  expect(localClient.status).toBe(200)
})

test('trusted preflight advertises only required methods and headers', async () => {
  const rejected = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.example',
      'Access-Control-Request-Method': 'POST',
    },
  })
  const accepted = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'OPTIONS',
    headers: {
      Origin: TRUSTED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, X-Auth-Token',
    },
  })

  expect(rejected.status).toBe(403)
  expect(accepted.status).toBe(204)
  expect(accepted.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST')
  expect(accepted.headers.get('Access-Control-Allow-Headers')).toBe(
    'Content-Type, X-Auth-Token',
  )
})

test('incomplete or non-browser OPTIONS requests do not bypass token auth', async () => {
  const noOrigin = await fetch(`${baseUrl}/jsonrpc`, { method: 'OPTIONS' })
  const incomplete = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'OPTIONS',
    headers: { Origin: TRUSTED_ORIGIN },
  })
  const unsupportedHeaders = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'OPTIONS',
    headers: {
      Origin: TRUSTED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization',
    },
  })
  const authenticated = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'OPTIONS',
    headers: { 'X-Auth-Token': AUTH_TOKEN },
  })

  expect(noOrigin.status).toBe(401)
  expect(incomplete.status).toBe(401)
  expect(unsupportedHeaders.status).toBe(401)
  expect(authenticated.status).toBe(405)
})

test('body limit accepts the exact limit and rejects one byte over before dispatch', async () => {
  const exactBody = jsonRpcBody()
  let limitedCalls = 0
  const limited = new HttpAppServer(
    { authToken: AUTH_TOKEN, maxBodyBytes: Buffer.byteLength(exactBody) },
    {
      handleJsonRpc: async body => {
        limitedCalls += 1
        return body
      },
    },
  )
  await limited.start()
  const url = `http://127.0.0.1:${limited.port}/jsonrpc`

  try {
    const exact = await fetch(url, {
      method: 'POST',
      headers: authenticatedHeaders(),
      body: exactBody,
    })
    const over = await fetch(url, {
      method: 'POST',
      headers: authenticatedHeaders(),
      body: `${exactBody} `,
    })

    expect(exact.status).toBe(200)
    expect(over.status).toBe(413)
    expect(limitedCalls).toBe(1)
  } finally {
    await limited.close()
  }
})

test('declared oversized bodies return 413 before dispatch', async () => {
  let limitedCalls = 0
  const limited = new HttpAppServer(
    { authToken: AUTH_TOKEN, maxBodyBytes: 8 },
    {
      handleJsonRpc: async body => {
        limitedCalls += 1
        return body
      },
    },
  )
  await limited.start()

  try {
    const result = await requestWithDeclaredLength(limited.port, 9)
    expect(result.response).toContain('HTTP/1.1 413')
    expect(result.response).toContain('Connection: close')
    expect(result.closedByServer).toBe(true)
    expect(limitedCalls).toBe(0)
  } finally {
    await limited.close()
  }
})

test('streaming oversized bodies close the connection and clean request listeners', async () => {
  let limitedCalls = 0
  let incomingRequest: IncomingMessage | undefined
  const limited = new HttpAppServer(
    { authToken: AUTH_TOKEN, maxBodyBytes: 8 },
    {
      handleJsonRpc: async body => {
        limitedCalls += 1
        return body
      },
    },
  )
  const nodeServer = (limited as unknown as {
    server: { once: (event: 'request', listener: (request: IncomingMessage) => void) => void }
  }).server
  nodeServer.once('request', request => { incomingRequest = request })
  await limited.start()

  try {
    const result = await continuouslyUpload(limited.port)
    expect(result.response.match(/HTTP\/1\.1 413/g) ?? []).toHaveLength(1)
    expect(result.response).toContain('Connection: close')
    expect(result.closedByServer).toBe(true)
    expect(limitedCalls).toBe(0)
    expect(incomingRequest?.listenerCount('data')).toBe(0)
    expect(incomingRequest?.listenerCount('end')).toBe(0)
    expect(incomingRequest?.listenerCount('error')).toBe(0)
    expect(incomingRequest?.listenerCount('aborted')).toBe(0)
  } finally {
    await limited.close()
  }
})

test('request logs omit query strings and their values', async () => {
  const sentinel = 'sentinel-query-secret'
  const captured: string[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => captured.push(args.map(String).join(' '))

  try {
    const response = await fetch(`${baseUrl}/unknown?value=${sentinel}`, {
      headers: { 'X-Auth-Token': AUTH_TOKEN },
    })
    expect(response.status).toBe(404)
  } finally {
    console.error = originalConsoleError
  }

  expect(captured.join('\n')).not.toContain(sentinel)
  expect(captured.join('\n')).toContain('/unknown')
})

test('token values never appear in logs or internal error responses', async () => {
  const secret = 'sentinel-secret-token'
  const captured: string[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => captured.push(args.map(String).join(' '))
  const throwing = new HttpAppServer(
    { authToken: secret },
    { handleJsonRpc: async () => { throw new Error(`failed with ${secret}`) } },
  )

  try {
    await throwing.start()
    const response = await fetch(`http://127.0.0.1:${throwing.port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': secret },
      body: jsonRpcBody(),
    })
    expect(await response.text()).not.toContain(secret)
  } finally {
    await throwing.close()
    console.error = originalConsoleError
  }

  expect(captured.join('\n')).not.toContain(secret)
})

test('authenticated SSE stream delivers broadcast events', async () => {
  const sseRes = await fetch(`${baseUrl}/events`, {
    headers: { 'X-Auth-Token': AUTH_TOKEN },
  })
  const testEvent = {
    schemaVersion: 1,
    eventId: 'test-event-1',
    sequence: 1,
    type: 'thread.started' as const,
    threadId: 'test-thread',
    createdAt: new Date().toISOString(),
    metadata: {},
  }
  server.broadcastEvent(testEvent as any)

  const reader = sseRes.body!.getReader()
  let allData = ''
  for (let i = 0; i < 5; i++) {
    const { done, value } = await reader.read()
    if (done) break
    allData += new TextDecoder().decode(value)
    if (allData.includes('test-event-1')) break
  }
  await reader.cancel()

  expect(allData).toContain('test-event-1')
  expect(allData).toContain('thread.started')
})

function requestWithDeclaredLength(port: number, contentLength: number): Promise<{
  response: string
  closedByServer: boolean
}> {
  return new Promise((resolve, reject) => {
    let response = ''
    let closedByServer = true
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write([
        'POST /jsonrpc HTTP/1.1',
        'Host: 127.0.0.1',
        'Content-Type: application/json',
        `Content-Length: ${contentLength}`,
        `X-Auth-Token: ${AUTH_TOKEN}`,
        'Connection: close',
        '',
        'x',
      ].join('\r\n'))
    })
    socket.setEncoding('utf8')
    socket.on('data', data => { response += data })
    socket.on('error', error => {
      if (!response.includes('413')) reject(error)
    })
    const timeout = setTimeout(() => {
      closedByServer = false
      socket.destroy()
    }, 500)
    socket.on('close', () => {
      clearTimeout(timeout)
      resolve({ response, closedByServer })
    })
  })
}

function continuouslyUpload(port: number): Promise<{
  response: string
  closedByServer: boolean
}> {
  return new Promise((resolve, reject) => {
    let response = ''
    let closedByServer = true
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write([
        'POST /jsonrpc HTTP/1.1',
        'Host: 127.0.0.1',
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        `X-Auth-Token: ${AUTH_TOKEN}`,
        '',
        '',
      ].join('\r\n'))
    })
    socket.setEncoding('utf8')
    socket.on('data', data => { response += data })
    socket.on('error', error => {
      if (!response.includes('413')) reject(error)
    })
    const upload = setInterval(() => {
      if (socket.destroyed) return
      socket.write('10\r\n0123456789abcdef\r\n')
    }, 2)
    const timeout = setTimeout(() => {
      closedByServer = false
      socket.destroy()
    }, 500)
    socket.on('close', () => {
      clearInterval(upload)
      clearTimeout(timeout)
      resolve({ response, closedByServer })
    })
  })
}
