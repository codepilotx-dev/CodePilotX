import {
  createRpcClient,
  RpcRemoteError,
  type RpcClient,
  type RpcError,
  type InitializedNotification,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type RpcTransport,
} from '@codepilotx/agent-protocol'
import type { AgentNotification } from '@codepilotx/shared/thread'

export type AgentRpcClientEnvironment = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  handshake?: {
    initialize: RpcParams<'initialize'>
    initialized: InitializedNotification['params']
  }
}

export type AgentRpcSubscription = {
  threadId?: string
  after?: number
}

export class AgentRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = 'AgentRpcError'
    this.code = code
    this.data = data
  }

  get errorCode(): string | null {
    if (!this.data || typeof this.data !== 'object') return null
    const value = (this.data as { code?: unknown }).code
    return typeof value === 'string' ? value : null
  }

  get status(): number | null {
    if (this.data && typeof this.data === 'object') {
      const value = (this.data as { status?: unknown }).status
      if (typeof value === 'number') return value
    }
    return this.code >= 400 && this.code <= 599 ? this.code : null
  }

  get details(): unknown {
    if (!this.data || typeof this.data !== 'object') return undefined
    return (this.data as { details?: unknown }).details
  }
}

export function createAgentRpcClient(environment: AgentRpcClientEnvironment) {
  const fetcher = environment.fetch ?? fetch
  let connectionId: string | null = null
  let initializeParams: RpcParams<'initialize'> | null = null
  let initializedParams: InitializedNotification['params'] | null = null
  let initializeResult: RpcResult<'initialize'> | null = null
  let handshakePromise: Promise<RpcResult<'initialize'>> | null = null
  let recoveryPromise: Promise<void> | null = null

  const transport: RpcTransport = {
    async request(message) {
      const response = await fetcher('/rpc', {
        method: 'POST',
        credentials: 'include',
        headers: rpcHeaders(connectionId),
        body: JSON.stringify(message),
      })
      if (!response.ok) throw new Error(await rpcHttpError(response))
      return response.json()
    },
    async notify(message) {
      const response = await fetcher('/rpc', {
        method: 'POST',
        credentials: 'include',
        headers: rpcHeaders(connectionId),
        body: JSON.stringify(message),
      })
      if (!response.ok) throw new Error(await rpcHttpError(response))
      if (response.status !== 204) {
        const error = await rpcNotificationError(response)
        if (error) throw new RpcRemoteError(error)
      }
    },
  }
  const typedClient = createRpcClient(transport, { idPrefix: 'renderer' })

  async function call<M>(
    method: M extends RpcMethod
      ? M
      : M extends string
        ? never
        : RpcMethod,
    params?: M extends RpcMethod ? RpcParams<M> : unknown,
  ): Promise<M extends RpcMethod ? RpcResult<M> : M> {
    const methodName = method as RpcMethod
    const requestParams = (params ?? {}) as RpcParams<RpcMethod>
    if (methodName !== 'initialize' && environment.handshake) {
      await ensureInitialized()
    }
    const attemptedConnectionId = connectionId
    try {
      const result = await typedClient.call(methodName, requestParams as never)
      if (methodName === 'initialize') {
        initializeParams = requestParams as RpcParams<'initialize'>
        initializeResult = result as RpcResult<'initialize'>
      }
      return result as M extends RpcMethod ? RpcResult<M> : M
    } catch (error) {
      if (
        methodName !== 'initialize' &&
        isUninitializedConnectionError(error) &&
        (await recoverConnection(attemptedConnectionId))
      ) {
        try {
          return await typedClient.call(
            methodName,
            requestParams as never,
          ) as M extends RpcMethod ? RpcResult<M> : M
        } catch (retryError) {
          throw normalizeRpcError(retryError)
        }
      }
      throw normalizeRpcError(error)
    }
  }

  async function initialized(
    params: Parameters<RpcClient['initialized']>[0],
  ): Promise<void> {
    try {
      await typedClient.initialized(params)
      initializedParams = params
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  async function ensureInitialized(): Promise<RpcResult<'initialize'>> {
    if (initializeResult && initializedParams && connectionId) {
      return initializeResult
    }
    const handshake = environment.handshake
    if (!handshake) {
      throw new Error('Agent RPC client 未配置自动握手参数。')
    }
    handshakePromise ??= (async () => {
      initializeParams = handshake.initialize
      const result = await typedClient.call(
        'initialize',
        handshake.initialize,
      )
      connectionId = result.connectionId
      initializeResult = result
      await typedClient.initialized(handshake.initialized)
      initializedParams = handshake.initialized
      return result
    })().catch(error => {
      connectionId = null
      initializeResult = null
      initializedParams = null
      throw error
    }).finally(() => {
      handshakePromise = null
    })
    try {
      return await handshakePromise
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  async function recoverConnection(
    failedConnectionId: string | null,
  ): Promise<boolean> {
    if (!initializeParams || !initializedParams) return false
    if (
      connectionId !== null &&
      connectionId !== failedConnectionId
    ) {
      return true
    }
    recoveryPromise ??= (async () => {
      connectionId = null
      const initialized = await typedClient.call(
        'initialize',
        initializeParams!,
      )
      connectionId = initialized.connectionId
      initializeResult = initialized
      await typedClient.initialized(initializedParams!)
    })().finally(() => {
      recoveryPromise = null
    })
    try {
      await recoveryPromise
      return true
    } catch (error) {
      throw normalizeRpcError(error)
    }
  }

  function subscribe(
    options: AgentRpcSubscription,
    callback: (notification: AgentNotification) => void,
  ): () => void {
    const factory = environment.eventSourceFactory ?? defaultEventSourceFactory()
    if (!factory) return () => {}
    let disposed = false
    let source: EventSource | null = null
    let subscriptionId: string | null = null
    let ackTimer: ReturnType<typeof setTimeout> | null = null
    const positions = new Map<string, number>()

    const flushAck = async (force = false): Promise<void> => {
      if (!subscriptionId || positions.size === 0 || (disposed && !force)) return
      const acknowledged = [...positions].map(([streamId, sequence]) => ({
        streamId,
        sequence,
      }))
      positions.clear()
      await call('event/ack', {
        subscriptionId,
        positions: acknowledged,
      }).catch(() => undefined)
    }

    const scheduleAck = (): void => {
      if (ackTimer !== null) return
      ackTimer = setTimeout(() => {
        ackTimer = null
        void flushAck()
      }, 1_000)
    }

    void (async () => {
      let after = options.after
      if (after === undefined) {
        const probe = await call('event/subscribe', {
          streams: [{ streamId: 'global', after: 0 }],
        })
        after =
          probe.highWatermarks.find(item => item.streamId === 'global')
            ?.sequence ?? 0
        await call('event/unsubscribe', {
          subscriptionId: probe.subscriptionId,
        })
      }
      if (disposed) return
      const subscription = await call('event/subscribe', {
        streams: [{ streamId: options.threadId ?? 'global', after }],
      })
      subscriptionId = subscription.subscriptionId
      if (disposed) {
        await call('event/unsubscribe', {
          subscriptionId: subscription.subscriptionId,
        }).catch(() => undefined)
        return
      }
      source = factory(
        `/rpc/events?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}&connectionId=${encodeURIComponent(connectionId ?? '')}`,
      )
      source.onmessage = message => {
        try {
          const notification = JSON.parse(message.data) as Record<string, unknown>
          if (notification.method === 'event/next') {
            const params = asRecord(notification.params)
            const event = asRecord(params.event)
            const sequence =
              typeof event.sequence === 'number'
                ? event.sequence
                : typeof event.afterSequence === 'number'
                  ? event.afterSequence
                  : null
            if (sequence !== null) {
              positions.set(
                typeof event.streamId === 'string'
                  ? event.streamId
                  : options.threadId ?? 'global',
                sequence,
              )
              scheduleAck()
            }
            callback(eventEnvelopeToAgentNotification(event))
            return
          }
          if (notification.method === 'event/replayComplete') {
            const params = asRecord(notification.params)
            if (Array.isArray(params.positions)) {
              for (const position of params.positions) {
                const value = asRecord(position)
                if (
                  typeof value.streamId === 'string' &&
                  typeof value.sequence === 'number'
                ) {
                  positions.set(value.streamId, value.sequence)
                }
              }
              scheduleAck()
            }
            return
          }
          callback(notification as AgentNotification)
        } catch {
          // Ignore malformed event payloads.
        }
      }
      source.onerror = () => {}
    })().catch(() => undefined)

    return () => {
      disposed = true
      source?.close()
      if (ackTimer !== null) clearTimeout(ackTimer)
      void flushAck(true).finally(() => {
        if (subscriptionId) {
          void call('event/unsubscribe', { subscriptionId }).catch(
            () => undefined,
          )
        }
      })
    }
  }

  return {
    call,
    ensureInitialized,
    initialized,
    setConnectionId(value: string): void {
      connectionId = value
    },
    subscribe,
  }
}

function eventEnvelopeToAgentNotification(
  event: Record<string, unknown>,
): AgentNotification {
  const payload = asRecord(event.payload)
  const turn = asRecord(payload.turn)
  const error = asRecord(payload.error)
  const params = {
    ...payload,
    ...(typeof event.threadId === 'string'
      ? { threadId: event.threadId }
      : typeof turn.threadId === 'string'
        ? { threadId: turn.threadId }
        : {}),
    ...(typeof event.turnId === 'string' ? { turnId: event.turnId } : {}),
    ...(typeof turn.status === 'string' ? { status: turn.status } : {}),
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    occurredAt: event.occurredAt,
  }
  return {
    jsonrpc: '2.0',
    method: typeof event.type === 'string' ? event.type : 'unknown',
    params,
  } as AgentNotification
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function rpcHeaders(connectionId: string | null): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(connectionId ? { 'x-codepilotx-connection-id': connectionId } : {}),
  }
}

function normalizeRpcError(error: unknown): unknown {
  if (!(error instanceof RpcRemoteError)) return error
  return new AgentRpcError(
    error.rpcError.message,
    error.rpcError.code,
    error.rpcError.data,
  )
}

function isUninitializedConnectionError(error: unknown): boolean {
  if (!(error instanceof RpcRemoteError)) return false
  const data = error.rpcError.data
  return (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    (data as { code?: unknown }).code === 'UNAUTHORIZED'
  )
}

function defaultEventSourceFactory(): ((url: string) => EventSource) | null {
  if (typeof EventSource === 'undefined') return null
  return url => new EventSource(url, { withCredentials: true })
}

async function rpcHttpError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return `RPC 请求失败：${response.status}`
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message ?? text
  } catch {
    return text
  }
}

async function rpcNotificationError(
  response: Response,
): Promise<RpcError | null> {
  const payload = await response.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const value = error as {
    code?: unknown
    message?: unknown
    data?: unknown
  }
  if (typeof value.code !== 'number' || typeof value.message !== 'string') {
    return null
  }
  if (value.data === undefined) {
    return { code: value.code, message: value.message }
  }
  if (
    !value.data ||
    typeof value.data !== 'object' ||
    Array.isArray(value.data)
  ) {
    return null
  }
  const data = value.data as {
    code?: unknown
    retryable?: unknown
  }
  if (typeof data.code !== 'string' || typeof data.retryable !== 'boolean') {
    return null
  }
  return {
    code: value.code,
    message: value.message,
    data: value.data as NonNullable<RpcError['data']>,
  }
}
