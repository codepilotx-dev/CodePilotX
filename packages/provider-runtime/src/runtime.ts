import type { Credential, Model, Provider } from "@codepilotx/model-schema"
import { Integration, Model as ModelSchema, Provider as ProviderSchema } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { Effect } from "effect"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { BUNDLED_PROVIDERS, selectLanguageModel } from "./bundled"
import { mapModelsDev, mapModelsDevCost } from "./catalog"
import { builtinCustomOptions } from "./custom"
import { ProviderRuntimeError } from "./error"
import { assertSafeHeaders } from "./security"
import { modelVariants } from "./variants"
import type {
  ModelsDev,
  ProviderConfig,
  ProviderLoader,
  BundledSDK,
  CredentialCandidate,
  CredentialOutcome,
  CredentialPoolSource,
  ProviderRuntimeExtension,
  ProviderRuntimeOptions,
  RuntimeConfig,
  ValueSource,
} from "./types"

const DEFAULT_SOURCE = "https://models.dev/api.json"
const DEFAULT_FRESHNESS = 5 * 60 * 1_000
const DEFAULT_TIMEOUT = 10_000

type Mutable<Value> = Value extends string | number | boolean | bigint | symbol | null | undefined
  ? Value
  : Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value
type MutableRecord = { provider: Mutable<Provider.Info>; models: Map<Model.ID, Mutable<Model.Info>> }
interface RuntimeState {
  readonly catalog: ProviderCatalog
  readonly options: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  readonly credentials: ReadonlyMap<string, Credential.Value | string | undefined>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly configurationErrors: ReadonlyMap<string, string>
}

const clone = <Value>(value: Value): Value => structuredClone(value)
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function merge<Value>(base: Value, patch: unknown): Value {
  if (!isObject(base) || !isObject(patch)) return clone(patch as Value)
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    result[key] = isObject(result[key]) && isObject(value) ? merge(result[key], value) : clone(value)
  }
  return result as Value
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") return `[function:${item.name || "anonymous"}]`
    if (!isObject(item)) return item
    if (seen.has(item)) return "[circular]"
    seen.add(item)
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
  })
}

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

async function sourceValue<Value>(source: ValueSource<Value> | undefined, fallback: Value): Promise<Value> {
  if (source === undefined) return fallback
  return typeof source === "function" ? await (source as () => PromiseLike<Value> | Value)() : source
}

async function runEffectOrPromise<Value>(value: unknown): Promise<Value> {
  if (Effect.isEffect(value)) return Effect.runPromise(value as Effect.Effect<Value, unknown>)
  return await value as Value
}

function cloneCatalog(catalog: ProviderCatalog): Map<Provider.ID, MutableRecord> {
  return new Map(Array.from(catalog.providers, ([id, record]) => [id, {
    provider: clone(record.provider) as Mutable<Provider.Info>,
    models: new Map(Array.from(record.models, ([modelID, model]) => [modelID, clone(model) as Mutable<Model.Info>])),
  }]))
}

function asCatalog(providers: Map<Provider.ID, MutableRecord>, defaultModel?: Model.Ref): ProviderCatalog {
  return {
    providers: new Map(Array.from(providers, ([id, record]) => [id, { provider: record.provider, models: record.models }])),
    ...(defaultModel ? { default: clone(defaultModel) } : {}),
  }
}

function credentialKey(value: Credential.Value | string | undefined) {
  if (typeof value === "string") return value
  if (value?.type === "key") return value.key
  if (value?.type === "oauth") return value.access
  return undefined
}

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000
const DEFAULT_RETRY_AFTER_MS = 60_000

function credentialPool(source: ProviderRuntimeOptions["credentials"]): CredentialPoolSource | undefined {
  if (!source || !("candidates" in source) || typeof source.candidates !== "function" || !("report" in source) || typeof source.report !== "function") {
    return undefined
  }
  return source as unknown as CredentialPoolSource
}

function errorStatus(error: unknown): number | undefined {
  let current = error
  const visited = new Set<object>()
  while (isObject(current) && !visited.has(current)) {
    visited.add(current)
    if (typeof current.statusCode === "number") return current.statusCode
    if (typeof current.status === "number") return current.status
    current = current.cause
  }
  return undefined
}

function errorHeaders(error: unknown): Headers | Readonly<Record<string, string>> | undefined {
  let current = error
  const visited = new Set<object>()
  while (isObject(current) && !visited.has(current)) {
    visited.add(current)
    const headers = current.responseHeaders ?? current.headers
    if (headers instanceof Headers || isObject(headers)) return headers as Headers | Readonly<Record<string, string>>
    current = current.cause
  }
  return undefined
}

function retryAfterMs(error: unknown, now: number): number {
  const headers = errorHeaders(error)
  const value = headers instanceof Headers
    ? headers.get("retry-after")
    : Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "retry-after")?.[1]
  if (!value) return DEFAULT_RETRY_AFTER_MS
  const seconds = Number(value)
  const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Number.isFinite(parsed) ? parsed : DEFAULT_RETRY_AFTER_MS))
}

function retryableCredentialError(error: unknown, now: number): Pick<CredentialOutcome, "result" | "retryAfterMs"> | undefined {
  const status = errorStatus(error)
  if (status === 401 || status === 403) return { result: "authentication" }
  if (status === 429) return { result: "rate-limit", retryAfterMs: retryAfterMs(error, now) }
  return undefined
}

function isVisibleStreamPart(part: LanguageModelV3StreamPart): boolean {
  return part.type !== "stream-start" && part.type !== "response-metadata"
}

