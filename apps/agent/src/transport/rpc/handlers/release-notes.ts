import {
  ReleaseNotesListParamsSchema,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeList = Schema.decodeUnknownSync(ReleaseNotesListParamsSchema)

export const releaseNotesHandlers = {
  name: "release-notes",
  methods: ["release-notes/list"],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    switch (method) {
      case "release-notes/list": {
        const { currentVersion, refresh } = decodeList(rawParams)
        return runtime.dependencies.releaseNotes.list(
          currentVersion,
          refresh ?? false,
        )
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
