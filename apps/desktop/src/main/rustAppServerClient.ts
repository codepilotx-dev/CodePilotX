import type { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import type {
  InitializeParams,
  InitializeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
} from './rustAppServerProtocol/index.js'

/**
 * Typed JSON-RPC client for the Rust app-server protocol.
 *
 * Wraps the raw line-delimited transport and exposes typed methods
 * for the subset of methods needed by the first text-only integration.
 */
export class RustAppServerClient {
  constructor(private readonly transport: RustLineJsonRpcClient) {}

  async initialize(params: InitializeParams): Promise<InitializeResponse> {
    return this.transport.sendRequest(
      'initialize',
      params,
    ) as Promise<InitializeResponse>
  }

  notifyInitialized(): void {
    this.transport.sendNotification('initialized')
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.transport.sendRequest(
      'thread/start',
      params,
    ) as Promise<ThreadStartResponse>
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.transport.sendRequest(
      'turn/start',
      params,
    ) as Promise<TurnStartResponse>
  }

  async interruptTurn(
    params: TurnInterruptParams,
  ): Promise<TurnInterruptResponse> {
    return this.transport.sendRequest(
      'turn/interrupt',
      params,
    ) as Promise<TurnInterruptResponse>
  }

  onServerNotification(
    listener: (method: string, params: unknown) => void,
  ): () => void {
    const disposers: Array<() => void> = []
    // Register a wildcard handler by subscribing to all known methods.
    // For this first version, handle the methods we care about explicitly.
    const methods = [
      'thread/started',
      'turn/started',
      'turn/completed',
      'item/delta',
      'item/completed',
      'error',
    ]
    for (const method of methods) {
      const dispose = this.transport.onNotification(method, params =>
        listener(method, params),
      )
      disposers.push(dispose)
    }
    return () => {
      for (const dispose of disposers) {
        dispose()
      }
    }
  }

  /** Register a listener for a specific notification method. */
  onNotification(
    method: string,
    listener: (params: unknown) => void,
  ): () => void {
    return this.transport.onNotification(method, listener)
  }

  close(): void {
    this.transport.close()
  }
}
