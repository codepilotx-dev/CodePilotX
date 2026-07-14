import type { Credential, Model, Provider } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import type { LanguageModelV3 } from "@ai-sdk/provider"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export namespace ModelsDev {
  export type Status = "alpha" | "beta" | "deprecated"
  export type Modality = "text" | "audio" | "image" | "video" | "pdf"

  export interface Cost {
    readonly input: number
    readonly output: number
    readonly cache_read?: number
    readonly cache_write?: number
    readonly tiers?: readonly (Cost & { readonly tier: { readonly type: "context"; readonly size: number } })[]
    readonly context_over_200k?: Omit<Cost, "tiers" | "context_over_200k">
  }

  export interface Model {
    readonly id: string
    readonly name: string
    readonly family?: string
    readonly release_date: string
    readonly attachment: boolean
    readonly reasoning: boolean
    readonly temperature: boolean
    readonly tool_call: boolean
    readonly interleaved?: boolean | { readonly field: "reasoning" | "reasoning_content" | "reasoning_details" }
    readonly cost?: Cost
    readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
    readonly modalities?: { readonly input: readonly Modality[]; readonly output: readonly Modality[] }
    readonly experimental?: {
      readonly modes?: Readonly<Record<string, {
        readonly cost?: Cost
        readonly provider?: {
          readonly body?: Readonly<Record<string, JsonValue>>
          readonly headers?: Readonly<Record<string, string>>
        }
      }>>
    }
    readonly status?: Status
    readonly provider?: { readonly npm?: string; readonly api?: string }
  }

  export interface Provider {
    readonly api?: string
    readonly name: string
    readonly env: readonly string[]
    readonly id: string
    readonly npm?: string
    readonly models: Readonly<Record<string, Model>>
  }

  export type Catalog = Readonly<Record<string, Provider>>
}

export interface VariantConfig {
  readonly disabled?: boolean
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, JsonValue>>
}

export interface ModelConfig extends Partial<Omit<ModelsDev.Model, "id" | "name" | "limit" | "experimental">> {
  readonly id?: string
  readonly name?: string
  readonly enabled?: boolean
  readonly headers?: Readonly<Record<string, string>>
  readonly options?: Readonly<Record<string, JsonValue>>
  readonly limit?: Partial<ModelsDev.Model["limit"]>
  readonly variants?: Readonly<Record<string, VariantConfig & Readonly<Record<string, unknown>>>>
}

export interface ProviderConfig {
  readonly name?: string
  readonly disabled?: boolean
  readonly api?: string
  readonly npm?: string
  readonly env?: readonly string[]
  readonly options?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
  readonly whitelist?: readonly string[]
  readonly blacklist?: readonly string[]
  readonly models?: Readonly<Record<string, ModelConfig>>
}

export interface RuntimeConfig {
  readonly providers?: Readonly<Record<string, ProviderConfig>>
  readonly enabledProviders?: readonly string[]
  readonly disabledProviders?: readonly string[]
  readonly enableExperimentalModels?: boolean
  readonly default?: Model.Ref
}

export type Awaitable<Value> = Value | PromiseLike<Value>
export type ValueSource<Value> = Value | (() => Awaitable<Value>)
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface CredentialSource {
  readonly get: (providerID: Provider.ID) => Awaitable<Credential.Value | string | undefined>
}

export interface ProviderRuntimeExtension {
  readonly transformCatalog?: (catalog: ProviderCatalog) => Awaitable<ProviderCatalog>
  readonly providerOptions?: (
    provider: Provider.Info,
    credential: Credential.Value | string | undefined,
  ) => Awaitable<Readonly<Record<string, unknown>> | undefined>
  readonly getLanguage?: (input: {
    readonly provider: Provider.Info
    readonly model: Model.Info
    readonly options: Readonly<Record<string, unknown>>
  }) => Awaitable<LanguageModelV3 | undefined>
}

export interface CustomProviderContext {
  readonly provider: Provider.Info
  readonly model?: Model.Info
  readonly env: Readonly<Record<string, string | undefined>>
  readonly credential: Credential.Value | string | undefined
  readonly options: Readonly<Record<string, unknown>>
}

export interface CustomProviderLoader {
  readonly options?: (context: CustomProviderContext) => Awaitable<Readonly<Record<string, unknown>> | undefined>
  readonly getLanguage?: (context: CustomProviderContext) => Awaitable<LanguageModelV3 | undefined>
}

export interface ProviderRuntimeOptions {
  readonly cachePath: string
  readonly snapshot?: ValueSource<ModelsDev.Catalog | undefined>
  readonly source?: string
  readonly freshnessMs?: number
  readonly fetchTimeoutMs?: number
  readonly fetch?: Fetch
  readonly refreshIntervalMs?: number | false
  readonly config?: ValueSource<RuntimeConfig>
  readonly env?: ValueSource<Readonly<Record<string, string | undefined>>>
  readonly credentials?: CredentialSource | Readonly<Record<string, Credential.Value | string | undefined>>
  readonly pluginHost?: {
    readonly init: () => unknown
    readonly transformProviderCatalog: (catalog: ProviderCatalog) => unknown
    readonly dispose?: () => unknown
  }
  readonly extensions?: readonly ProviderRuntimeExtension[]
  readonly customLoaders?: Readonly<Record<string, CustomProviderLoader>>
  readonly providerLoaders?: Readonly<Record<string, ProviderLoader>>
}

export interface BundledSDK {
  readonly languageModel: (modelID: string) => LanguageModelV3
  readonly chat?: (modelID: string) => LanguageModelV3
  readonly responses?: (modelID: string) => LanguageModelV3
  readonly messages?: (modelID: string) => LanguageModelV3
}

export type ProviderFactory = (options: any) => BundledSDK
export type ProviderLoader = () => Promise<ProviderFactory>
