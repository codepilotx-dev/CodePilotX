import {
  RuntimeRequestSnapshotListParamsSchema,
  RuntimeRequestSnapshotReadParamsSchema,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { AgentError } from "../../../domain"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeList = Schema.decodeUnknownSync(RuntimeRequestSnapshotListParamsSchema)
const decodeRead = Schema.decodeUnknownSync(RuntimeRequestSnapshotReadParamsSchema)

export const runtimeHandlers = {
  name: "runtime",
  methods: [
    "runtime/contribution/list",
    "runtime/request-snapshot/list",
    "runtime/request-snapshot/read",
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    switch (method) {
      case "runtime/contribution/list":
        return {
          contributions: runtime.dependencies.runtimeContributions.list().map((contribution) => ({
            id: contribution.manifest.id,
            version: contribution.manifest.version,
            displayName: contribution.manifest.displayName,
            description: contribution.manifest.description,
            provides: contribution.manifest.provides,
            enablement: contribution.manifest.enablement,
            enabled: runtime.dependencies.runtimeContributions.enabled(contribution),
          })),
        }
      case "runtime/request-snapshot/list": {
        const { threadId, cursor, limit } = decodeList(rawParams)
        return runtime.dependencies.requestSnapshots.list(threadId, cursor, limit ?? 50)
      }
      case "runtime/request-snapshot/read": {
        const { threadId, snapshotId } = decodeRead(rawParams)
        const snapshot = runtime.dependencies.requestSnapshots.read(threadId, snapshotId)
        if (!snapshot) {
          throw new AgentError("REQUEST_SNAPSHOT_NOT_FOUND", "请求快照不存在", 404)
        }
        return { snapshot }
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
