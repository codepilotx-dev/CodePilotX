import { Schema } from 'effect'
import {
  BrowserRpcMethods,
  BrowserHostRpcMethods,
  type RpcParams,
  type RpcResult,
} from '@codepilotx/agent-protocol'
import type { SidecarSupervisor } from '../sidecar/supervisor.js'
const methods = { ...BrowserRpcMethods, ...BrowserHostRpcMethods }
type Method = keyof typeof methods
export class BrowserHostRpcClient {
  private connectionId?: string
  private initialization?: Promise<void>
  private sequence = 0
  constructor(private readonly getSupervisor: () => SidecarSupervisor | undefined) {}
  invalidate() {
    this.connectionId = undefined
  }
  async call<M extends Method>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const supervisor = this.getSupervisor()
    if (!supervisor) throw new Error('Agent 尚未连接')
    if (!this.connectionId) {
      this.initialization ??= this.initialize(supervisor).finally(() => {
        this.initialization = undefined
      })
      await this.initialization
    }
    const payload = await this.request(supervisor, method, params)
    if (payload.error) {
      if (payload.error.data?.code === 'UNAUTHORIZED') this.invalidate()
      throw new Error(payload.error.message ?? 'Agent 拒绝浏览器请求')
    }
    return Schema.decodeUnknownSync(methods[method].result as Schema.Decoder<any, never>)(
      payload.result,
    ) as RpcResult<M>
  }
  private async request(supervisor: SidecarSupervisor, method: string, params: unknown) {
    const response = await supervisor.request('/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.connectionId ? { 'X-CodePilotX-Connection-ID': this.connectionId } : {}),
      },
      signal: AbortSignal.timeout(method === 'browser/host/next' ? 25_000 : 35_000),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `desktop-browser:${++this.sequence}`,
        method,
        params,
      }),
    })
    return (await response.json()) as {
      result?: unknown
      error?: { message?: string; data?: { code?: string } }
    }
  }
  private async initialize(supervisor: SidecarSupervisor) {
    const payload = await this.request(supervisor, 'initialize', {
      clientInfo: {
        name: 'codepilotx-desktop-browser-host',
        version: '1.0.0',
        platform: process.platform,
        authority: 'desktop-host',
      },
      protocols: ['thread-rpc-v4'],
      capabilities: ['rpc.typed.v1', 'browser.host.v1', 'browser.manage.v1'],
      interactionDelivery: 'observe',
    })
    if (
      payload.error ||
      !(payload.result as { capabilities?: string[] })?.capabilities?.includes('browser.host.v1')
    )
      throw new Error('Agent 未提供浏览器能力')
    this.connectionId = (payload.result as { connectionId: string }).connectionId
    await this.request(supervisor, 'initialized', { protocol: 'thread-rpc-v4' })
  }
}
