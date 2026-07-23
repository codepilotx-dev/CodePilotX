import { credentialKey, credentialPool } from "./credential-resolution"
import { createFailoverLanguage } from "./failover"
import { clone, isObject, merge, runEffectOrPromise, sourceValue, stableStringify, type RuntimeState } from "./internal"
import { applyVariant, asCatalog, cloneCatalog } from "./model-catalog"
import { applyProviderConfig } from "./provider-builder"
import type { Credential, Model, Provider } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import type {
  LanguageModelV3,
} from "@ai-sdk/provider"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { BUNDLED_PROVIDERS, selectLanguageModel } from "../bundled"
import { mapModelsDev } from "../catalog"
import { builtinCustomOptions } from "../custom"
import { ProviderRuntimeError } from "../error"
import { assertSafeHeaders } from "../security"
import type {
  ModelsDev,
  ProviderLoader,
  BundledSDK,
  CredentialCandidate,
  ProviderRuntimeOptions,
} from "../types"

const DEFAULT_SOURCE = "https://models.dev/api.json"
const DEFAULT_FRESHNESS = 5 * 60 * 1_000
const DEFAULT_TIMEOUT = 10_000



function validateCatalogHeaders(catalog: ProviderCatalog, source: string) {
  for (const [providerID, record] of catalog.providers) {
    assertSafeHeaders(record.provider.request.headers, `${source} provider ${providerID}`)
    for (const [modelID, model] of record.models) {
      assertSafeHeaders(model.request.headers, `${source} model ${providerID}/${modelID}`)
      for (const variant of model.variants) assertSafeHeaders(variant.headers, `${source} variant ${providerID}/${modelID}/${variant.id}`)
    }
  }
}

function validateOptionsHeaders(options: Readonly<Record<string, unknown>>, source: string) {
  if (options.headers === undefined) return
  if (!isObject(options.headers)) {
    throw new ProviderRuntimeError("CATALOG_INVALID", `${source} headers must be a string record`)
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.headers)) {
    if (typeof value !== "string") throw new ProviderRuntimeError("CATALOG_INVALID", `${source} header ${name} must be a string`)
    headers[name] = value
  }
  assertSafeHeaders(headers, source)
}











export class ProviderRuntime {
  private state: RuntimeState | undefined
  private loading: Promise<RuntimeState> | undefined
  private refreshing: Promise<void> | undefined
  private catalogSource: ModelsDev.Catalog | undefined
  private pluginInitialized = false
  private disposed = false
  private refreshTimer: ReturnType<typeof setInterval> | undefined
  private readonly sdks = new Map<string, BundledSDK>()
  private readonly languages = new Map<string, LanguageModelV3>()

  constructor(private readonly input: ProviderRuntimeOptions) {}

  async list(): Promise<readonly Provider.Info[]> {
    const state = await this.ensure()
    return Array.from(state.catalog.providers.values(), (record) => clone(record.provider))
  }

  async models(providerID?: Provider.ID): Promise<readonly Model.Info[]> {
    const state = await this.ensure()
    if (providerID) {
      const record = state.catalog.providers.get(providerID)
      if (!record) throw new ProviderRuntimeError("PROVIDER_NOT_FOUND", `Provider ${providerID} was not found`)
      return Array.from(record.models.values(), clone)
    }
    return Array.from(state.catalog.providers.values()).flatMap((record) => Array.from(record.models.values(), clone))
  }

  async resolve(ref: Model.Ref): Promise<Model.Info> {
    const state = await this.ensure()
    const provider = state.catalog.providers.get(ref.providerID)
    if (!provider) throw new ProviderRuntimeError("PROVIDER_NOT_FOUND", `Provider ${ref.providerID} was not found`)
    const model = provider.models.get(ref.id)
    if (!model) throw new ProviderRuntimeError("MODEL_NOT_FOUND", `Model ${ref.providerID}/${ref.id} was not found`)
    if (!model.enabled) throw new ProviderRuntimeError("MODEL_NOT_FOUND", `Model ${ref.providerID}/${ref.id} is disabled`)
    return ref.variant ? applyVariant(model, ref.variant) : clone(model)
  }

  async getLanguage(ref: Model.Ref): Promise<LanguageModelV3> {
    const model = await this.resolve(ref)
    const pool = credentialPool(this.input.credentials)
    if (pool) {
      const languageKey = stableStringify({
        providerID: model.providerID,
        package: model.api.type === "aisdk" ? model.api.package : undefined,
        modelID: model.api.id,
        variant: model.request.variant,
        body: model.request.body,
        headers: model.request.headers,
        credentialPool: true,
      })
      const cached = this.languages.get(languageKey)
      if (cached) return cached
      const language = createFailoverLanguage({ model, pool, createLanguage: (resolved, candidate) => this.createLanguage(resolved, candidate) })
      this.languages.set(languageKey, language)
      return language
    }
    return this.createLanguage(model)
  }

