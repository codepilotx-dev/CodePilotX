import { Schema } from "effect"
import { defineMethod } from "../wire/definition"
import { CursorSchema, LimitSchema, OpaqueIDSchema, TimestampSchema } from "../wire/primitives"

const RuntimeContributionKindSchema = Schema.Literals(["tools", "prompt", "guard", "observer"])

export const RuntimeContributionSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.Int,
  displayName: Schema.String,
  description: Schema.String,
  provides: Schema.Array(RuntimeContributionKindSchema),
  enablement: Schema.Literals(["required", "conditional"]),
  /** 当前实际启用状态：required 恒启用，conditional 沿用各自现有配置。 */
  enabled: Schema.Boolean,
})

export const RequestSnapshotErrorCodeSchema = Schema.Literals([
  "SERIALIZE_FAILED",
  "SCRUB_FAILED",
  "STORAGE_FAILED",
])
export type RequestSnapshotErrorCode = typeof RequestSnapshotErrorCodeSchema.Type

export const RequestSnapshotSummarySchema = Schema.Struct({
  id: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  agentId: OpaqueIDSchema,
  requestOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  providerId: Schema.String,
  api: Schema.String,
  modelId: Schema.String,
  status: Schema.Literals(["captured", "missing"]),
  payloadBytes: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  payloadSha256: Schema.NullOr(Schema.String),
  errorCode: Schema.NullOr(RequestSnapshotErrorCodeSchema),
  createdAt: TimestampSchema,
})

export const RuntimeRpcMethods = {
  /** 只读列出 Agent 内置运行时贡献及其实际状态；不提供安装或任意启停接口。 */
  "runtime/contribution/list": defineMethod({
    params: Schema.Struct({}),
    result: Schema.Struct({
      contributions: Schema.Array(RuntimeContributionSchema),
    }),
    errors: [],
    capability: "runtime.contributions.v1",
    mutation: false,
  }),
  /** 分页列出任务下的请求快照摘要（不携带完整 payload）。 */
  "runtime/request-snapshot/list": defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(LimitSchema),
    }),
    result: Schema.Struct({
      items: Schema.Array(RequestSnapshotSummarySchema),
      nextCursor: Schema.optional(CursorSchema),
    }),
    errors: [],
    capability: "runtime.request-snapshots.v1",
    mutation: false,
  }),
  /** 完整 payload 的唯一出口；按 threadId 隔离，防止跨任务读取。 */
  "runtime/request-snapshot/read": defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      snapshotId: OpaqueIDSchema,
    }),
    result: Schema.Struct({
      snapshot: Schema.Struct({
        ...RequestSnapshotSummarySchema.fields,
        payloadJson: Schema.NullOr(Schema.String),
        runtimeManifest: Schema.String,
      }),
    }),
    errors: ["REQUEST_SNAPSHOT_NOT_FOUND"],
    capability: "runtime.request-snapshots.v1",
    mutation: false,
  }),
} as const

export type RuntimeRpcMethodMap = typeof RuntimeRpcMethods

export const RuntimeRequestSnapshotListParamsSchema = RuntimeRpcMethods["runtime/request-snapshot/list"].params
export const RuntimeRequestSnapshotReadParamsSchema = RuntimeRpcMethods["runtime/request-snapshot/read"].params
