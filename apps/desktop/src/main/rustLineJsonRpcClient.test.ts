import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'

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
})