  /** Builds a model for one exact stored credential without consulting or updating the candidate pool. */
  async getLanguageForCredential(ref: Model.Ref, candidate: CredentialCandidate): Promise<LanguageModelV3> {
    const model = await this.resolve(ref)
    return this.createLanguage(model, candidate)
  }

  private async createLanguage(model: Model.Info, candidate?: CredentialCandidate): Promise<LanguageModelV3> {
    if (model.api.type !== "aisdk") {
      throw new ProviderRuntimeError("PROVIDER_NOT_BUNDLED", `Model ${model.providerID}/${model.id} does not use an AI SDK provider`)
    }
    const state = await this.ensure()
    const record = state.catalog.providers.get(model.providerID)
    if (!record) throw new ProviderRuntimeError("PROVIDER_NOT_FOUND", `Provider ${model.providerID} was not found`)
    const configurationError = state.configurationErrors.get(model.providerID)
    if (configurationError) throw new ProviderRuntimeError("PROVIDER_NOT_CONFIGURED", configurationError)
    const credential = candidate?.value ?? state.credentials.get(String(model.providerID))
    let baseOptions: Readonly<Record<string, unknown>> = state.options.get(model.providerID) ?? {}
    if (candidate) {
      const { apiKey: _activeApiKey, ...candidateOptions } = baseOptions
      const key = credentialKey(candidate.value)
      baseOptions = key ? { ...candidateOptions, apiKey: key } : candidateOptions
    }
    if (String(model.providerID) === "sap-ai-core") {
      const serviceKey = credentialKey(credential)
      if (serviceKey) process.env.AICORE_SERVICE_KEY = serviceKey
      const { apiKey: _apiKey, baseURL: _baseURL, ...sapOptions } = baseOptions
      baseOptions = sapOptions
    }
    const configuredHeaders = isObject(baseOptions.headers) ? baseOptions.headers : {}
    const options: Readonly<Record<string, unknown>> = {
      ...baseOptions,
      ...(Object.keys(model.request.headers).length ? { headers: { ...configuredHeaders, ...model.request.headers } } : {}),
    }
    const languageKey = stableStringify({
      providerID: model.providerID,
      package: model.api.package,
      modelID: model.api.id,
      variant: model.request.variant,
      body: model.request.body,
      headers: model.request.headers,
      credential: candidate ? `${candidate.credentialId}:${candidate.revision}` : "configured",
    })
    const cached = this.languages.get(languageKey)
    if (cached) return cached

    try {
      const custom = this.input.customLoaders?.[String(model.providerID)]
      const customLanguage = await custom?.getLanguage?.({
        provider: record.provider,
        model,
        env: state.env,
        credential,
        options,
      })
      if (customLanguage) {
        this.languages.set(languageKey, customLanguage)
        return customLanguage
      }
      for (const extension of this.input.extensions ?? []) {
        const language = await extension.getLanguage?.({ provider: record.provider, model, options })
        if (language) {
          this.languages.set(languageKey, language)
          return language
        }
      }
      const loaders = { ...BUNDLED_PROVIDERS, ...(this.input.providerLoaders ?? {}) }
      const loader = loaders[model.api.package]
      if (!loader) throw new ProviderRuntimeError("PROVIDER_NOT_BUNDLED", `Provider package ${model.api.package} is not bundled`)
      const { apiKey: _apiKey, ...cacheSafeOptions } = options
      const sdkKey = stableStringify({
        providerID: model.providerID,
        package: model.api.package,
        options: cacheSafeOptions,
        credential: candidate ? `${candidate.credentialId}:${candidate.revision}` : "configured",
      })
      let sdk = this.sdks.get(sdkKey)
      if (!sdk) {
        const create = await loader()
        sdk = create({ name: model.providerID, ...options })
        this.sdks.set(sdkKey, sdk)
      }
      const language = selectLanguageModel(sdk, model)
      this.languages.set(languageKey, language)
      return language
    } catch (cause) {
      if (cause instanceof ProviderRuntimeError) throw cause
      throw new ProviderRuntimeError("LANGUAGE_MODEL_FAILED", `Failed to create ${model.providerID}/${model.id}`, { cause })
    }
  }

  

