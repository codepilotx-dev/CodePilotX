import type { RpcMethod } from "@codepilotx/agent-protocol"
import type { RpcRouter } from "../RpcRouter"
import { optionalRpcRecord as optionalRecord } from "../decoders"
import {
  AgentError,
} from "../RpcRouter"
import type { RpcHandlerGroup } from "./types"

export const interactionHandlers = {
  name: "interaction",
  methods: [
    "interaction/listPending",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const params = optionalRecord(rawParams)
    switch (method) {
      case "interaction/listPending":
        return runtime.listPendingInteractions(params)
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
