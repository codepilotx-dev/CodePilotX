export * as Provider from "./provider"

import { Schema } from "effect"
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

export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Source = Schema.Struct({
  type: Schema.Literal("pi"),
  kind: Schema.Literals(["builtin", "custom"]),
  apis: Schema.Array(Schema.String),
  baseUrl: optional(Schema.String),
}).annotate({ identifier: "Provider.Source" })

export interface Auth extends Schema.Schema.Type<typeof Auth> {}
export const Auth = Schema.Struct({
  apiKey: Schema.Boolean,
  oauth: Schema.Boolean,
}).annotate({ identifier: "Provider.Auth" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  disabled: optional(Schema.Boolean),
  source: Source,
  auth: Auth,
})
  .annotate({ identifier: "Provider.Info" })
  .pipe(
    statics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: id,
          source: { type: "pi", kind: "builtin", apis: [] },
          auth: { apiKey: false, oauth: false },
        }),
    })),
  )
