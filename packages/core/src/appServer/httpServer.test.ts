import { expect, test, beforeAll, afterAll } from 'bun:test'
import { HttpAppServer } from './httpServer.js'

let server: HttpAppServer
let baseUrl: string

beforeAll(async () => {
  const deps = {
    handleJsonRpc: async (body: unknown) => {
      const req = body as { method?: string; id?: number }
      if (req.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: 1,
            capabilities: {
              transports: ['stdio'],
              methods: [],
              notifications: [],
            },
          },
        }
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: 'Method not found' },
      }
    },
  }

  server = new HttpAppServer({ port: 0, host: '127.0.0.1' }, deps)
  await server.start()
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
})

test('GET /healthz returns 200 with status ok', async () => {
  const res = await fetch(`${baseUrl}/healthz`)
  expect(res.status).toBe(200)

  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(typeof body.port).toBe('number')
})

test('POST /jsonrpc with initialize returns expected result', async () => {
  const res = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  })

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.jsonrpc).toBe('2.0')
  expect(body.id).toBe(1)
  expect(body.result.protocolVersion).toBe(1)
})

test('POST /jsonrpc with unknown method returns error', async () => {
  const res = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'unknown/method',
      params: {},
    }),
  })

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.error.code).toBe(-32601)
})

test('invalid JSON body returns 500', async () => {
  const res = await fetch(`${baseUrl}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  })

  expect(res.status).toBe(500)
})

test('GET /events returns SSE stream', async () => {
  const res = await fetch(`${baseUrl}/events`)
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toContain('text/event-stream')
})

test('GET / (unknown path) returns 404', async () => {
  const res = await fetch(`${baseUrl}/`)
  expect(res.status).toBe(404)
})

test('auth token is generated and accessible', () => {
  expect(server.authToken).toBeTruthy()
  expect(server.authToken.length).toBe(64) // 32 bytes hex
})

test('SSE event stream delivers broadcast events', async () => {
  // 连接 SSE
  const sseRes = await fetch(`${baseUrl}/events`)
  expect(sseRes.status).toBe(200)

  // 广播事件
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

  // 从 SSE 流读取数据
  const reader = sseRes.body!.getReader()!
  let allData = ''

  // 最多读取 5 次，查找广播事件
  for (let i = 0; i < 5; i++) {
    const { done, value } = await reader.read()
    if (done) break
    allData += new TextDecoder().decode(value)
    if (allData.includes('test-event-1')) break
  }

  // 确保完全关闭
  await reader.cancel()

  expect(allData).toContain('test-event-1')
  expect(allData).toContain('thread.started')
})
