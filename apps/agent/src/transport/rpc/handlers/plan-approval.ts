import { PlanApprovalRpcMethods, type RpcMethod } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcHandlerGroup } from "./types"

export const planApprovalHandlers = {
  name: "plan-approval",
  methods: ["planApproval/read", "planApproval/respond"],
  async handle(runtime: RpcRouter, method: RpcMethod, raw: unknown) {
    switch (method) {
      case "planApproval/read": {
        const params = Schema.decodeUnknownSync(PlanApprovalRpcMethods[method].params)(raw)
        return { approval: runtime.planApprovals.read(params.threadId) }
      }
      case "planApproval/respond":
        return runtime.planApprovals.respond(Schema.decodeUnknownSync(PlanApprovalRpcMethods[method].params)(raw))
    }
  },
} as const satisfies RpcHandlerGroup