  async refresh(force = false): Promise<void> {
    this.assertActive()
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshInternal(force).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  async reload(): Promise<void> {
    const source = await this.readCache() ?? this.catalogSource
    if (!source) {
      this.state = await this.load()
    } else {
      this.state = await this.build(source)
    }
    this.languages.clear()
    this.sdks.clear()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = undefined
    await this.refreshing?.catch(() => undefined)
    this.languages.clear()
    this.sdks.clear()
    this.state = undefined
    if (this.pluginInitialized && this.input.pluginHost?.dispose) {
      await runEffectOrPromise(this.input.pluginHost.dispose())
    }
  }

  private async refreshInternal(force: boolean) {
    if (!force && await this.cacheFresh()) return
    try {
      const catalog = await this.fetchCatalog()
      await this.writeCache(catalog)
      this.state = await this.build(catalog)
      this.languages.clear()
      this.sdks.clear()
    } catch (cause) {
      throw new ProviderRuntimeError("CATALOG_REFRESH_FAILED", "Failed to refresh models.dev catalog; existing state was retained", { cause })
    }
  }

  private async ensure(): Promise<RuntimeState> {
    this.assertActive()
    if (this.state) return this.state
    if (!this.loading) this.loading = this.load().finally(() => { this.loading = undefined })
    const state = await this.loading
    this.startRefreshTimer()
    if (this.input.refreshIntervalMs !== false) {
      void this.cacheFresh().then((fresh) => {
        if (!fresh) void this.refresh(true).catch(() => undefined)
      })
    }
    return state
  }

  private assertActive() {
    if (this.disposed) throw new ProviderRuntimeError("DISPOSED", "Provider runtime has been disposed")
  }

  private startRefreshTimer() {
    if (this.refreshTimer || this.input.refreshIntervalMs === false) return
    const interval = this.input.refreshIntervalMs ?? 60 * 60 * 1_000
    this.refreshTimer = setInterval(() => { void this.refresh(true).catch(() => undefined) }, interval)
    this.refreshTimer.unref?.()
  }

  private async load(): Promise<RuntimeState> {
    const disk = await this.readCache()
    if (disk) return this.state = await this.build(disk)
    const snapshot = await sourceValue(this.input.snapshot, undefined)
    if (snapshot) return this.state = await this.build(snapshot)
    const remote = await this.fetchCatalog()
    await this.writeCache(remote)
    return this.state = await this.build(remote)
  }

  private async build(raw: ModelsDev.Catalog): Promise<RuntimeState> {
    this.catalogSource = raw
    const mapped = mapModelsDev(raw)
    const config = await sourceValue(this.input.config, {})
    let catalog = mapped.catalog

    if (this.input.pluginHost) {
      if (!this.pluginInitialized) {
        await runEffectOrPromise(this.input.pluginHost.init())
        this.pluginInitialized = true
      }
      catalog = await runEffectOrPromise<ProviderCatalog>(this.input.pluginHost.transformProviderCatalog(catalog))
    }
    for (const extension of this.input.extensions ?? []) {
      if (extension.transformCatalog) catalog = await extension.transformCatalog(catalog)
    }
    validateCatalogHeaders(catalog, "plugin")

    // 1. models.dev -> 2. plugin -> 3. first user config application.
    let providers = cloneCatalog(catalog)
    for (const [id, value] of Object.entries(config.providers ?? {})) applyProviderConfig(providers, id, value)

    const env = await sourceValue(this.input.env, process.env)
    const enabled = config.enabledProviders ? new Set(config.enabledProviders) : undefined
    const disabled = new Set(config.disabledProviders ?? [])
    const options = new Map<string, Readonly<Record<string, unknown>>>()
    const credentials = new Map<string, Credential.Value | string | undefined>()
    const configurationErrors = new Map<string, string>()

    for (const [providerID, initialRecord] of providers) {
      const id = String(providerID)
      const providerConfig = config.providers?.[id]
      if (providerConfig?.disabled || disabled.has(id) || (enabled && !enabled.has(id))) {
        providers.delete(providerID)
        continue
      }
      const names = providerConfig?.env ?? mapped.metadata.env.get(id) ?? []
      const envKey = names.map((name) => env[name]).find((value): value is string => Boolean(value))
      const credential = await this.getCredential(providerID)
      credentials.set(id, credential)
      let record = initialRecord
      let providerOptions: Readonly<Record<string, unknown>> = record.provider.api.settings ?? {}
      // 4. Environment and database credentials only fill sensitive values.
      const key = credentialKey(credential) ?? envKey
      if (key && providerOptions.apiKey === undefined) providerOptions = { ...providerOptions, apiKey: key }
      const baseURL = record.provider.api.url
      if (baseURL && providerOptions.baseURL === undefined) providerOptions = { ...providerOptions, baseURL }
      if (record.provider.request.headers && Object.keys(record.provider.request.headers).length) {
        const configuredHeaders = isObject(providerOptions.headers) ? providerOptions.headers : {}
        providerOptions = { ...providerOptions, headers: { ...configuredHeaders, ...record.provider.request.headers } }
      }
      // 5. Built-in and explicitly injected custom loader options.
      let customConfigured = false
      const builtin = builtinCustomOptions({ provider: record.provider, env, credential, options: providerOptions })
      if (builtin) {
        customConfigured = builtin.configured
        providerOptions = merge(providerOptions, builtin.options)
        if (builtin.error) configurationErrors.set(id, builtin.error)
        else configurationErrors.delete(id)
      }
      const custom = this.input.customLoaders?.[id]
      const customOptions = await custom?.options?.({ provider: record.provider, env, credential, options: providerOptions })
      if (customOptions) {
        customConfigured = true
        providerOptions = merge(providerOptions, customOptions)
      }
      let extensionConfigured = false
      for (const extension of this.input.extensions ?? []) {
        const extra = await extension.providerOptions?.(record.provider, credential)
        if (extra) {
          extensionConfigured = true
          providerOptions = merge(providerOptions, extra)
        }
      }

      // 6. Re-apply user config so non-sensitive user values have final priority.
      if (providerConfig) {
        applyProviderConfig(providers, id, providerConfig)
        record = providers.get(providerID) ?? record
        providerOptions = merge(providerOptions, providerConfig.options ?? {})
        if (providerConfig.api) providerOptions = { ...providerOptions, baseURL: providerConfig.api }
        if (providerConfig.headers && Object.keys(providerConfig.headers).length) {
          const headers = isObject(providerOptions.headers) ? providerOptions.headers : {}
          providerOptions = { ...providerOptions, headers: { ...headers, ...providerConfig.headers } }
        }
      }
      validateOptionsHeaders(providerOptions, `resolved options for ${id}`)
      const configured = providerConfig !== undefined || Boolean(envKey) || credential !== undefined || customConfigured || extensionConfigured

      for (const [modelID, model] of record.models) {
        const listed = !providerConfig?.whitelist || providerConfig.whitelist.includes(String(modelID))
        const blocked = providerConfig?.blacklist?.includes(String(modelID)) ?? false
        const invalidAlias = (String(modelID) === "gpt-5-chat-latest" && ["openai", "github-copilot", "openrouter"].includes(id))
          || (id === "openrouter" && String(modelID) === "openai/gpt-5-chat")
        if (!model.enabled || blocked || !listed || invalidAlias || model.status === "deprecated" || (model.status === "alpha" && !config.enableExperimentalModels)) {
          record.models.delete(modelID)
        } else if (!configured) {
          model.enabled = false
        }
      }
      if (record.models.size === 0) {
        providers.delete(providerID)
        continue
      }
      if (configured) options.set(id, providerOptions)
    }
    const result = asCatalog(providers, config.default ?? catalog.default)
    validateCatalogHeaders(result, "resolved catalog")
    return { catalog: result, options, credentials, env, configurationErrors }
  }

  private async getCredential(providerID: Provider.ID) {
    const source = this.input.credentials
    if (!source) return undefined
    if ("get" in source && typeof source.get === "function") return source.get(providerID)
    return (source as Readonly<Record<string, Credential.Value | string | undefined>>)[String(providerID)]
  }

  private async readCache(): Promise<ModelsDev.Catalog | undefined> {
    try {
      return JSON.parse(await readFile(this.input.cachePath, "utf8")) as ModelsDev.Catalog
    } catch {
      return undefined
    }
  }

  private async cacheFresh() {
    try {
      const info = await stat(this.input.cachePath)
      return Date.now() - info.mtimeMs < (this.input.freshnessMs ?? DEFAULT_FRESHNESS)
    } catch {
      return false
    }
  }

  private async fetchCatalog(): Promise<ModelsDev.Catalog> {
    const request = this.input.fetch ?? globalThis.fetch
    const source = this.input.source ?? DEFAULT_SOURCE
    const url = source.endsWith("/api.json") ? source : `${source.replace(/\/$/, "")}/api.json`
    const response = await request(url, {
      headers: { "User-Agent": "CodePilotX/provider-runtime" },
      signal: AbortSignal.timeout(this.input.fetchTimeoutMs ?? DEFAULT_TIMEOUT),
    })
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
    const value = await response.json()
    if (!isObject(value)) throw new ProviderRuntimeError("CATALOG_INVALID", "models.dev response must be an object")
    return value as ModelsDev.Catalog
  }

  private async writeCache(catalog: ModelsDev.Catalog) {
    await mkdir(dirname(this.input.cachePath), { recursive: true })
    const temporary = `${this.input.cachePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, JSON.stringify(catalog), "utf8")
    await rename(temporary, this.input.cachePath)
  }
}

export const createProviderRuntime = (options: ProviderRuntimeOptions) => new ProviderRuntime(options)
