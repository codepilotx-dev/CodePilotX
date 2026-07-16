import { Schema } from "effect"
import type { RpcMethod, RpcParams, RpcResult } from "./methods"
import { RpcMethods } from "./methods"
import {
  InitializedNotificationSchema,
  RpcResponseSchema,
  type InitializedNotification,
  type RpcRequest,
} from "./messages"
import type { JsonValue, RpcError, RpcID } from "./wire"

export interface RpcTransport {
  request(message: RpcRequest): Promise<unknown>
  notify(message: InitializedNotification): Promise<void>
}

export class RpcRemoteError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(rpcError.message)
    this.name = "RpcRemoteError"
  }
}

export type RpcClient = {
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>
  initialized(params: InitializedNotification["params"]): Promise<void>
}

export function createRpcClient(transport: RpcTransport, options: { idPrefix?: string } = {}): RpcClient {
  const idPrefix = options.idPrefix ?? "client"
  let ordinal = 0

  return {
    async call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
      const definition = RpcMethods[method]
      const encodedParams = Schema.encodeSync(
        definition.params,
        definition.exactParams ? { onExcessProperty: "error" } : undefined,
      )(params) as JsonValue
      const id: RpcID = `${idPrefix}:${++ordinal}`
      const raw = await transport.request({ jsonrpc: "2.0", id, method, params: encodedParams as never })
      const response = Schema.decodeUnknownSync(RpcResponseSchema)(raw)
      if (response.id !== id) throw new Error(`RPC response id mismatch: expected ${id}, received ${String(response.id)}`)
      if ("error" in response) throw new RpcRemoteError(response.error)
      return Schema.decodeUnknownSync(
        definition.result,
        definition.exactResult ? { onExcessProperty: "error" } : undefined,
      )(response.result) as RpcResult<M>
    },

    async initialized(params) {
      const notification = Schema.decodeUnknownSync(InitializedNotificationSchema)({
        jsonrpc: "2.0",
        method: "initialized",
        params,
      })
      await transport.notify(notification)
    },
  }
}
