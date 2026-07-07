import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

type JsonRpcId = number

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type JsonRpcErrorObject = {
  code?: number
  message?: string
  data?: unknown
}

export class RustLineJsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private readonly notifications = new Map<
    string,
    Set<(params: unknown) => void>
  >()
  private readonly lines: Interface
  private closed = false

  constructor(
    private readonly streams: {
      input: Readable
      output: Writable
    },
  ) {
    this.lines = createInterface({
      input: streams.input,
      crlfDelay: Infinity,
    })
    this.lines.on('line', line => this.handleLine(line))
    this.lines.on('close', () => this.rejectAll(new Error('Rust JSON-RPC input closed')))
  }

  sendNotification(method: string, params?: unknown): void {
    if (this.closed) {
      throw new Error('Rust JSON-RPC client is closed')
    }
    const message: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
    }
    if (params !== undefined) {
      message.params = params
    }
    this.streams.output.write(`${JSON.stringify(message)}\n`, error => {
      if (error) {
        throw error
      }
    })
  }

  sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Rust JSON-RPC client is closed'))
    }
    const id = this.nextId++
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.streams.output.write(`${JSON.stringify(message)}\n`, error => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  onNotification(
    method: string,
    listener: (params: unknown) => void,
  ): () => void {
    let listeners = this.notifications.get(method)
    if (!listeners) {
      listeners = new Set()
      this.notifications.set(method, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) {
        this.notifications.delete(method)
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.lines.close()
    this.rejectAll(new Error('Rust JSON-RPC client closed'))
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }
    if (!isRecord(message)) return

    if (typeof message.id === 'number') {
      this.handleResponse(message.id, message)
      return
    }

    if (typeof message.method === 'string') {
      const listeners = this.notifications.get(message.method)
      if (!listeners) return
      for (const listener of listeners) {
        listener(message.params)
      }
    }
  }

  private handleResponse(id: JsonRpcId, message: Record<string, unknown>): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)

    if (isRecord(message.error)) {
      pending.reject(jsonRpcError(message.error))
      return
    }

    pending.resolve(message.result)
  }

  private rejectAll(error: Error): void {
    if (this.closed && this.pending.size === 0) return
    this.closed = true
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function jsonRpcError(error: JsonRpcErrorObject): Error {
  const message = error.message || `JSON-RPC error ${error.code ?? 'unknown'}`
  const result = new Error(message)
  result.name = 'RustJsonRpcError'
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
