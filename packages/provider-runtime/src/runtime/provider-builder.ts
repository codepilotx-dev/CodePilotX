import type { Model, Provider } from "@codepilotx/model-schema"
import { Integration, Model as ModelSchema, Provider as ProviderSchema } from "@codepilotx/model-schema"
import { mapModelsDevCost } from "../catalog"
import { assertSafeHeaders } from "../security"
import { modelVariants } from "../variants"
import type { ProviderConfig } from "../types"
import { clone, merge, type Mutable, type MutableRecord } from "./internal"

function emptyConfiguredModel(providerID: Provider.ID, modelID: Model.ID, provider: Provider.Info): Mutable<Model.Info> {
  const model = ModelSchema.Info.empty(providerID, modelID) as Mutable<Model.Info>
  const providerApi = provider.api
  model.api = providerApi.type === "aisdk"
    ? { id: modelID, type: "aisdk", package: providerApi.package, ...(providerApi.url ? { url: providerApi.url } : {}) }
    : { id: modelID, type: "native", settings: { ...providerApi.settings }, ...(providerApi.url ? { url: providerApi.url } : {}) }
  model.capabilities = { tools: true, input: ["text"], output: ["text"] }
  return model
}

function applyModelConfig(record: MutableRecord, configuredID: string, config: NonNullable<ProviderConfig["models"]>[string]) {
  assertSafeHeaders(config.headers, `config model ${record.provider.id}/${configuredID}`)
  const modelID = ModelSchema.ID.make(configuredID)
  const lookupID = ModelSchema.ID.make(config.id ?? configuredID)
  const existing = record.models.get(lookupID) ?? record.models.get(modelID)
  const model = existing ? clone(existing) as Mutable<Model.Info> : emptyConfiguredModel(record.provider.id, modelID, record.provider)
  model.id = modelID
  model.providerID = record.provider.id
  model.name = config.name ?? model.name ?? configuredID
  if (config.family !== undefined) model.family = ModelSchema.Family.make(config.family)
  if (config.enabled !== undefined) model.enabled = config.enabled
  if (config.status !== undefined) model.status = config.status
  if (config.provider?.npm || config.provider?.api) {
    const currentPackage = model.api.type === "aisdk" ? model.api.package : "@ai-sdk/openai-compatible"
    const currentURL = model.api.url
    model.api = {
      id: ModelSchema.ID.make(config.id ?? model.api.id),
      type: "aisdk",
      package: config.provider.npm ?? currentPackage,
      ...(config.provider.api ?? currentURL ? { url: config.provider.api ?? currentURL } : {}),
    }
  } else if (config.id) {
    model.api.id = ModelSchema.ID.make(config.id)
  }
  model.request = {
    headers: { ...model.request.headers, ...(config.headers ?? {}) },
    body: merge(model.request.body, config.options ?? {}),
    ...(model.request.variant ? { variant: model.request.variant } : {}),
  }
  model.limit = {
    context: Math.trunc(config.limit?.context ?? model.limit.context),
    ...(config.limit?.input ?? model.limit.input ? { input: Math.trunc(config.limit?.input ?? model.limit.input ?? 0) } : {}),
    output: Math.trunc(config.limit?.output ?? model.limit.output),
  }
  if (config.cost) model.cost = mapModelsDevCost(config.cost)
  if (config.release_date !== undefined) {
    const released = Date.parse(config.release_date)
    model.time = { released: Number.isFinite(released) ? released : 0 }
  }
  if (config.reasoning !== undefined || config.tool_call !== undefined || config.modalities) {
    const input = [...(config.modalities?.input ?? model.capabilities.input)]
    if (config.attachment === true && !input.includes("image")) input.push("image")
    if (config.attachment === false && !config.modalities) input.splice(0, input.length, ...input.filter((item) => item !== "image"))
    model.capabilities = {
      tools: config.tool_call ?? model.capabilities.tools,
      input,
      output: [...(config.modalities?.output ?? model.capabilities.output)],
    }
  }
  const generated = config.reasoning === undefined
    ? []
    : Object.entries(modelVariants({
        id: String(model.id),
        providerID: String(model.providerID),
        api: { id: String(model.api.id), npm: model.api.type === "aisdk" ? model.api.package : "" },
        reasoning: config.reasoning,
        releaseDate: config.release_date ?? new Date(model.time.released).toISOString().slice(0, 10),
        outputLimit: model.limit.output,
      })).map(([id, body]) => ({ id: ModelSchema.VariantID.make(id), headers: {}, body }))
  const variants = new Map((config.reasoning === false ? [] : [...model.variants, ...generated]).map((item) => [String(item.id), item]))
  for (const [id, value] of Object.entries(config.variants ?? {})) {
    assertSafeHeaders(value.headers, `config variant ${record.provider.id}/${configuredID}/${id}`)
    if (value.disabled) {
      variants.delete(id)
      continue
    }
    const current = variants.get(id)
    const explicit = "body" in value || "headers" in value
    const body = explicit ? value.body ?? {} : Object.fromEntries(Object.entries(value).filter(([key]) => key !== "disabled"))
    variants.set(id, {
      id: ModelSchema.VariantID.make(id),
      headers: { ...(current?.headers ?? {}), ...(value.headers ?? {}) },
      body: merge(current?.body ?? {}, body),
    })
  }
  model.variants = [...variants.values()]
  record.models.delete(lookupID)
  record.models.set(modelID, model)
}

export function applyProviderConfig(providers: Map<Provider.ID, MutableRecord>, id: string, config: ProviderConfig) {
  assertSafeHeaders(config.headers, `config provider ${id}`)
  const providerID = ProviderSchema.ID.make(id)
  let record = providers.get(providerID)
  if (!record) {
    const provider = ProviderSchema.Info.empty(providerID) as Mutable<Provider.Info>
    provider.integrationID = Integration.ID.make(id)
    provider.name = config.name ?? id
    provider.api = {
      type: "aisdk",
      package: config.npm ?? "@ai-sdk/openai-compatible",
      ...(config.api ? { url: config.api } : {}),
      ...(config.options ? { settings: { ...config.options } } : {}),
    }
    record = { provider, models: new Map() }
    providers.set(providerID, record)
  }
  record.provider.name = config.name ?? record.provider.name
  const currentApi = record.provider.api
  const currentSettings = currentApi.settings ?? {}
  record.provider.api = {
    type: "aisdk",
    package: config.npm ?? (currentApi.type === "aisdk" ? currentApi.package : "@ai-sdk/openai-compatible"),
    ...(config.api ?? currentApi.url ? { url: config.api ?? currentApi.url } : {}),
    settings: merge(currentSettings, config.options ?? {}),
  }
  record.provider.request = {
    headers: { ...record.provider.request.headers, ...(config.headers ?? {}) },
    body: merge(record.provider.request.body, config.body ?? {}),
  }
  for (const [modelID, model] of Object.entries(config.models ?? {})) applyModelConfig(record, modelID, model)
}
