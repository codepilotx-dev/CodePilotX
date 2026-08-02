import type { RpcMethod } from "@codepilotx/agent-protocol"
import {
  LocalEnvironmentActionListParamsSchema,
  LocalEnvironmentReadParamsSchema,
  LocalEnvironmentUpdateParamsSchema,
  TerminalHostActionResolveParamsSchema,
  TerminalHostEnvironmentParamsSchema,
} from "@codepilotx/agent-protocol/local-environment"
import { Schema } from "effect"
import type { ConfigValue } from "../../../config/ConfigService"
import type { RpcRouter } from "../RpcRouter"
import { decodeRpcParams } from "../decoders"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeRead = Schema.decodeUnknownSync(LocalEnvironmentReadParamsSchema)
const decodeUpdate = Schema.decodeUnknownSync(LocalEnvironmentUpdateParamsSchema)
const decodeActions = Schema.decodeUnknownSync(LocalEnvironmentActionListParamsSchema)
const decodeHostEnvironment = Schema.decodeUnknownSync(TerminalHostEnvironmentParamsSchema)
const decodeHostAction = Schema.decodeUnknownSync(TerminalHostActionResolveParamsSchema)

export const localEnvironmentHandlers = {
  name: "local-environment",
  methods: [
    "local-environment/read",
    "local-environment/update",
    "local-environment/action/list",
    "terminal/host/environment",
    "terminal/host/action/resolve",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext) {
    const service = runtime.dependencies.localEnvironment
    switch (method) {
      case "local-environment/read":
        return service.readForThread(decodeRpcParams(decodeRead, rawParams, method).threadId)
      case "local-environment/update": {
        const params = decodeRpcParams(decodeUpdate, rawParams, method)
        return service.updateForThread({
          threadId: params.threadId,
          expectedRevision: params.expectedRevision,
          ...(params.edits ? {
            edits: params.edits.map((edit) => ({
              keyPath: [...edit.keyPath],
              value: JSON.parse(JSON.stringify(edit.value)) as ConfigValue,
            })),
          } : {}),
          ...(params.trust ? { trust: params.trust } : {}),
        })
      }
      case "local-environment/action/list":
        return service.actionListForThread(decodeRpcParams(decodeActions, rawParams, method).threadId)
      case "terminal/host/environment": {
        runtime.requireDesktopHost(context)
        return service.hostEnvironment(decodeRpcParams(decodeHostEnvironment, rawParams, method).threadId)
      }
      case "terminal/host/action/resolve": {
        runtime.requireDesktopHost(context)
        const params = decodeRpcParams(decodeHostAction, rawParams, method)
        return service.hostResolveAction(params.threadId, params.actionName)
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