function applyVariant(model: Model.Info, variantID: string): Model.Info {
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

function applyProviderConfig(providers: Map<Provider.ID, MutableRecord>, id: string, config: ProviderConfig) {
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
      const language = this.failoverLanguage(model, pool)
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
      credential: candidate ? `${candidate.credentialId}:${candidate.revision}` : "legacy",
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
        credential: candidate ? `${candidate.credentialId}:${candidate.revision}` : "legacy",
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

  private failoverLanguage(model: Model.Info, pool: CredentialPoolSource): LanguageModelV3 {
    const runtime = this
    const orderedCandidates = async () => {
      const now = Date.now()
      return [...await pool.candidates(model.providerID)]
        .filter((candidate) => candidate.cooldownUntil === undefined || candidate.cooldownUntil <= now)
        .sort((left, right) => Number(right.active) - Number(left.active) || left.priority - right.priority)
    }
    const report = async (candidate: CredentialCandidate, activeCredentialId: Credential.ID | undefined, result: CredentialOutcome["result"], retry?: number) => {
      await Promise.resolve(pool.report({
        providerID: model.providerID,
        credentialId: candidate.credentialId,
        revision: candidate.revision,
        ...(activeCredentialId ? { activeCredentialId } : {}),
        result,
        ...(retry === undefined ? {} : { retryAfterMs: retry }),
        occurredAt: Date.now(),
      })).catch(() => undefined)
    }
    const generate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
      const candidates = await orderedCandidates()
      if (candidates.length === 0) return runtime.createLanguage(model).then((language) => language.doGenerate(options))
      const activeCredentialId = candidates.find((candidate) => candidate.active)?.credentialId
      let lastError: unknown
      for (const candidate of candidates) {
        try {
          const result = await (await runtime.createLanguage(model, candidate)).doGenerate(options)
          await report(candidate, activeCredentialId, "success")
          return result
        } catch (error) {
          const retryable = retryableCredentialError(error, Date.now())
          if (!retryable) throw error
          await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
          lastError = error
        }
      }
      throw lastError
    }
    const stream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
      const candidates = await orderedCandidates()
      if (candidates.length === 0) return (await runtime.createLanguage(model)).doStream(options)
      const activeCredentialId = candidates.find((candidate) => candidate.active)?.credentialId
      let index = 0
      let current: { candidate: CredentialCandidate; result: LanguageModelV3StreamResult } | undefined
      let lastError: unknown
      while (index < candidates.length && !current) {
        const candidate = candidates[index++]!
        try {
          current = { candidate, result: await (await runtime.createLanguage(model, candidate)).doStream(options) }
        } catch (error) {
          const retryable = retryableCredentialError(error, Date.now())
          if (!retryable) throw error
          await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
          lastError = error
        }
      }
      if (!current) throw lastError
      const initial = current
      return {
        ...(initial.result.request ? { request: initial.result.request } : {}),
        ...(initial.result.response ? { response: initial.result.response } : {}),
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              let attempt: typeof initial | undefined = initial
              let visible = false
              let reportedSuccess = false
              let endedWithError = false
              let buffered: LanguageModelV3StreamPart[] = []
              while (attempt) {
                const reader = attempt.result.stream.getReader()
                let switched = false
                try {
                  while (true) {
                    const item = await reader.read()
                    if (item.done) {
                      if (!reportedSuccess && !endedWithError) await report(attempt.candidate, activeCredentialId, "success")
                      for (const part of buffered) controller.enqueue(part)
                      controller.close()
                      return
                    }
                    const part = item.value
                    const retryable = part.type === "error" ? retryableCredentialError(part.error, Date.now()) : undefined
                    if (retryable) {
                      await report(attempt.candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                      if (!visible && index < candidates.length) {
                        await reader.cancel().catch(() => undefined)
                        buffered = []
                        switched = true
                        break
                      }
                    }
                    if (part.type === "error") endedWithError = true
                    if (!visible && !isVisibleStreamPart(part)) {
                      buffered.push(part)
                      continue
                    }
                    if (!visible) {
                      visible = true
                      for (const pending of buffered) controller.enqueue(pending)
                      buffered = []
                    }
                    if (part.type !== "error" && !reportedSuccess) {
                      reportedSuccess = true
                      await report(attempt.candidate, activeCredentialId, "success")
                    }
                    controller.enqueue(part)
                  }
                } catch (error) {
                  const retryable = retryableCredentialError(error, Date.now())
                  if (retryable) await report(attempt.candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                  if (!retryable || visible) throw error
                  if (index >= candidates.length) throw error
                  buffered = []
                  switched = true
                } finally {
                  reader.releaseLock()
                }
                if (!switched) return
                attempt = undefined
                while (index < candidates.length && !attempt) {
                  const candidate = candidates[index++]!
                  try {
                    attempt = { candidate, result: await (await runtime.createLanguage(model, candidate)).doStream(options) }
                  } catch (error) {
                    const retryable = retryableCredentialError(error, Date.now())
                    if (!retryable) throw error
                    await report(candidate, activeCredentialId, retryable.result, retryable.retryAfterMs)
                    lastError = error
                  }
                }
              }
              throw lastError
            })().catch((error) => controller.error(error))
          },
        }),
      }
    }
    return {
      specificationVersion: "v3",
      provider: String(model.providerID),
      modelId: String(model.api.id),
      supportedUrls: {
        then(onfulfilled, onrejected) {
          return orderedCandidates()
            .then(async (candidates) => await (candidates.length
              ? (await runtime.createLanguage(model, candidates[0])).supportedUrls
              : (await runtime.createLanguage(model)).supportedUrls))
            .then(onfulfilled, onrejected)
        },
      },
      doGenerate: generate,
      doStream: stream,
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
