import type { RpcMethod } from "@codepilotx/agent-protocol"
import { AgentError, stringParam } from "../RpcRouter"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import { optionalRpcRecord as optionalRecord } from "../decoders"
import type { RpcHandlerGroup } from "./types"

export const gitHandlers = {
  name: "git",
  methods: [
    "git/branch/create",
    "git/branch/checkout",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, _context: RpcRouterContext): Promise<unknown> {
    const params = optionalRecord(rawParams)
    const { git, review } = runtime.dependencies
    switch (method) {
      case "git/branch/create": {
        const projectId = stringParam(params, "projectId")
        const result = await git.createBranch({
          projectId,
          branchName: stringParam(params, "branchName"),
          ...(typeof params.startPoint === "string"
            ? { startPoint: params.startPoint }
            : {}),
        })
        return {
          ...result,
          status: await review.status(projectId),
        }
      }
      case "git/branch/checkout": {
        const projectId = stringParam(params, "projectId")
        const result = await git.checkoutBranch({
          projectId,
          branchName: stringParam(params, "branchName"),
        })
        return {
          ...result,
          status: await review.status(projectId),
        }
      }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
