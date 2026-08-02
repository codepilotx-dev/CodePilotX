import type { RpcMethod } from "@codepilotx/agent-protocol"
import { AgentError } from "../../../domain"
import { enumValue, stringParam, type RpcRouter } from "../RpcRouter"
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from "../decoders"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const operation = (params: Record<string, unknown>) => ({
  worktreeId: stringParam(params, "worktreeId"),
  operationId: stringParam(params, "operationId"),
})

export const worktreeHandlers = {
  name: "worktree",
  methods: [
    "worktree/create",
    "worktree/list",
    "worktree/read",
    "worktree/retry-setup",
    "worktree/continue-without-setup",
    "worktree/set-permanent",
    "worktree/delete",
    "worktree/restore",
    "worktree/operation/status",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, _context: RpcRouterContext) {
    const service = runtime.dependencies.worktrees
    const params = optionalRecord(rawParams)
    switch (method) {
      case "worktree/create": {
        const starting = record(params.startingState, "startingState")
        const type = enumValue(starting.type, ["branch", "working-tree"] as const, "startingState.type")
        const result = await service.create({
          projectId: stringParam(params, "projectId"),
          operationId: stringParam(params, "operationId"),
          startingState: type === "branch"
            ? { type, branchName: stringParam(starting, "branchName") }
            : { type },
        })
        await service.autoCleanup(result.worktree.projectId).catch(() => [])
        return result
      }
      case "worktree/list":
        return service.list(typeof params.projectId === "string" ? params.projectId : undefined)
      case "worktree/read":
        return service.read(stringParam(params, "worktreeId"))
      case "worktree/retry-setup":
        return service.retrySetup(operation(params))
      case "worktree/continue-without-setup":
        return service.continueWithoutSetup(operation(params))
      case "worktree/set-permanent": {
        if (typeof params.permanent !== "boolean") throw new AgentError("INVALID_REQUEST", "permanent 参数无效", 400)
        return service.setPermanent({ ...operation(params), permanent: params.permanent })
      }
      case "worktree/delete":
        return service.delete(operation(params))
      case "worktree/restore":
        return service.restore(operation(params))
      case "worktree/operation/status": {
        const cursor = params.afterOutputCursor
        if (cursor !== undefined && (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0)) {
          throw new AgentError("INVALID_REQUEST", "afterOutputCursor 参数无效", 400)
        }
        return service.operationStatus(stringParam(params, "operationId"), cursor as number | undefined)
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
