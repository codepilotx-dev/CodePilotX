import type { AgentNotification, AgentRpcResponse } from '@codepilotx/shared/thread'

export type AgentRpcClientEnvironment = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
}

export type AgentRpcSubscription = {
  threadId?: string
  after?: number
}

export function createAgentRpcClient(environment: AgentRpcClientEnvironment) {
  const fetcher = environment.fetch ?? fetch
  let nextId = 1

  async function call<T>(method: string, params?: unknown): Promise<T> {
    const id = nextId++
    const response = await fetcher('/rpc', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    if (!response.ok) throw new Error(await rpcHttpError(response))
    const payload = (await response.json()) as AgentRpcResponse
    if (payload.error) throw new Error(payload.error.message)
    return payload.result as T
  }

  async function notify(method: string, params?: unknown): Promise<void> {
    const response = await fetcher('/rpc', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    })
    if (!response.ok) throw new Error(await rpcHttpError(response))
  }

  function subscribe(
    options: AgentRpcSubscription,
    callback: (notification: AgentNotification) => void,
  ): () => void {
    const factory = environment.eventSourceFactory ?? defaultEventSourceFactory()
    if (!factory) return () => {}
    const query = new URLSearchParams()
    if (options.threadId) query.set('threadId', options.threadId)
    if (typeof options.after === 'number') query.set('after', String(options.after))
    const url = query.size ? `/rpc/events?${query}` : '/rpc/events'
    const source = factory(url)
    source.onmessage = message => {
      try {
        callback(JSON.parse(message.data) as AgentNotification)
      } catch {
        // Ignore malformed event payloads.
      }
    }
    source.onerror = () => {}
    return () => source.close()
  }

  return { call, notify, subscribe }
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
