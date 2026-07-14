import { Effect, Schema } from "effect"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"
import type { AgentConfig } from "../config/Config"
import { AgentError, type ProviderInfo, type ResolvedModel } from "../domain"
import type { AgentDatabase } from "../storage/Database"

const CapabilitySchema = Schema.Struct({
  reasoning: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Boolean),
  image: Schema.optional(Schema.Boolean),
  inputLimit: Schema.optional(Schema.Number),
  outputLimit: Schema.optional(Schema.Number),
})

const ModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  attachment: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Struct({ context: Schema.optional(Schema.Number), output: Schema.optional(Schema.Number) })),
  capabilities: Schema.optional(CapabilitySchema),
})

const ProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, ModelSchema),
})

const CatalogSchema = Schema.Record(Schema.String, ProviderSchema)

type RawCatalog = typeof CatalogSchema.Type
type Protocol = ResolvedModel["protocol"]

interface ProviderSetting {
  name?: string
  protocol?: Protocol
  kind?: Protocol
  baseURL?: string
  headers?: Record<string, string>
  models?: Array<Partial<ResolvedModel> & {
    id?: string
    modelID?: string
    limits?: { context?: number; output?: number }
    capabilities?: Partial<ResolvedModel["capabilities"]> & { toolCall?: boolean; imageInput?: boolean }
    defaultParameters?: Record<string, unknown>
  }>
  modelOverrides?: Record<string, Partial<ResolvedModel>>
  disabled?: boolean
}

const CORE_IDS = new Set(["openai", "anthropic", "openai-compatible"])

const protocolFor = (id: string, setting?: ProviderSetting): Protocol => {
  if (setting?.protocol ?? setting?.kind) return (setting.protocol ?? setting.kind) as Protocol
  if (id === "anthropic") return "anthropic"
  return id === "openai" ? "openai" : "openai-compatible"
}

const readJson = async (path: string): Promise<unknown | null> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return file.json()
}

const normalize = (input: unknown): RawCatalog => {
  const root = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null
  const providerArray = Array.isArray(input) ? input : Array.isArray(root?.providers) ? root.providers : null
  const value = providerArray
    ? Object.fromEntries(providerArray.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => {
        const models = Array.isArray(item.models)
          ? Object.fromEntries(item.models.filter((model): model is Record<string, unknown> => Boolean(model && typeof model === "object")).map((model) => {
              const limits = model.limits && typeof model.limits === "object" ? model.limits as Record<string, unknown> : {}
              const capabilities = model.capabilities && typeof model.capabilities === "object" ? model.capabilities as Record<string, unknown> : {}
              return [String(model.id ?? ""), {
                id: String(model.id ?? ""),
                name: typeof model.name === "string" ? model.name : undefined,
                reasoning: capabilities.reasoning === true,
                tool_call: capabilities.toolCall === true,
                attachment: capabilities.imageInput === true,
                limit: { context: typeof limits.context === "number" ? limits.context : undefined, output: typeof limits.output === "number" ? limits.output : undefined },
              }]
            }))
          : item.models
        return [String(item.id ?? ""), { id: String(item.id ?? ""), name: item.name, api: item.baseURL ?? item.api, models }]
      }))
    : input
  return Schema.decodeUnknownSync(CatalogSchema)(value)
}

export class ModelCatalog {
  private providers = new Map<string, ProviderInfo>()

  constructor(
    private readonly config: AgentConfig,
    private readonly db: AgentDatabase,
    private readonly hasCredential: (providerID: string) => Promise<boolean>,
  ) {}

  load() {
    return Effect.tryPromise({
      try: async () => {
        const snapshot = normalize((await readJson(this.config.modelSnapshotPath)) ?? {})
        const cachedRaw = await readJson(this.config.modelCachePath)
        const cached = cachedRaw ? normalize(cachedRaw) : {}
        await this.rebuild({ ...snapshot, ...cached })
      },
      catch: (cause) => new AgentError("CATALOG_LOAD_FAILED", "模型目录加载失败", 500, cause),
    })
  }

