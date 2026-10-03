import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/definition'
import { JsonValueSchema, OpaqueIDSchema, OkResultSchema } from '../wire/primitives'

export const ComputerWindowSchema = Schema.Struct({
  ref: OpaqueIDSchema, appId: Schema.String, name: Schema.String,
  pid: Schema.Int, windowId: Schema.String, processKey: Schema.String,
})
export const ComputerPermissionSchema = Schema.Struct({
  appId: Schema.String,
  name: Schema.String,
  /** `session` is a chat-scoped grant that the user can still make permanent. */
  decision: Schema.Literals(['allow', 'deny', 'session']),
})
export const ComputerStateSchema = Schema.Struct({
  enabled: Schema.Boolean, available: Schema.Boolean,
  ownerThreadId: Schema.NullOr(Schema.String), ownerTurnId: Schema.NullOr(Schema.String),
  targetName: Schema.NullOr(Schema.String), busy: Schema.Boolean,
  permissions: Schema.Array(ComputerPermissionSchema),
})
export const ComputerActionSchema = Schema.Struct({
  action: Schema.Literals(['click', 'double_click', 'right_click', 'type_text', 'press_key', 'hotkey', 'scroll', 'drag']),
  elementToken: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number), y: Schema.optional(Schema.Number),
  endX: Schema.optional(Schema.Number), endY: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String), key: Schema.optional(Schema.String),
  keys: Schema.optional(Schema.Array(Schema.String)),
  direction: Schema.optional(Schema.Literals(['up', 'down', 'left', 'right'])),
  amount: Schema.optional(Schema.Number),
  delivery: Schema.Literals(['background', 'foreground']),
})
export const ComputerCommandSchema = Schema.Struct({
  requestId: OpaqueIDSchema, generation: OpaqueIDSchema,
  kind: Schema.Literals(['list', 'read', 'action']),
  session: Schema.String,
  window: Schema.optional(ComputerWindowSchema),
  operation: Schema.optional(ComputerActionSchema),
  captureId: Schema.optional(Schema.String),
})
export const ComputerResultSchema = Schema.Struct({
  text: Schema.String, isError: Schema.optional(Schema.Boolean),
  code: Schema.optional(Schema.String), data: Schema.optional(JsonValueSchema),
  images: Schema.optional(Schema.Array(Schema.Struct({ data: Schema.String, mimeType: Schema.String }))),
  windows: Schema.optional(Schema.Array(ComputerWindowSchema)),
  snapshotId: Schema.optional(Schema.String), captureId: Schema.optional(Schema.String),
  elementTokens: Schema.optional(Schema.Array(Schema.String)),
})
const errors = ['INVALID_REQUEST', 'PERMISSION_DENIED', 'CAPABILITY_REQUIRED', 'INTERNAL_ERROR'] as const
const method = <P extends Schema.Top, R extends Schema.Top>(
  params: P,
  result: R,
  host = false,
) =>
  defineMethod({
    params,
    result,
    errors,
    capability: host ? 'computer.host.v1' : 'computer.use.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  })
const emptyInput = Schema.Struct({}).check(
  Schema.makeFilter((value) => Object.keys(value).length === 0, { expected: 'an empty object' }),
)
export const ComputerRpcMethods = {
  'computer/state': method(emptyInput, ComputerStateSchema),
  'computer/apps': method(emptyInput, Schema.Struct({ apps: Schema.Array(Schema.Struct({ appId: Schema.String, name: Schema.String })) })),
  'computer/configure': method(Schema.Struct({ enabled: Schema.optional(Schema.Boolean), appId: Schema.optional(Schema.String), decision: Schema.optional(Schema.Literals(['allow', 'deny', 'remove'])) }), ComputerStateSchema),
  'computer/stop': method(emptyInput, OkResultSchema),
} as const satisfies MethodMap
export const ComputerHostRpcMethods = {
  'computer/host/register': method(Schema.Struct({ instanceId: OpaqueIDSchema, available: Schema.Boolean }), ComputerStateSchema, true),
  'computer/host/next': method(Schema.Struct({ instanceId: OpaqueIDSchema, generation: Schema.optional(OpaqueIDSchema) }), Schema.Struct({ command: Schema.NullOr(ComputerCommandSchema), enabled: Schema.Boolean, generation: OpaqueIDSchema }), true),
  'computer/host/complete': method(Schema.Struct({ instanceId: OpaqueIDSchema, requestId: OpaqueIDSchema, generation: OpaqueIDSchema, result: ComputerResultSchema }), OkResultSchema, true),
  'computer/host/release': method(Schema.Struct({ instanceId: OpaqueIDSchema }), OkResultSchema, true),
} as const satisfies MethodMap
export type ComputerHostRpcMethodMap = typeof ComputerHostRpcMethods
export type ComputerWindow = typeof ComputerWindowSchema.Type
export type ComputerState = typeof ComputerStateSchema.Type
export type ComputerAction = typeof ComputerActionSchema.Type
export type ComputerCommand = typeof ComputerCommandSchema.Type
export type ComputerResult = typeof ComputerResultSchema.Type
