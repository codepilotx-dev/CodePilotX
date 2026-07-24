export * as Provider from "./provider"

import { Schema } from "effect"
import { Integration } from "./integration"
import { optional, statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Provider.ID"),
  statics((schema) => ({
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

export interface AISDK extends Schema.Schema.Type<typeof AISDK> {}
export const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: optional(Schema.String),
  settings: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Provider.AISDK" })

export interface Native extends Schema.Schema.Type<typeof Native> {}
export const Native = Schema.Struct({
  type: Schema.Literal("native"),
  url: optional(Schema.String),
  settings: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Provider.Native" })

export const Api = Schema.Union([AISDK, Native])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Provider.Api" })
export type Api = typeof Api.Type

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Provider.Request" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: optional(Integration.ID),
  name: Schema.String,
  disabled: optional(Schema.Boolean),
  api: Api,
  request: Request,
})
  .annotate({ identifier: "Provider.Info" })
  .pipe(
    statics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: id,
          api: { type: "native", settings: {} },
          request: { headers: {}, body: {} },
        }),
    })),
  )
