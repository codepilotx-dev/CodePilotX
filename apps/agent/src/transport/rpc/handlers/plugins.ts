import {
  PluginGetDetailsParamsSchema,
  PluginListParamsSchema,
  PluginSetEnabledParamsSchema,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { AgentError } from "../../../domain"
import { PluginManagementError } from "../../../plugin/PluginManagementService"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeList = Schema.decodeUnknownSync(PluginListParamsSchema)
const decodeGetDetails = Schema.decodeUnknownSync(PluginGetDetailsParamsSchema)
const decodeSetEnabled = Schema.decodeUnknownSync(PluginSetEnabledParamsSchema)

export const pluginHandlers = {
  name: "plugins",
  methods: ["plugin/list", "plugin/getDetails", "plugin/setEnabled"],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const plugins = runtime.dependencies.plugins
    if (!plugins) throw new AgentError("INTERNAL_ERROR", "插件管理服务未配置", 500)
    try {
      switch (method) {
        case "plugin/list":
          return plugins.list(decodeList(rawParams))
        case "plugin/getDetails":
          return plugins.getDetails(decodeGetDetails(rawParams))
        case "plugin/setEnabled": {
          const result = await plugins.setEnabled(decodeSetEnabled(rawParams))
          if (result.changed) {
            await runtime.emit("plugins/updated", {
              generation: result.result.generation,
            })
          }
          return result.result
        }
        default:
          return undefined
      }
    } catch (cause) {
      if (cause instanceof PluginManagementError) {
        throw new AgentError(cause.code, cause.message, cause.status)
      }
      throw cause
    }
  },
} as const satisfies RpcHandlerGroup
