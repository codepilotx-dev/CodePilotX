import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/definition'
import { JsonValueSchema, OpaqueIDSchema, OkResultSchema } from '../wire/primitives'

const Url = Schema.String.check(Schema.isMaxLength(8192))
const NullableID = Schema.NullOr(OpaqueIDSchema)
export const BrowserPermissionSchema = Schema.Struct({
  origin: Url,
  decision: Schema.Literals(['allow', 'deny']),
  updatedAt: Schema.String,
})
export const BrowserTabSchema = Schema.Struct({
  tabId: OpaqueIDSchema,
  windowId: OpaqueIDSchema,
  sourceThreadId: NullableID,
  controlThreadId: NullableID,
  url: Url,
  title: Schema.String,
  state: Schema.Literals(['parked', 'live', 'suspended', 'crashed']),
  loading: Schema.Boolean,
  busy: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  generation: OpaqueIDSchema,
  documentId: OpaqueIDSchema,
  history: Schema.optional(
    Schema.Array(Schema.Struct({ url: Url, title: Schema.String })).check(Schema.isMaxLength(500)),
  ),
  historyIndex: Schema.optional(Schema.Int),
  viewport: Schema.Struct({ width: Schema.Int, height: Schema.Int }),
  panel: Schema.Literals(['right', 'bottom']),
  order: Schema.Number,
  lastUsedAt: Schema.Number,
  revision: Schema.Int,
})
export type BrowserTab = typeof BrowserTabSchema.Type
export type BrowserPermission = typeof BrowserPermissionSchema.Type
export const BrowserTargetSchema = Schema.Struct({
  selector: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  ref: Schema.optional(Schema.String),
  documentId: Schema.optional(OpaqueIDSchema),
  frameId: Schema.optional(OpaqueIDSchema),
})
export const BrowserOperationSchema = Schema.Struct({
  action: Schema.Literals([
    'navigate',
    'back',
    'forward',
    'reload',
    'stop',
    'snapshot',
    'screenshot',
    'click',
    'hover',
    'fill',
    'select',
    'check',
    'key',
    'scroll',
    'dialog',
    'viewport',
  ]),
  url: Schema.optional(Url),
  target: Schema.optional(BrowserTargetSchema),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(32000))),
  key: Schema.optional(Schema.String),
  checked: Schema.optional(Schema.Boolean),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  width: Schema.optional(Schema.Int),
  height: Schema.optional(Schema.Int),
  accept: Schema.optional(Schema.Boolean),
})
export type BrowserOperation = typeof BrowserOperationSchema.Type
export const BrowserCommandSchema = Schema.Struct({
  requestId: OpaqueIDSchema,
  tabId: OpaqueIDSchema,
  generation: OpaqueIDSchema,
  operation: BrowserOperationSchema,
  allowedOrigins: Schema.Array(Schema.String),
})
export type BrowserCommand = typeof BrowserCommandSchema.Type
export const BrowserResultSchema = Schema.Struct({
  text: Schema.String,
  image: Schema.optional(
    Schema.Struct({
      mimeType: Schema.Literal('image/png'),
      data: Schema.String.check(Schema.isMaxLength(12_000_000)),
    }),
  ),
})
export type BrowserResult = typeof BrowserResultSchema.Type
const errors = [
  'INVALID_REQUEST',
  'PERMISSION_DENIED',
  'CAPABILITY_REQUIRED',
  'INTERNAL_ERROR',
] as const
const tabInput = Schema.Struct({ tabId: OpaqueIDSchema })
const method = <P extends Schema.Top, R extends Schema.Top>(
  params: P,
  result: R,
  mutation = true,
  host = false,
) =>
  defineMethod({
    params,
    result,
    errors,
    capability: host ? 'browser.host.v1' : 'browser.manage.v1',
    mutation,
    exactParams: true,
    exactResult: true,
  })
export const BrowserRpcMethods = {
  'browser/list': method(
    Schema.Struct({}).check(
      Schema.makeFilter((value) => Object.keys(value).length === 0, {
        expected: 'an empty object',
      }),
    ),
    Schema.Struct({
      tabs: Schema.Array(BrowserTabSchema),
      permissions: Schema.Array(BrowserPermissionSchema),
    }),
    false,
  ),
  'browser/create': method(
    Schema.Struct({
      tabId: OpaqueIDSchema,
      windowId: OpaqueIDSchema,
      sourceThreadId: NullableID,
      url: Url,
    }),
    BrowserTabSchema,
  ),
  'browser/close': method(tabInput, OkResultSchema),
  'browser/control': method(
    Schema.Struct({ tabId: OpaqueIDSchema, threadId: NullableID }),
    BrowserTabSchema,
  ),
  'browser/layout': method(
    Schema.Struct({
      tabId: OpaqueIDSchema,
      panel: Schema.Literals(['right', 'bottom']),
      order: Schema.Number,
    }),
    BrowserTabSchema,
  ),
  'browser/permissions': method(
    Schema.Struct({
      origin: Schema.optional(Url),
      decision: Schema.optional(Schema.Literals(['allow', 'deny', 'remove', 'clear'])),
    }),
    Schema.Struct({ permissions: Schema.Array(BrowserPermissionSchema) }),
  ),
} as const satisfies MethodMap
export const BrowserHostRpcMethods = {
  'browser/host/restore': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      tabId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
    }),
    BrowserTabSchema,
    true,
    true,
  ),
  'browser/host/register': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    Schema.Struct({ tabs: Schema.Array(BrowserTabSchema) }),
    true,
    true,
  ),
  'browser/host/next': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    Schema.Struct({
      command: Schema.NullOr(BrowserCommandSchema),
      tabs: Schema.Array(BrowserTabSchema),
      permissions: Schema.Array(BrowserPermissionSchema),
    }),
    false,
    true,
  ),
  'browser/host/complete': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      requestId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
      result: Schema.optional(BrowserResultSchema),
      error: Schema.optional(Schema.String),
    }),
    OkResultSchema,
    true,
    true,
  ),
  'browser/host/report': method(
    Schema.Struct({
      windowId: OpaqueIDSchema,
      instanceId: OpaqueIDSchema,
      tabId: OpaqueIDSchema,
      generation: OpaqueIDSchema,
      patch: JsonValueSchema,
    }),
    BrowserTabSchema,
    true,
    true,
  ),
  'browser/host/release': method(
    Schema.Struct({ windowId: OpaqueIDSchema, instanceId: OpaqueIDSchema }),
    OkResultSchema,
    true,
    true,
  ),
} as const satisfies MethodMap
export type BrowserHostRpcMethodMap = typeof BrowserHostRpcMethods
