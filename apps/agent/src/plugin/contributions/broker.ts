/**
 * Host broker：处理 runner 发来的 host/* clientRequest。
 *
 * - host/kvGet/kvPut/kvDelete：按 plugin id + scope 隔离读写（SQL 在 PluginRepository）。
 * - host/serviceCall：按 service graph 转发到 provider 插件的 runner。
 * - host/credentialUse：只返回 brokered reference，绝不跨 wire 传明文 secret。
 * - host/log/host/progress/host/viewInvalidate 是通知（supervisor 已分发）。
 */

import { PluginRepository } from "../../storage/repositories/plugin-repository"
import type { PluginRuntimeManager, BrokerHandler } from "../runtime/manager"

export const createPluginBroker = (options: {
  pluginId: string
  repo: PluginRepository
  manager: PluginRuntimeManager
}): BrokerHandler => {
  const { pluginId, repo, manager } = options
  return (method, rawParams, respond) => {
    const params = (rawParams ?? {}) as Record<string, unknown>
    switch (method) {
      case "host/kvGet": {
        const key = params.key
        const scope = params.scope === "workspace" ? "workspace" : "global"
        const workspaceKey = typeof params.workspaceKey === "string" ? params.workspaceKey : ""
        if (typeof key !== "string" || key.length === 0 || key.length > 512) {
          respond(undefined, { code: "INVALID_REQUEST", message: "kvGet 参数非法", retryable: false })
          return
        }
        const entry = repo.kvGet(pluginId, scope, workspaceKey, key)
        if (!entry) {
          respond(null)
          return
        }
        try {
          respond(JSON.parse(entry.value))
        } catch {
          respond(null)
        }
        return
      }
      case "host/kvPut": {
        const key = params.key
        const scope = params.scope === "workspace" ? "workspace" : "global"
        const workspaceKey = typeof params.workspaceKey === "string" ? params.workspaceKey : ""
        if (typeof key !== "string" || key.length === 0 || key.length > 512) {
          respond(undefined, { code: "INVALID_REQUEST", message: "kvPut 参数非法", retryable: false })
          return
        }
        const value = params.value
        const result = repo.kvPut(pluginId, scope, workspaceKey, key, JSON.stringify(value ?? null))
        respond({ ok: result.ok, version: result.version })
        return
      }
      case "host/kvDelete": {
        const key = params.key
        const scope = params.scope === "workspace" ? "workspace" : "global"
        const workspaceKey = typeof params.workspaceKey === "string" ? params.workspaceKey : ""
        if (typeof key !== "string" || key.length === 0) {
          respond(undefined, { code: "INVALID_REQUEST", message: "kvDelete 参数非法", retryable: false })
          return
        }
        respond({ ok: repo.kvDelete(pluginId, scope, workspaceKey, key) })
        return
      }
      case "host/serviceCall": {
        const service = params.service
        const serviceMethod = params.method
        if (typeof service !== "string" || typeof serviceMethod !== "string") {
          respond(undefined, { code: "INVALID_REQUEST", message: "serviceCall 参数非法", retryable: false })
          return
        }
        const provider = manager.serviceProvider(service)
        if (!provider) {
          respond(undefined, { code: "SERVICE_UNAVAILABLE", message: `服务 ${service} 当前不可用`, retryable: true })
          return
        }
        const timeoutMs = typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? Math.min(Math.max(Math.floor(params.timeoutMs), 100), 60_000)
          : 30_000
        void manager.call(provider, "plugin/serviceCall", {
          service,
          method: serviceMethod,
          params: params.params ?? {},
        }, { timeoutMs })
          .then((result) => respond(result))
          .catch((cause) => {
            const error = cause instanceof Error ? cause.message : "service 调用失败"
            respond(undefined, { code: "PLUGIN_INSTALL_FAILED", message: error, retryable: true })
          })
        return
      }
      case "host/credentialUse": {
        const slot = params.slot
        const purpose = params.purpose
        if (typeof slot !== "string" || slot.length === 0) {
          respond(undefined, { code: "INVALID_REQUEST", message: "credentialUse 参数非法", retryable: false })
          return
        }
        void purpose
        // credential slot 值由 Settings 控件保存（plugin_kv）；这里只返回引用，
        // 明文 secret 绝不跨 wire。
        const entry = repo.kvGet(pluginId, "global", "", `credential:${slot}`)
        if (!entry) {
          respond({ granted: false })
          return
        }
        respond({ granted: true, reference: `plugin:${pluginId}:${slot}` })
        return
      }
      default:
        respond(undefined, { code: "UNKNOWN_METHOD", message: `未知 Host 方法：${method}`, retryable: false })
    }
  }
}
