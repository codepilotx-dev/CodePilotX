import type { Schema } from "effect"
import type { ParamsOf, ResultOf } from "../wire/definition"
import { CoreRpcMethods } from "./core"
import { ExtendedRpcMethods } from "./extended"
import { GithubRpcMethods } from "./github"
import { PetRpcMethods } from "./pet"
import { ReviewRpcMethods } from "./review"
import { ToolingRpcMethods } from "./tooling"

export const RpcMethods = {
  ...CoreRpcMethods,
  ...ExtendedRpcMethods,
  ...GithubRpcMethods,
  ...PetRpcMethods,
  ...ReviewRpcMethods,
  ...ToolingRpcMethods,
} as const
export const RpcMethodMap = RpcMethods

export type RpcMethod = keyof typeof RpcMethods
export type RpcParams<M extends RpcMethod> = ParamsOf<(typeof RpcMethods)[M]>
export type RpcResult<M extends RpcMethod> = ResultOf<(typeof RpcMethods)[M]>
export type RpcErrors<M extends RpcMethod> = (typeof RpcMethods)[M]["errors"][number]
export type RpcParamsSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["params"] & Schema.Top
export type RpcResultSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["result"] & Schema.Top

export * from "./core"
export * from "./extended"
export * from "./github"
export * from "./pet"
export * from "./review"
export * from "./tooling"
