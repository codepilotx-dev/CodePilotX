import type { Schema } from "effect"
import type { ParamsOf, ResultOf } from "../definition"
import { CoreRpcMethods } from "./core"
import { ExtendedRpcMethods } from "./extended"

export const RpcMethods = {
  ...CoreRpcMethods,
  ...ExtendedRpcMethods,
} as const
export const RpcMethodMap = RpcMethods

export type RpcMethod = keyof typeof RpcMethods
export type RpcParams<M extends RpcMethod> = ParamsOf<(typeof RpcMethods)[M]>
export type RpcResult<M extends RpcMethod> = ResultOf<(typeof RpcMethods)[M]>
export type RpcErrors<M extends RpcMethod> = (typeof RpcMethods)[M]["errors"][number]
export type RpcParamsSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["params"] & Schema.Top
export type RpcResultSchema<M extends RpcMethod> = (typeof RpcMethods)[M]["result"] & Schema.Top

export { CoreRpcMethods } from "./core"
export { ExtendedRpcMethods } from "./extended"
