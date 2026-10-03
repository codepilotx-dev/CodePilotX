import { Schema } from 'effect'
import { BrowserRpcMethods, BrowserHostRpcMethods } from '@codepilotx/agent-protocol'
import { AgentError } from '../../../domain'
import type { RpcHandlerGroup } from './types'
const methods = { ...BrowserRpcMethods, ...BrowserHostRpcMethods }
export const browserHandlers: RpcHandlerGroup = {
  name: 'browser',
  methods: Object.keys(methods) as Array<keyof typeof methods>,
  async handle(runtime, method, raw, context) {
    const browser = runtime.dependencies.browser
    if (!browser?.available()) throw new AgentError('CAPABILITY_REQUIRED', '浏览器服务不可用', 409)
    if (!(method in methods)) return
    const params = Schema.decodeUnknownSync(
      methods[method as keyof typeof methods].params as Schema.Decoder<any, never>,
    )(raw) as Record<string, any>
    if (method.startsWith('browser/host/')) {
      runtime.requireDesktopHost(context)
      if (method !== 'browser/host/register')
        browser.host(params.windowId, params.instanceId, context.connectionId)
    }
    switch (method) {
      case 'browser/list':
        return { tabs: browser.list(), permissions: browser.permissions() }
      case 'browser/create':
        return browser.create(params as never)
      case 'browser/close':
        await browser.close(params.tabId)
        return { ok: true }
      case 'browser/control':
        return browser.control(params.tabId, params.threadId)
      case 'browser/layout':
        return browser.layout(params.tabId, params.panel, params.order)
      case 'browser/permissions':
        return { permissions: await browser.setPermission(params.origin, params.decision) }
      case 'browser/host/restore':
        return browser.restore(params.windowId, params.instanceId, params.tabId, params.generation)
      case 'browser/host/register':
        return browser.register(params.windowId, params.instanceId, context.connectionId!)
      case 'browser/host/next':
        return browser.next(params.windowId, params.instanceId, context.connectionId!)
      case 'browser/host/complete':
        browser.complete(
          params.windowId,
          params.instanceId,
          params.requestId,
          params.generation,
          params.result,
          params.error,
        )
        return { ok: true }
      case 'browser/host/report':
        return browser.report(
          params.windowId,
          params.instanceId,
          params.tabId,
          params.generation,
          params.patch,
        )
      case 'browser/host/release':
        browser.release(params.windowId, params.instanceId)
        return { ok: true }
    }
  },
}
