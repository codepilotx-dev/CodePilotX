export * as Integration from "./integration"

import { Schema } from "effect"
import { Connection } from "./connection"
import { IntegrationID, IntegrationMethodID } from "./integration-id"
import { optional } from "./schema"

export const ID = IntegrationID
export type ID = typeof ID.Type

export const MethodID = IntegrationMethodID
export type MethodID = typeof MethodID.Type

export interface When extends Schema.Schema.Type<typeof When> {}
export const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
}).annotate({ identifier: "Integration.When" })

export interface TextPrompt extends Schema.Schema.Type<typeof TextPrompt> {}
export const TextPrompt = Schema.Struct({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: optional(Schema.String),
  when: optional(When),
}).annotate({ identifier: "Integration.TextPrompt" })

export interface SelectPrompt extends Schema.Schema.Type<typeof SelectPrompt> {}
export const SelectPrompt = Schema.Struct({
  type: Schema.Literal("select"),
  key: Schema.String,
  message: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.String,
      hint: optional(Schema.String),
    }),
  ),
  when: optional(When),
}).annotate({ identifier: "Integration.SelectPrompt" })

export const Prompt = Schema.Union([TextPrompt, SelectPrompt]).pipe(Schema.toTaggedUnion("type"))
export type Prompt = typeof Prompt.Type

export interface OAuthMethod extends Schema.Schema.Type<typeof OAuthMethod> {}
export const OAuthMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  prompts: optional(Schema.Array(Prompt)),
}).annotate({ identifier: "Integration.OAuthMethod" })

export interface KeyMethod extends Schema.Schema.Type<typeof KeyMethod> {}
export const KeyMethod = Schema.Struct({
  type: Schema.Literal("key"),
  label: optional(Schema.String),
}).annotate({ identifier: "Integration.KeyMethod" })

export interface EnvMethod extends Schema.Schema.Type<typeof EnvMethod> {}
export const EnvMethod = Schema.Struct({
  type: Schema.Literal("env"),
  names: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.EnvMethod" })

export const Method = Schema.Union([OAuthMethod, KeyMethod, EnvMethod])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Integration.Method" })
export type Method = typeof Method.Type

export const Inputs = Schema.Record(Schema.String, Schema.String).annotate({ identifier: "Integration.Inputs" })
export type Inputs = typeof Inputs.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  id: ID,
  name: Schema.String,
}).annotate({ identifier: "Integration.Ref" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  methods: Schema.Array(Method),
  connections: Schema.Array(Connection.Info),
}).annotate({ identifier: "Integration.Info" })

export const AttemptID = Schema.String.pipe(Schema.brand("Integration.AttemptID"))
export type AttemptID = typeof AttemptID.Type

const AttemptTime = Schema.Struct({
  created: Schema.Number,
  expires: Schema.Number,
})

export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}
export const Attempt = Schema.Struct({
  attemptID: AttemptID,
  url: Schema.String,
  instructions: Schema.String,
  mode: Schema.Literals(["auto", "code"]),
  time: AttemptTime,
}).annotate({ identifier: "Integration.Attempt" })

export const AttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("complete"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("expired"), time: AttemptTime }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Integration.AttemptStatus" })
export type AttemptStatus = typeof AttemptStatus.Type
