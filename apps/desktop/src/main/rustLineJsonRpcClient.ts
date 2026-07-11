import { createInterface, type Interface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { desktopDebug } from './desktopDebug.js'

export type JsonRpcId = number

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
  private readonly anyNotificationListeners = new Set<
    (method: string, params: unknown) => void
  >()
  private readonly serverRequestHandlers = new Map<
    string,
    (params: unknown, id: JsonRpcId) => Promise<unknown>
  >()
  private readonly lines: Interface
  private closed = false
  private fatalError: Error | null = null
  private readonly fatalErrorListeners = new Set<(error: Error) => void>()

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
    this.lines.on('close', () =>
      this.rejectAll(new Error('Rust JSON-RPC input closed')),
    )
    streams.output.on('error', error => this.failTransport(error))
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
    this.writeMessage(message)
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
      this.writeMessage(message)
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

  /**
   * Register a listener for ALL server notifications, regardless of method.
   * The listener receives (method, params). Returns a disposer function.
   */
  onAnyNotification(
    listener: (method: string, params: unknown) => void,
  ): () => void {
    this.anyNotificationListeners.add(listener)
    return () => {
      this.anyNotificationListeners.delete(listener)
    }
  }

  /**
   * Register a handler for a server-initiated JSON-RPC request.
   * The handler receives (params, id) and must return the result.
   * Unhandled server requests get an automatic error response so the
   * server does not hang waiting for a reply.
   */
  onRequest(
    method: string,
    handler: (params: unknown, id: JsonRpcId) => Promise<unknown>,
  ): () => void {
    this.serverRequestHandlers.set(method, handler)
    return () => {
      if (this.serverRequestHandlers.get(method) === handler) {
        this.serverRequestHandlers.delete(method)
      }
    }
  }

  /**
   * Send a response to a server-initiated request (JSON-RPC response with
   * the request's id).
   */
  sendResponse(id: JsonRpcId, result: unknown): void {
    if (this.closed) return
    const message = {
      jsonrpc: '2.0',
      id,
      result,
    }
    this.writeMessage(message)
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

    // ── Server request (has both method and id) ───────────────────────
    if (typeof message.method === 'string' && typeof message.id === 'number') {
      desktopDebug('rust_raw_server_request', {
        method: message.method,
        paramKeys: isRecord(message.params)
          ? Object.keys(message.params)
          : undefined,
      })
      this.handleServerRequest(message.method, message.id, message.params)
      return
    }

    // ── Response to our outgoing request (has id, no method) ──────────
    if (typeof message.id === 'number') {
      this.handleResponse(message.id, message)
      return
    }

    // ── Notification (has method, no id) ──────────────────────────────
    if (typeof message.method === 'string') {
      desktopDebug('rust_raw_server_notification', {
        method: message.method,
        paramKeys: isRecord(message.params)
          ? Object.keys(message.params)
          : undefined,
      })

      // Method-specific listeners
      const listeners = this.notifications.get(message.method)
      if (listeners) {
        for (const listener of listeners) {
          listener(message.params)
        }
      }

      // Wildcard listeners
      for (const listener of this.anyNotificationListeners) {
        listener(message.method, message.params)
      }
    }
  }

  private async handleServerRequest(
    method: string,
    id: JsonRpcId,
    params: unknown,
  ): Promise<void> {
    const handler = this.serverRequestHandlers.get(method)
    if (!handler) {
      desktopDebug('rust_unhandled_server_request', { method })
      this.sendResponse(id, {
        isError: true,
        error: `Server request "${method}" is not supported by this client`,
      })
      return
    }
    try {
      const result = await handler(params, id)
      this.sendResponse(id, result)
    } catch (err) {
      desktopDebug('rust_server_request_handler_error', {
        method,
        message: err instanceof Error ? err.message : String(err),
      })
      this.sendResponse(id, {
        isError: true,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private handleResponse(
    id: JsonRpcId,
    message: Record<string, unknown>,
  ): void {
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

  onFatalError(listener: (error: Error) => void): () => void {
    this.fatalErrorListeners.add(listener)
    if (this.fatalError) listener(this.fatalError)
    return () => {
      this.fatalErrorListeners.delete(listener)
    }
  }

  private writeMessage(message: Record<string, unknown>): void {
    if (this.closed) return
    try {
      this.streams.output.write(`${JSON.stringify(message)}\n`, error => {
        if (error) this.failTransport(error)
      })
    } catch (error) {
      this.failTransport(toError(error))
    }
  }

  private failTransport(error: Error): void {
    if (this.fatalError) return
    this.fatalError = error
    this.rejectAll(error)
    for (const listener of this.fatalErrorListeners) {
      listener(error)
    }
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

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
