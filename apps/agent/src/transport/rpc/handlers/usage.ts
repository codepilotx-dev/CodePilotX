import {
  RpcMethods,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeLocal = Schema.decodeUnknownSync(RpcMethods["usage/local/get"].params)
const decodeProvider = Schema.decodeUnknownSync(RpcMethods["usage/provider/query"].params)
const decodeConnect = Schema.decodeUnknownSync(RpcMethods["usage/credential/connect"].params)
const decodeDisconnect = Schema.decodeUnknownSync(RpcMethods["usage/credential/disconnect"].params)

export const usageHandlers = {
  name: "usage",
  methods: [
    "usage/local/get",
    "usage/provider/query",
    "usage/credential/connect",
    "usage/credential/disconnect",
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    switch (method) {
      case "usage/local/get": {
        const params = decodeLocal(rawParams)
        return runtime.dependencies.usage.localUsage(params.range, params.timeZone)
      }
      case "usage/provider/query": {
        const params = decodeProvider(rawParams)
        return runtime.dependencies.usage.providerUsage({
          range: params.range,
          timeZone: params.timeZone,
          ...(params.providerIds === undefined ? {} : { providerIds: params.providerIds.map(String) }),
          ...(params.force === undefined ? {} : { force: params.force }),
        })
      }
      case "usage/credential/connect":
        return runtime.dependencies.usage.connect(decodeConnect(rawParams))
      case "usage/credential/disconnect":
        return runtime.dependencies.usage.disconnect(decodeDisconnect(rawParams))
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
