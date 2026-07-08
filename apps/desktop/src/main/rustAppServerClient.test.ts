import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import { RustAppServerClient } from './rustAppServerClient.js'

/** Helper: create a RustAppServerClient backed by PassThrough streams. */
function createTestClient(): {
  client: RustAppServerClient
  input: PassThrough
  output: PassThrough
} {
  const input = new PassThrough()
  const output = new PassThrough()
  const transport = new RustLineJsonRpcClient({ input, output })
  const client = new RustAppServerClient(transport)
  return { client, input, output }
}

function collectWrites(output: PassThrough): string[] {
  const writes: string[] = []
  output.on('data', chunk => writes.push(chunk.toString('utf8')))
  return writes
}

describe('RustAppServerClient', () => {
  test('initialize sends correct JSON-RPC request', async () => {
    const { client, input, output } = createTestClient()
    const writes = collectWrites(output)

    const resultPromise = client.initialize({
      clientInfo: { name: 'test', title: null, version: '1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })

    // Parse the outgoing request to get the id
    const sent = JSON.parse(writes.join('').trim()) as {
      id: number
      method: string
      params: unknown
    }
    expect(sent.method).toBe('initialize')
    expect(sent.params).toEqual({
      clientInfo: { name: 'test', title: null, version: '1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })

    // Respond
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        result: {
          userAgent: 'codepilotx-app-server/0.1.0',
          codexHome: '/home/user/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        },
      })}\n`,
    )

    const result = await resultPromise
    expect(result.userAgent).toBe('codepilotx-app-server/0.1.0')
    expect(result.codexHome).toBe('/home/user/.codex')
  })

  test('notifyInitialized sends notification without id or params', () => {
    const { client, output } = createTestClient()
    const writes = collectWrites(output)

    client.notifyInitialized()

    const sent = JSON.parse(writes.join('').trim())
    expect(sent).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
    })
  })

  test('startThread sends thread/start request', async () => {
    const { client, input, output } = createTestClient()
    const writes = collectWrites(output)

    const resultPromise = client.startThread({
      model: 'test-model',
      modelProvider: 'test-minimax',
      cwd: '/workspace',
      ephemeral: true,
    })

    const sent = JSON.parse(writes.join('').trim())
    expect(sent.method).toBe('thread/start')
    expect(sent.params).toEqual({
      model: 'test-model',
      modelProvider: 'test-minimax',
      cwd: '/workspace',
      ephemeral: true,
    })

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        result: {
          thread: {
            id: 'thread-abc',
            sessionId: 'session-1',
            preview: '',
            ephemeral: true,
            modelProvider: 'anthropic',
            createdAt: 1000,
            updatedAt: 1000,
            status: { type: 'idle' },
            cwd: '/workspace',
            turns: [],
            name: null,
          },
          model: 'test-model',
          modelProvider: 'anthropic',
          cwd: '/workspace',
          approvalPolicy: 'on-request',
        },
      })}\n`,
    )

    const result = await resultPromise
    expect(result.thread.id).toBe('thread-abc')
  })

  test('startTurn sends turn/start request', async () => {
    const { client, input, output } = createTestClient()
    const writes = collectWrites(output)

    const resultPromise = client.startTurn({
      threadId: 'thread-abc',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
    })

    const sent = JSON.parse(writes.join('').trim())
    expect(sent.method).toBe('turn/start')
    expect(sent.params).toEqual({
      threadId: 'thread-abc',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
    })

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        result: {
          turn: {
            id: 'turn-xyz',
            items: [],
            status: 'inProgress',
            error: null,
            startedAt: 1000,
            completedAt: null,
            durationMs: null,
          },
        },
      })}\n`,
    )

    const result = await resultPromise
    expect(result.turn.id).toBe('turn-xyz')
    expect(result.turn.status).toBe('inProgress')
  })

  test('interruptTurn sends turn/interrupt request', async () => {
    const { client, input, output } = createTestClient()
    const writes = collectWrites(output)

    const resultPromise = client.interruptTurn({
      threadId: 'thread-abc',
      turnId: 'turn-xyz',
    })

    const sent = JSON.parse(writes.join('').trim())
    expect(sent.method).toBe('turn/interrupt')
    expect(sent.params).toEqual({
      threadId: 'thread-abc',
      turnId: 'turn-xyz',
    })

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        result: {},
      })}\n`,
    )

    await resultPromise
  })

  test('onServerNotification registers listeners for known methods', () => {
    const { client, input } = createTestClient()
    const notifications: Array<{ method: string; params: unknown }> = []

    const dispose = client.onServerNotification((method, params) => {
      notifications.push({ method, params })
    })

    // Send a thread/started notification
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/started',
        params: { thread: { id: 't1' } },
      })}\n`,
    )

    // Send a turn/started notification
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { turn: { id: 't2' } },
      })}\n`,
    )

    expect(notifications).toHaveLength(2)
    expect(notifications[0].method).toBe('thread/started')
    expect(notifications[1].method).toBe('turn/started')

    // After dispose, notifications should stop
    dispose()
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/started',
        params: { thread: { id: 't3' } },
      })}\n`,
    )
    expect(notifications).toHaveLength(2)
  })

  test('close delegates to transport', () => {
    const { client } = createTestClient()
    client.close()
    // After close, sending should reject
    expect(client.initialize({
      clientInfo: { name: 'test', title: null, version: '1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })).rejects.toThrow('closed')
  })
})
