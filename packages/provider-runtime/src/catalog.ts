import { Integration, Model, Provider } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import { ProviderRuntimeError } from "./error"
import { assertSafeHeaders } from "./security"
import type { ModelsDev } from "./types"
import { modelVariants } from "./variants"

export interface CatalogMetadata {
  readonly env: ReadonlyMap<string, readonly string[]>
}

type Mutable<Value> = Value extends string | number | boolean | bigint | symbol | null | undefined
  ? Value
  : Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value

const camelCase = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
const finite = (value: number | undefined) => Number.isFinite(value) ? value ?? 0 : 0

export function mapModelsDevCost(cost: ModelsDev.Cost | undefined): Model.Cost[] {
  if (!cost) return []
  const base: Model.Cost = {
    input: finite(cost.input),
    output: finite(cost.output),
    cache: { read: finite(cost.cache_read), write: finite(cost.cache_write) },
  }
  const result: Model.Cost[] = [base]
  for (const item of cost.tiers ?? []) {
    result.push({
      tier: { type: "context", size: item.tier.size },
      input: finite(item.input),
      output: finite(item.output),
      cache: { read: finite(item.cache_read), write: finite(item.cache_write) },
    })
  }
  if (cost.context_over_200k) {
    result.push({
      tier: { type: "context", size: 200_000 },
      input: finite(cost.context_over_200k.input),
      output: finite(cost.context_over_200k.output),
      cache: { read: finite(cost.context_over_200k.cache_read), write: finite(cost.context_over_200k.cache_write) },
    })
  }
  return result
}

function mapModel(provider: ModelsDev.Provider, raw: ModelsDev.Model, id = raw.id): Mutable<Model.Info> {
  const providerID = Provider.ID.make(provider.id)
  const modelID = Model.ID.make(id)
  const catalogPackage = raw.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"
  const npm = provider.id === "cloudflare-ai-gateway" && catalogPackage === "ai-gateway-provider"
    ? "@ai-sdk/openai-compatible"
    : catalogPackage
  const url = raw.provider?.api ?? provider.api
  const generated = modelVariants({
    id,
    providerID: provider.id,
    api: { id: raw.id, npm },
    reasoning: raw.reasoning ?? false,
    releaseDate: raw.release_date ?? "",
    outputLimit: raw.limit.output,
  })
  return {
    id: modelID,
    providerID,
    ...(raw.family ? { family: Model.Family.make(raw.family) } : {}),
    name: raw.name,
    api: { id: Model.ID.make(raw.id), type: "aisdk", package: npm, ...(url ? { url } : {}) },
    capabilities: {
      tools: raw.tool_call ?? true,
      input: [...(raw.modalities?.input ?? [])],
      output: [...(raw.modalities?.output ?? [])],
    },
    request: { headers: {}, body: {} },
    variants: Object.entries(generated).map(([variantID, body]) => ({
      id: Model.VariantID.make(variantID),
      headers: {},
      body,
    })),
    time: { released: Number.isFinite(Date.parse(raw.release_date)) ? Date.parse(raw.release_date) : 0 },
    cost: mapModelsDevCost(raw.cost),
    status: raw.status ?? "active",
    enabled: true,
    limit: {
      context: Math.trunc(finite(raw.limit.context)),
      ...(raw.limit.input === undefined ? {} : { input: Math.trunc(finite(raw.limit.input)) }),
      output: Math.trunc(finite(raw.limit.output)),
    },
  } as Mutable<Model.Info>
}

export function mapModelsDev(input: ModelsDev.Catalog): { catalog: ProviderCatalog; metadata: CatalogMetadata } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProviderRuntimeError("CATALOG_INVALID", "models.dev catalog must be an object")
  }
  const providers = new Map<Provider.ID, { provider: Provider.Info; models: Map<Model.ID, Model.Info> }>()
  const env = new Map<string, readonly string[]>()

  for (const [catalogID, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== "object" || !raw.models || typeof raw.models !== "object") continue
    const id = raw.id || catalogID
    const providerID = Provider.ID.make(id)
    const apiURL = raw.api
    const provider: Provider.Info = {
      id: providerID,
      integrationID: Integration.ID.make(id),
      name: raw.name || id,
      api: {
        type: "aisdk",
        package: raw.npm ?? "@ai-sdk/openai-compatible",
        ...(apiURL ? { url: apiURL } : {}),
      },
      request: { headers: {}, body: {} },
    }
    const models = new Map<Model.ID, Model.Info>()
    for (const [catalogModelID, rawModel] of Object.entries(raw.models)) {
      const base = mapModel({ ...raw, id }, { ...rawModel, id: rawModel.id || catalogModelID })
      models.set(base.id, base)
      for (const [mode, value] of Object.entries(rawModel.experimental?.modes ?? {})) {
        const modeID = `${base.id}-${mode}`
        const model = mapModel({ ...raw, id }, rawModel, modeID)
        model.name = `${rawModel.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
        if (value.cost) model.cost = mapModelsDevCost(value.cost)
        if (value.provider?.body) model.request.body = Object.fromEntries(Object.entries(value.provider.body).map(([key, item]) => [camelCase(key), item]))
        if (value.provider?.headers) {
          assertSafeHeaders(value.provider.headers, `models.dev ${id}/${mode}`)
          model.request.headers = { ...value.provider.headers }
        }
        models.set(model.id, model)
      }
    }
    providers.set(providerID, { provider, models })
    env.set(id, [...(raw.env ?? [])])
  }
  return { catalog: { providers }, metadata: { env } }
}
