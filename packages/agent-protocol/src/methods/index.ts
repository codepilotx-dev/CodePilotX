import type { Schema } from "effect"
import type { ParamsOf, ResultOf } from "../wire/definition"
import { CoreRpcMethods } from "./core"
import { ConfigRpcMethods } from "./config"
import { ExtendedRpcMethods } from "./extended"
import { GithubRpcMethods } from "./github"
import { McpRpcMethods } from "./mcp"
import { PetRpcMethods } from "./pet"
import { ReleaseNotesRpcMethods } from "./release-notes"
import { ReviewRpcMethods } from "./review"
import { SkillRpcMethods } from "./skills"
import { SuggestionRpcMethods } from "./suggestions"
import { ToolingRpcMethods } from "./tooling"
import { UsageRpcMethods } from "./usage"

export const RpcMethods = {
  ...CoreRpcMethods,
  ...ConfigRpcMethods,
  ...ExtendedRpcMethods,
  ...GithubRpcMethods,
  ...McpRpcMethods,
  ...PetRpcMethods,
  ...ReleaseNotesRpcMethods,
  ...ReviewRpcMethods,
  ...SkillRpcMethods,
  ...SuggestionRpcMethods,
  ...ToolingRpcMethods,
  ...UsageRpcMethods,
} as const
export const RpcMethodMap = RpcMethods

export type RpcMethod = keyof typeof RpcMethods
export type RpcParams<M extends RpcMethod> = ParamsOf<(typeof RpcMethods)[M]>
export type RpcResult<M extends RpcMethod> = ResultOf<(typeof RpcMethods)[M]>
export type RpcErrors<M extends RpcMethod> = (typeof RpcMethods)[M]["errors"][number]
export type RpcParamsSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["params"] & Schema.Top
export type RpcResultSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["result"] & Schema.Top

export * from "./core"
export * from "./config"
export * from "./extended"
export * from "./github"
export * from "./mcp"
export * from "./pet"
export * from "./release-notes"
export * from "./review"
export * from "./skills"
export * from "./suggestions"
export * from "./tooling"
export * from "./usage"
