import type { Model, Provider } from "@codepilotx/model-schema"
import type { Effect } from "effect"
import type { Registration } from "./registration"

export interface ProviderCatalogRecord {
  readonly provider: Provider.Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
}

export interface ProviderCatalog {
  readonly providers: ReadonlyMap<Provider.ID, ProviderCatalogRecord>
  readonly default?: Model.Ref
}

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] }

export interface ProviderCatalogDraft {
  readonly provider: {
    list(): readonly ProviderCatalogRecord[]
    get(providerID: Provider.ID): ProviderCatalogRecord | undefined
    update(providerID: Provider.ID, update: (provider: Mutable<Provider.Info>) => void): void
    remove(providerID: Provider.ID): void
  }
  readonly model: {
    get(providerID: Provider.ID, modelID: Model.ID): Model.Info | undefined
    update(providerID: Provider.ID, modelID: Model.ID, update: (model: Mutable<Model.Info>) => void): void
    remove(providerID: Provider.ID, modelID: Model.ID): void
    readonly default: {
      get(): Model.Ref | undefined
      set(model: Model.Ref): void
      clear(): void
    }
  }
}

export type ProviderCatalogTransform = (
  catalog: ProviderCatalogDraft,
) => Effect.Effect<void, unknown> | void

export interface ProviderCatalogHooks {
  readonly transform: (callback: ProviderCatalogTransform) => Effect.Effect<Registration>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function makeProviderCatalogDraft(input: ProviderCatalog): {
  readonly draft: ProviderCatalogDraft
  readonly finish: () => ProviderCatalog
} {
  const providers = new Map<
    Provider.ID,
    { provider: Mutable<Provider.Info>; models: Map<Model.ID, Mutable<Model.Info>> }
  >()
  for (const [providerID, record] of input.providers) {
    providers.set(providerID, {
      provider: clone(record.provider),
      models: new Map(Array.from(record.models, ([modelID, model]) => [modelID, clone(model)])),
    })
  }
  let defaultModel = input.default ? clone(input.default) : undefined

  const draft: ProviderCatalogDraft = {
    provider: {
      list: () => Array.from(providers.values()),
      get: (providerID) => providers.get(providerID),
      update(providerID, update) {
        const record = providers.get(providerID)
        if (record) update(record.provider)
      },
      remove: (providerID) => {
        providers.delete(providerID)
        if (defaultModel?.providerID === providerID) defaultModel = undefined
      },
    },
    model: {
      get: (providerID, modelID) => providers.get(providerID)?.models.get(modelID),
      update(providerID, modelID, update) {
        const model = providers.get(providerID)?.models.get(modelID)
        if (model) update(model)
      },
      remove(providerID, modelID) {
        providers.get(providerID)?.models.delete(modelID)
        if (defaultModel?.providerID === providerID && defaultModel.id === modelID) defaultModel = undefined
      },
      default: {
        get: () => defaultModel,
        set: (model) => {
          defaultModel = clone(model)
        },
        clear: () => {
          defaultModel = undefined
        },
      },
    },
  }

  return {
    draft,
    finish: () => ({
      providers: new Map(
        Array.from(providers, ([providerID, record]) => [
          providerID,
          { provider: record.provider, models: new Map(record.models) },
        ]),
      ),
      ...(defaultModel ? { default: defaultModel } : {}),
    }),
  }
}
