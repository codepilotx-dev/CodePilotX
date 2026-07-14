import { Schema } from "effect"

export const ModelRefSchema = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
})
export type ModelRef = typeof ModelRefSchema.Type

export const ProviderKindSchema = Schema.Literals([
  "openai",
  "anthropic",
  "openai-compatible",
])
export type ProviderKind = typeof ProviderKindSchema.Type

export const ModelApiSchema = Schema.Literals([
  "openai-responses",
  "openai-chat-completions",
  "anthropic-messages",
])
export type ModelApi = typeof ModelApiSchema.Type

export const ModelCapabilitiesSchema = Schema.Struct({
  reasoning: Schema.Boolean,
  toolCall: Schema.Boolean,
  imageInput: Schema.Boolean,
})
export type ModelCapabilities = typeof ModelCapabilitiesSchema.Type

export const ModelLimitsSchema = Schema.Struct({
  context: Schema.Number,
  output: Schema.Number,
})
export type ModelLimits = typeof ModelLimitsSchema.Type

export const CatalogModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  api: ModelApiSchema,
  limits: ModelLimitsSchema,
  capabilities: ModelCapabilitiesSchema,
  defaultParameters: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown),
  ),
})
export type CatalogModel = typeof CatalogModelSchema.Type

export const CatalogProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: ProviderKindSchema,
  baseURL: Schema.optional(Schema.String),
  models: Schema.Array(CatalogModelSchema),
})
export type CatalogProvider = typeof CatalogProviderSchema.Type

export const ModelCatalogSchema = Schema.Struct({
  version: Schema.Number,
  generatedAt: Schema.String,
  providers: Schema.Array(CatalogProviderSchema),
})
export type ModelCatalog = typeof ModelCatalogSchema.Type

export const ProviderInfoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: ProviderKindSchema,
  configured: Schema.Boolean,
  baseURL: Schema.optional(Schema.String),
  models: Schema.Array(CatalogModelSchema),
})
export type ProviderInfo = typeof ProviderInfoSchema.Type

export const ResolvedModelSchema = Schema.Struct({
  ref: ModelRefSchema,
  name: Schema.String,
  providerName: Schema.String,
  api: ModelApiSchema,
  limits: ModelLimitsSchema,
  capabilities: ModelCapabilitiesSchema,
  baseURL: Schema.optional(Schema.String),
  parameters: Schema.Record(Schema.String, Schema.Unknown),
})
export type ResolvedModel = typeof ResolvedModelSchema.Type

export const ProviderSettingSchema = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  kind: ProviderKindSchema,
  baseURL: Schema.optional(Schema.String),
  headers: Schema.optional(
    Schema.Record(Schema.String, Schema.String),
  ),
  models: Schema.optional(Schema.Array(CatalogModelSchema)),
  modelOverrides: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown),
  ),
})
export type ProviderSetting = typeof ProviderSettingSchema.Type
