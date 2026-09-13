import type { Schema } from "effect"
import type { ParamsOf, ResultOf } from "../wire/definition"
import { AutomationRpcMethods } from "./automation"
import { BaseRpcMethods } from "./base"
import { CalendarRpcMethods } from "./calendar"
import { PlanApprovalRpcMethods } from "./plan-approval"
import { HandoffRpcMethods } from "./handoff"
import { ThreadGoalRpcMethods } from "./goal"
import { LocalEnvironmentRpcMethods } from "./local-environment"
import { ThreadForkRpcMethods } from "./thread-fork"
import { SideChatRpcMethods } from "./side-chat"
import { WorktreeRpcMethods } from "./worktree"
import { SessionGroupRpcMethods } from "./session-group"
import { WorkflowRpcMethods } from "./workflow"
import type { TerminalRpcMethodMap } from "./terminal"
import type { LocalEnvironmentHostRpcMethodMap } from "./local-environment"

export const RpcMethods = {
  ...AutomationRpcMethods,
  ...BaseRpcMethods,
  ...CalendarRpcMethods,
  ...PlanApprovalRpcMethods,
  ...HandoffRpcMethods,
  ...ThreadGoalRpcMethods,
  ...LocalEnvironmentRpcMethods,
  ...ThreadForkRpcMethods,
  ...SideChatRpcMethods,
  ...WorktreeRpcMethods,
  ...SessionGroupRpcMethods,
  ...WorkflowRpcMethods,
} as const
export { BaseRpcMethods } from "./base"
export const RpcMethodMap = RpcMethods

export type PublicRpcMethod = keyof typeof RpcMethods
export type RpcMethod = PublicRpcMethod | keyof TerminalRpcMethodMap | keyof LocalEnvironmentHostRpcMethodMap
type RpcDefinition<M extends RpcMethod> = M extends PublicRpcMethod
  ? (typeof RpcMethods)[M]
  : M extends keyof TerminalRpcMethodMap
    ? TerminalRpcMethodMap[M]
    : M extends keyof LocalEnvironmentHostRpcMethodMap
      ? LocalEnvironmentHostRpcMethodMap[M]
      : never
export type RpcParams<M extends RpcMethod> = ParamsOf<RpcDefinition<M>>
export type RpcResult<M extends RpcMethod> = ResultOf<RpcDefinition<M>>
export type RpcErrors<M extends RpcMethod> = RpcDefinition<M>["errors"][number]
export type RpcParamsSchema<M extends RpcMethod> = RpcDefinition<M>["params"] & Schema.Top
export type RpcResultSchema<M extends RpcMethod> = RpcDefinition<M>["result"] & Schema.Top
export type PublicRpcParams<M extends PublicRpcMethod> = ParamsOf<(typeof RpcMethods)[M]>
export type PublicRpcResult<M extends PublicRpcMethod> = ResultOf<(typeof RpcMethods)[M]>

export * from "./core"
export * from "./automation"
export * from "./calendar"
export * from "./plan-approval"
export * from "./config"
export * from "./extended"
export * from "./git"
export * from "./github"
export * from "./goal"
export * from "./handoff"
export * from "./mcp"
export * from "./minimax-cli"
export * from "./local-environment"
export * from "./pet"
export * from "./plugins"
export * from "./release-notes"
export * from "./review"
export * from "./skills"
export * from "./speech"
export * from "./suggestions"
export * from "./tooling"
export * from "./thread-fork"
export * from "./side-chat"
export * from "./usage"
export * from "./worktree"
export * from "./session-group"
export * from "./workflow"
