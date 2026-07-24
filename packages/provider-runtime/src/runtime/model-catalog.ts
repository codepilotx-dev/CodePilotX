import type { Model, Provider } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import { ProviderRuntimeError } from "../error"
import { clone, merge, type Mutable, type MutableRecord } from "./internal"

export function cloneCatalog(catalog: ProviderCatalog): Map<Provider.ID, MutableRecord> {
  return new Map(Array.from(catalog.providers, ([id, record]) => [id, {
    provider: clone(record.provider) as Mutable<Provider.Info>,
    models: new Map(Array.from(record.models, ([modelID, model]) => [modelID, clone(model) as Mutable<Model.Info>])),
  }]))
}

export function asCatalog(providers: Map<Provider.ID, MutableRecord>, defaultModel?: Model.Ref): ProviderCatalog {
  return {
    providers: new Map(Array.from(providers, ([id, record]) => [id, { provider: record.provider, models: record.models }])),
    ...(defaultModel ? { default: clone(defaultModel) } : {}),
  }
}

export function applyVariant(model: Model.Info, variantID: string): Model.Info {
  const variant = model.variants.find((item) => item.id === variantID)
  if (!variant) {
    throw new ProviderRuntimeError("VARIANT_NOT_FOUND", `Variant ${model.providerID}/${model.id}/${variantID} was not found`)
  }
  const resolved = clone(model) as Mutable<Model.Info>
  resolved.request = {
    headers: { ...resolved.request.headers, ...variant.headers },
    body: merge(resolved.request.body, variant.body),
    variant: variant.id,
  }
  return resolved
}
