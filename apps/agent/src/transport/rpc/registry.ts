import {
  RpcMethods,
  defineRpcHandlers,
  type RpcHandlers,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { configHandlers } from "./handlers/config"
import { githubHandlers } from "./handlers/github"
import { interactionHandlers } from "./handlers/interaction"
import { memoryHandlers } from "./handlers/memory"
import { mcpHandlers } from "./handlers/mcp"
import { petHandlers } from "./handlers/pet"
import { releaseNotesHandlers } from "./handlers/release-notes"
import { permissionHandlers } from "./handlers/permission"
import { providerHandlers } from "./handlers/provider"
import { reviewHandlers } from "./handlers/review"
import { skillHandlers } from "./handlers/skills"
import { subagentHandlers } from "./handlers/subagent"
import { suggestionHandlers } from "./handlers/suggestions"
import { systemHandlers } from "./handlers/system"
import { threadHandlers } from "./handlers/thread"
import { toolingHandlers } from "./handlers/tooling"
import { usageHandlers } from "./handlers/usage"
import type { RpcHandlerGroup } from "./handlers/types"
import { workspaceHandlers } from "./handlers/workspace"
import type { RpcRouterContext } from "./request-context"

import type { RpcRouter } from "./RpcRouter"

type MapRpcError = (method: RpcMethod, cause: unknown) => Error

const groups: readonly RpcHandlerGroup[] = [
  configHandlers,
  systemHandlers,
  interactionHandlers,
  permissionHandlers,
  workspaceHandlers,
  reviewHandlers,
  mcpHandlers,
  skillHandlers,
  githubHandlers,
  threadHandlers,
  memoryHandlers,
  petHandlers,
  releaseNotesHandlers,
  subagentHandlers,
  suggestionHandlers,
  providerHandlers,
  toolingHandlers,
  usageHandlers,
]

const registeredMethods = groups.flatMap((group) => group.methods)
const groupByMethod = new Map(
  groups.flatMap((group) => group.methods.map((method) => [method, group] as const)),
)
const uniqueMethods = new Set(registeredMethods)
const declaredMethods = Object.keys(RpcMethods) as RpcMethod[]

if (uniqueMethods.size !== registeredMethods.length) {
  throw new Error("RPC handler registry contains duplicate methods")
}

const missingMethods = declaredMethods.filter((method) => !uniqueMethods.has(method))
const unknownMethods = registeredMethods.filter((method) => !(method in RpcMethods))

if (missingMethods.length > 0 || unknownMethods.length > 0) {
  throw new Error(
    `RPC handler registry mismatch (missing: ${missingMethods.join(", ") || "none"}; unknown: ${unknownMethods.join(", ") || "none"})`,
  )
}

export const createRpcHandlerRegistry = (
  runtime: RpcRouter,
  mapError: MapRpcError,
): RpcHandlers<RpcRouterContext> =>
  defineRpcHandlers(Object.fromEntries(
    registeredMethods.map((method) => [
      method,
      async (params: unknown, context: RpcRouterContext) => {
        try {
          return await groupByMethod.get(method)!.handle(runtime, method, params, context)
        } catch (cause) {
          throw mapError(method, cause)
        }
      },
    ]),
  ) as unknown as RpcHandlers<RpcRouterContext>)
