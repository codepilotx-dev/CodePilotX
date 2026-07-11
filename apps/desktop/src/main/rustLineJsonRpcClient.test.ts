import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import {
  RustJsonRpcError,
  RustLineJsonRpcClient,
} from './rustLineJsonRpcClient.js'

describe('RustLineJsonRpcClient', () => {
  test('sends newline-delimited JSON-RPC requests and resolves responses', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    const resultPromise = client.sendRequest('initialize', { client: 'desktop' })
    const request = JSON.parse(writes.join('').trim()) as { id: number }
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { ok: true },
    })}\n`)

    await expect(resultPromise).resolves.toEqual({ ok: true })
    expect(writes.join('')).toBe(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        method: 'initialize',
        params: { client: 'desktop' },
      })}\n`,
    )
  })

  test('sends notification without id', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    client.sendNotification('initialized')

    expect(writes.join('')).toBe(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`,
    )
  })

  test('sends notification with params', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    client.sendNotification('custom/event', { key: 'value' })

    expect(writes.join('')).toBe(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'custom/event',
        params: { key: 'value' },
      })}\n`,
    )
  })

  test('sendNotification throws when client is closed', () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })

    client.close()

    expect(() => client.sendNotification('initialized')).toThrow('closed')
  })

  test('emits notifications by method', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const notifications: unknown[] = []

    client.onNotification('turn/completed', params => {
      notifications.push(params)
    })

    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1' },
    })}\n`)

    expect(notifications).toEqual([{ threadId: 'thread-1' }])
  })

  test('rejects pending requests when the input closes', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })

    const resultPromise = client.sendRequest('thread/start', {})
    input.end()

    await expect(resultPromise).rejects.toThrow('closed')
  })

  test('preserves JSON-RPC error code, message, and data', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    const resultPromise = client.sendRequest('turn/steer', {})
    const request = JSON.parse(writes.join('').trim()) as { id: number }
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32602,
        message: 'Active turn is not steerable',
        data: { type: 'activeTurnNotSteerable', turnId: 'turn-1' },
      },
    })}\n`)

    try {
      await resultPromise
      throw new Error('Expected the request to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RustJsonRpcError)
      expect(error).toMatchObject({
        name: 'RustJsonRpcError',
        code: -32602,
        message: 'Active turn is not steerable',
        data: { type: 'activeTurnNotSteerable', turnId: 'turn-1' },
      })
    }
  })

  test('onAnyNotification receives all notifications regardless of method', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const received: Array<{ method: string; params: unknown }> = []

    client.onAnyNotification((method, params) => {
      received.push({ method, params })
    })

    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'thread/started',
      params: { thread: { id: 't1' } },
    })}\n`)
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/started',
      params: { item: { type: 'dynamicToolCall' } },
    })}\n`)

    expect(received).toHaveLength(2)
    expect(received[0]).toEqual({
      method: 'thread/started',
      params: { thread: { id: 't1' } },
    })
    expect(received[1]).toEqual({
      method: 'item/started',
      params: { item: { type: 'dynamicToolCall' } },
    })
  })

  test('onAnyNotification disposer stops receiving notifications', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const received: string[] = []

    const dispose = client.onAnyNotification((method) => {
      received.push(method)
    })
    dispose()

    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/started',
      params: {},
    })}\n`)

    expect(received).toHaveLength(0)
  })

  test('onRequest handler is called for server-initiated requests', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    const handler = client.onRequest('item/tool/call', async (params, id) => {
      return { result: 'executed', toolUseId: (params as Record<string, unknown>).tool_use_id }
    })

    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/tool/call',
      id: 42,
      params: { tool_use_id: 'tool-1', name: 'Bash' },
    })}\n`)

    // Small delay for the async handler to respond
    await new Promise(r => setTimeout(r, 10))

    const response = JSON.parse(writes.join('').trim())
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { result: 'executed', toolUseId: 'tool-1' },
    })

    handler()
  })

  test('unhandled server request gets auto error response', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/permissions/requestApproval',
      id: 99,
      params: { tool_name: 'Bash' },
    })}\n`)

    await new Promise(r => setTimeout(r, 10))

    const response = JSON.parse(writes.join('').trim())
    expect(response.id).toBe(99)
    expect(response.result).toBeTruthy()
    expect(response.result.isError).toBe(true)
    expect(response.result.error).toContain('not supported')
  })

  test('sendResponse sends a JSON-RPC response to a server request', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const client = new RustLineJsonRpcClient({ input, output })
    const writes: string[] = []
    output.on('data', chunk => writes.push(chunk.toString('utf8')))

    client.sendResponse(7, { behavior: 'allow', toolUseID: 'tool-2' })

    const response = JSON.parse(writes.join('').trim())
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { behavior: 'allow', toolUseID: 'tool-2' },
    })
  })
})