  refresh() {
    return Effect.tryPromise({
      try: async () => {
        const response = await fetch(this.config.modelsDevURL, { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
        const catalog = normalize(await response.json())
        const selected = Object.fromEntries(Object.entries(catalog).filter(([id]) => CORE_IDS.has(id)))
        mkdirSync(dirname(this.config.modelCachePath), { recursive: true })
        const temp = `${this.config.modelCachePath}.${crypto.randomUUID()}.tmp`
        await Bun.write(temp, JSON.stringify(selected, null, 2))
        await Bun.file(temp).exists()
        const { rename } = await import("node:fs/promises")
        await rename(temp, this.config.modelCachePath)
        const snapshot = normalize((await readJson(this.config.modelSnapshotPath)) ?? {})
        await this.rebuild({ ...snapshot, ...selected })
      },
      catch: (cause) => new AgentError("CATALOG_REFRESH_FAILED", "模型目录刷新失败，已继续使用本地目录", 502, cause),
    })
  }

  private async rebuild(raw: RawCatalog) {
    const settings = this.db.providerSettings<ProviderSetting>()
    // Keep persisted Google settings and credentials intact for migration, but
    // never surface them as an active provider after Google support is removed.
    const configuredIDs = [...settings.entries()]
      .filter(([id, setting]) => id !== "google" && String(setting.protocol ?? setting.kind ?? "") !== "google")
      .map(([id]) => id)
    const ids = new Set([...Object.keys(raw).filter((id) => CORE_IDS.has(id)), ...configuredIDs])
    const next = new Map<string, ProviderInfo>()
    for (const id of ids) {
      const base = raw[id]
      const setting = settings.get(id)
      if (setting?.disabled) continue
      const protocol = protocolFor(id, setting)
      const models = new Map<string, ResolvedModel>()
      if (base) {
        for (const [modelID, model] of Object.entries(base.models)) {
          const capability = model.capabilities
          models.set(modelID, {
            providerID: id,
            modelID,
            name: model.name ?? modelID,
            protocol,
            ...(setting?.baseURL ?? base.api ? { baseURL: setting?.baseURL ?? base.api } : {}),
            ...(setting?.headers ? { headers: setting.headers } : {}),
            capabilities: {
              reasoning: capability?.reasoning ?? model.reasoning ?? false,
              tools: capability?.tools ?? model.tool_call ?? false,
              image: capability?.image ?? model.attachment ?? false,
              inputLimit: capability?.inputLimit ?? model.limit?.context ?? 128_000,
              outputLimit: capability?.outputLimit ?? model.limit?.output ?? 8_192,
            },
          })
        }
      }
      for (const configured of setting?.models ?? []) {
        const modelID = configured.modelID ?? configured.id
        if (!modelID) continue
        const existing = models.get(modelID)
        const configuredCapabilities = configured.capabilities
        models.set(modelID, {
          providerID: id,
          modelID,
          name: configured.name ?? existing?.name ?? modelID,
          protocol,
          ...(setting?.baseURL || configured.baseURL || existing?.baseURL ? { baseURL: setting?.baseURL ?? configured.baseURL ?? existing?.baseURL } : {}),
          ...(setting?.headers || configured.headers || existing?.headers ? { headers: setting?.headers ?? configured.headers ?? existing?.headers } : {}),
          capabilities: {
            reasoning: configuredCapabilities?.reasoning ?? existing?.capabilities.reasoning ?? false,
            tools: configuredCapabilities?.tools ?? configuredCapabilities?.toolCall ?? existing?.capabilities.tools ?? true,
            image: configuredCapabilities?.image ?? configuredCapabilities?.imageInput ?? existing?.capabilities.image ?? false,
            inputLimit: configuredCapabilities?.inputLimit ?? configured.limits?.context ?? existing?.capabilities.inputLimit ?? 128_000,
            outputLimit: configuredCapabilities?.outputLimit ?? configured.limits?.output ?? existing?.capabilities.outputLimit ?? 8_192,
          },
          ...(configured.defaults ?? configured.defaultParameters ?? existing?.defaults ? { defaults: configured.defaults ?? configured.defaultParameters ?? existing?.defaults } : {}),
        })
      }
      for (const [modelID, override] of Object.entries(setting?.modelOverrides ?? {})) {
        const existing = models.get(modelID)
        if (!existing) continue
        models.set(modelID, { ...existing, ...override, providerID: id, modelID, capabilities: { ...existing.capabilities, ...override.capabilities } })
      }
      next.set(id, {
        id,
        name: setting?.name ?? base?.name ?? id,
        protocol,
        ...(setting?.baseURL ?? base?.api ? { baseURL: setting?.baseURL ?? base?.api } : {}),
        configured: await this.hasCredential(id),
        models: [...models.values()],
      })
    }
    this.providers = next
  }

  list() {
    return [...this.providers.values()]
  }

  getProvider(providerID: string) {
    const provider = this.providers.get(providerID)
    if (!provider) throw new AgentError("PROVIDER_NOT_FOUND", `Provider ${providerID} 不存在`, 404)
    return provider
  }

  getModel(providerID: string, modelID: string) {
    const model = this.getProvider(providerID).models.find((item) => item.modelID === modelID)
    if (!model) throw new AgentError("MODEL_NOT_FOUND", `模型 ${providerID}/${modelID} 不存在`, 404)
    return model
  }

  defaultModel() {
    const saved = this.db.getSetting<{ providerID: string; modelID: string }>("defaultModel")
    if (saved) return this.getModel(saved.providerID, saved.modelID)
    const model = this.list().flatMap((provider) => provider.models).find(Boolean)
    if (!model) throw new AgentError("MODEL_NOT_CONFIGURED", "尚未配置可用模型", 409)
    return model
  }
}
