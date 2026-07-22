import { Connection, Credential, Integration, Provider } from "@codepilotx/model-schema"
import type { AuthRegistration, HookSpec, PluginHost } from "@codepilotx/provider-plugin"
import type { CredentialOutcome, CredentialPoolSource, ProviderRuntime } from "@codepilotx/provider-runtime"
import { Effect, Schema } from "effect"
import type { EncryptedCredentialRepository } from "../auth/EncryptedCredentialRepository"
import { AgentError } from "../domain"

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1_000
const MINIMAX_REGION = {
  "minimax-coding-plan": {
    endpoint: "https://api.minimax.io/anthropic/v1/models",
    alternateEndpoint: "https://api.minimaxi.com/anthropic/v1/models",
    alternateName: "MiniMax Token Plan (minimaxi.com)",
  },
  "minimax-cn-coding-plan": {
    endpoint: "https://api.minimaxi.com/anthropic/v1/models",
    alternateEndpoint: "https://api.minimax.io/anthropic/v1/models",
    alternateName: "MiniMax Token Plan (minimax.io)",
  },
} as const
const PROVIDER_ENV_NAMES: Readonly<Record<string, readonly string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"],
  azure: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
  "amazon-bedrock": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
  openrouter: ["OPENROUTER_API_KEY"],
  "github-copilot": ["GITHUB_TOKEN"],
  mistral: ["MISTRAL_API_KEY"],
  gitlab: ["GITLAB_TOKEN"],
}

type Runtime = Pick<ProviderRuntime, "list">
type Host = Pick<PluginHost<HookSpec>, "integrations" | "authRegistrations">
type CredentialRepository = Pick<EncryptedCredentialRepository,
  "list" | "listApiKeys" | "get" | "getById" | "set" | "remove" | "setActive" |
  "compareAndSetActive" | "updateHealth"
>
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface IntegrationServiceOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: Fetcher
  readonly attemptTtlMs?: number
  readonly now?: () => number
  readonly attemptID?: () => string
}

export interface IntegrationConnectInput {
  readonly integrationID: string
  readonly key: string
  readonly label?: string
}

export interface IntegrationDisconnectInput {
  readonly integrationID: string
  readonly credentialID: string
}

export interface IntegrationAuthorizeInput {
  readonly integrationID: string
  readonly methodID: string
  readonly inputs: Readonly<Record<string, string>>
  readonly label?: string
}

export interface IntegrationCompleteInput {
  readonly attemptID: string
  readonly code?: string
}

export interface IntegrationAttemptContext {
  readonly integrationID: string
  readonly connection?: Connection.Info
}

type AttemptRecord = {
  readonly attempt: Integration.Attempt
  readonly integrationID: Integration.ID
  readonly methodID: Integration.MethodID
  readonly label?: string
  readonly callback: (code?: string) => Effect.Effect<Credential.Value, unknown>
  status: Integration.AttemptStatus
  connection?: Connection.Info
  running?: Promise<Connection.Info>
}

type IntegrationDraft = {
  readonly id: Integration.ID
  name: string
  readonly methods: Integration.Method[]
  readonly providerIDs: Provider.ID[]
}

const toAgentError = (cause: unknown, code: string, message: string, status = 500) =>
  cause instanceof AgentError ? cause : new AgentError(code, message, status, cause)

const methodKey = (method: Integration.Method) =>
  method.type === "oauth" ? `oauth:${method.id}` : method.type

const mergeMethod = (methods: Integration.Method[], method: Integration.Method) => {
  const index = methods.findIndex((item) => methodKey(item) === methodKey(method))
  if (index < 0) {
    methods.push(method)
    return
  }
  if (method.type !== "env" || methods[index]?.type !== "env") return
  methods[index] = {
    type: "env",
    names: [...new Set([...methods[index].names, ...method.names])],
  }
}

const envPrefix = (id: string) => id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()

const generatedEnvNames = (draft: IntegrationDraft) => {
  const ids = [...new Set([String(draft.id), ...draft.providerIDs.map(String)])]
  const known = [...new Set(ids.flatMap((id) => PROVIDER_ENV_NAMES[id] ?? []))]
  if (known.length > 0) return known
  const prefixes = ids.map(envPrefix).filter(Boolean)
  return [...new Set(prefixes.map((prefix) => `${prefix}_API_KEY`))]
}

export class IntegrationService {
  private readonly attempts = new Map<string, AttemptRecord>()
  private readonly integrationByProvider = new Map<string, Integration.ID>()
  private readonly env: Readonly<Record<string, string | undefined>>
  private readonly fetcher: Fetcher
  private readonly attemptTtlMs: number
  private readonly now: () => number
  private readonly nextAttemptID: () => string

  constructor(
    private readonly runtime: Runtime,
    private readonly pluginHost: Host,
    private readonly credentials: CredentialRepository,
    options: IntegrationServiceOptions = {},
  ) {
    this.env = options.env ?? process.env
    this.fetcher = options.fetch ?? fetch
    this.attemptTtlMs = options.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS
    this.now = options.now ?? Date.now
    this.nextAttemptID = options.attemptID ?? (() => `attempt_${crypto.randomUUID()}`)
  }

  async list(): Promise<readonly Integration.Info[]> {
    try {
      const providers = await this.runtime.list()
      const [registered, auth] = await Promise.all([
        Effect.runPromise(this.pluginHost.integrations()),
        Effect.runPromise(this.pluginHost.authRegistrations()),
      ])
      const drafts = new Map<string, IntegrationDraft>()
      this.integrationByProvider.clear()

      for (const provider of providers) {
        const integrationID = provider.integrationID ?? Integration.ID.make(String(provider.id))
        this.integrationByProvider.set(String(provider.id), integrationID)
        const draft = drafts.get(String(integrationID)) ?? {
          id: integrationID,
          name: provider.name,
          methods: [],
          providerIDs: [],
        }
        draft.providerIDs.push(provider.id)
        drafts.set(String(integrationID), draft)
      }

      for (const integration of registered) {
        const draft = drafts.get(String(integration.id)) ?? {
          id: integration.id,
          name: integration.name,
          methods: [],
          providerIDs: [],
        }
        draft.name = integration.name
        for (const method of integration.methods) mergeMethod(draft.methods, method)
        drafts.set(String(integration.id), draft)
      }

      for (const registration of auth) {
        const draft = drafts.get(String(registration.integrationID))
        if (draft) mergeMethod(draft.methods, registration.method)
      }

      for (const draft of drafts.values()) {
        if (draft.providerIDs.length === 0) continue
        if (!draft.methods.some((method) => method.type === "key")) mergeMethod(draft.methods, { type: "key" })
        if (!draft.methods.some((method) => method.type === "env")) {
          mergeMethod(draft.methods, { type: "env", names: generatedEnvNames(draft) })
        }
      }

      const summaries = this.credentials.list()
      return [...drafts.values()].map((draft) => ({
        id: draft.id,
        name: draft.name,
        methods: draft.methods,
        connections: [
          ...summaries
            .filter((summary) => summary.integrationID === String(draft.id))
            .map((summary): Connection.Info => ({
              type: "credential",
              id: Credential.ID.make(summary.id),
              label: summary.label,
            })),
          ...draft.methods
            .filter((method): method is Integration.EnvMethod => method.type === "env")
            .flatMap((method) => method.names)
            .filter((name, index, names) => Boolean(this.env[name]) && names.indexOf(name) === index)
            .map((name): Connection.Info => ({ type: "env", name })),
        ],
      }))
    } catch (cause) {
      throw toAgentError(cause, "INTEGRATION_LIST_FAILED", "无法读取认证集成列表")
    }
  }

  async connect(input: IntegrationConnectInput): Promise<Connection.Info> {
    try {
      const key = input.key.trim()
      if (!key) throw new AgentError("INVALID_CREDENTIAL", "API Key 不能为空", 400)
      const integration = await this.integration(input.integrationID)
      if (!integration.methods.some((method) => method.type === "key")) {
        throw new AgentError("INTEGRATION_KEY_UNSUPPORTED", `集成 ${input.integrationID} 不支持 API Key`, 400)
      }
      await this.validateKeyRegion(String(integration.id), key)
      const summary = await Effect.runPromise(this.credentials.set({
        integrationID: String(integration.id),
        ...(input.label === undefined ? {} : { label: input.label }),
        value: Credential.Value.make({ type: "key", key }),
      }))
      return { type: "credential", id: Credential.ID.make(summary.id), label: summary.label }
    } catch (cause) {
      throw toAgentError(cause, "INTEGRATION_CONNECT_FAILED", "无法保存认证凭据")
    }
  }

  async disconnect(input: IntegrationDisconnectInput): Promise<void> {
    try {
      const integrationID = Integration.ID.make(input.integrationID)
      const summary = this.credentials.list().find((item) =>
        item.integrationID === String(integrationID) && item.id === input.credentialID)
      if (!summary) throw new AgentError("CREDENTIAL_NOT_FOUND", "未找到要断开的认证凭据", 404)
      const removed = await Effect.runPromise(this.credentials.remove(String(integrationID)))
      if (!removed || this.credentials.list().some((item) => item.integrationID === String(integrationID))) {
        throw new AgentError("CREDENTIAL_DELETE_FAILED", "认证凭据未能从安全存储中删除", 409)
      }
      for (const record of this.attempts.values()) {
        if (record.integrationID === integrationID && record.status.status === "pending") {
          record.status = { status: "failed", message: "授权已取消", time: record.attempt.time }
        }
      }
    } catch (cause) {
      throw toAgentError(cause, "INTEGRATION_DISCONNECT_FAILED", "无法断开认证集成")
    }
  }

  async authorize(input: IntegrationAuthorizeInput): Promise<Integration.Attempt> {
    try {
      this.pruneAttempts()
      const integrationID = Integration.ID.make(input.integrationID)
      const methodID = Integration.MethodID.make(input.methodID)
      await this.integration(integrationID)
      const registrations = await Effect.runPromise(this.pluginHost.authRegistrations(integrationID))
      const registration = registrations.find((item): item is Extract<AuthRegistration, { method: Integration.OAuthMethod }> =>
        item.method.type === "oauth" && item.method.id === methodID)
      if (!registration) {
        throw new AgentError(
          "INTEGRATION_OAUTH_UNSUPPORTED",
          `集成 ${input.integrationID} 未注册 OAuth 方法 ${input.methodID}`,
          400,
        )
      }

      const authorization = await Effect.runPromise(registration.authorize(input.inputs))
      const created = this.now()
      const time = { created, expires: created + this.attemptTtlMs }
      const attempt: Integration.Attempt = {
        attemptID: Integration.AttemptID.make(this.nextAttemptID()),
        url: authorization.url,
        instructions: authorization.instructions,
        mode: authorization.mode,
        time,
      }
      const callback = authorization.mode === "auto"
        ? () => authorization.callback
        : (code?: string) => authorization.callback(code ?? "")
      const record: AttemptRecord = {
        attempt,
        integrationID,
        methodID,
        ...(input.label === undefined ? {} : { label: input.label }),
        callback,
        status: { status: "pending", time },
      }
      this.attempts.set(String(attempt.attemptID), record)
      if (attempt.mode === "auto") {
        queueMicrotask(() => { void this.runAttempt(record).catch(() => undefined) })
      }
      return attempt
    } catch (cause) {
      throw toAgentError(cause, "INTEGRATION_OAUTH_AUTHORIZE_FAILED", "无法启动 OAuth 授权", 502)
    }
  }

  async complete(input: IntegrationCompleteInput): Promise<Connection.Info> {
    const record = this.attempt(input.attemptID)
    this.expire(record)
    if (record.status.status === "expired") {
      throw new AgentError("OAUTH_ATTEMPT_EXPIRED", "OAuth 授权已过期", 410)
    }
    if (record.attempt.mode !== "code") {
      throw new AgentError("OAUTH_COMPLETE_UNSUPPORTED", "自动 OAuth 授权不接受验证码", 400)
    }
    const code = input.code?.trim()
    if (!code) throw new AgentError("INVALID_OAUTH_CODE", "OAuth 验证码不能为空", 400)
    return this.runAttempt(record, code)
  }

  async status(attemptID: string): Promise<Integration.AttemptStatus> {
    const record = this.attempt(attemptID)
    this.expire(record)
    return record.status
  }

  attemptContext(attemptID: string): IntegrationAttemptContext {
    const record = this.attempt(attemptID)
    return {
      integrationID: String(record.integrationID),
      ...(record.connection === undefined ? {} : { connection: record.connection }),
    }
  }

  credentialSource(): CredentialPoolSource {
    return {
      get: (providerID) => this.credentialForProvider(providerID),
      candidates: (providerID) => this.credentialCandidates(providerID),
      report: (outcome) => this.reportCredentialOutcome(outcome),
    }
  }

  private async credentialCandidates(providerID: Provider.ID) {
    const integrationID = this.integrationByProvider.get(String(providerID)) ?? Integration.ID.make(String(providerID))
    const now = this.now()
    const result = []
    for (const summary of this.credentials.listApiKeys(String(integrationID))) {
      if (!summary.enabled || summary.health.status === "auth-failed") continue
      const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(summary.id))
      if (!stored || !Schema.is(Credential.Value)(stored.value)) continue
      result.push({
        credentialId: Credential.ID.make(summary.id),
        revision: summary.updatedAt,
        value: stored.value,
        active: summary.active,
        priority: summary.priority,
        ...(summary.health.cooldownUntil !== null && summary.health.cooldownUntil > now
          ? { cooldownUntil: summary.health.cooldownUntil }
          : {}),
      })
    }
    return result
  }

  private async reportCredentialOutcome(outcome: CredentialOutcome) {
    const summary = this.credentials.listApiKeys().find((item) => item.id === String(outcome.credentialId))
    if (!summary || summary.updatedAt !== outcome.revision) return
    if (outcome.result === "authentication") {
      await Effect.runPromise(this.credentials.updateHealth(summary.id, {
        status: "auth-failed",
        lastUsedAt: outcome.occurredAt,
        lastErrorCategory: "authentication",
        cooldownUntil: null,
      }))
      return
    }
    if (outcome.result === "rate-limit") {
      const retryAfterMs = Math.min(24 * 60 * 60_000, Math.max(0, outcome.retryAfterMs ?? 60_000))
      await Effect.runPromise(this.credentials.updateHealth(summary.id, {
        status: "rate-limited",
        lastUsedAt: outcome.occurredAt,
        lastErrorCategory: "rate-limit",
        cooldownUntil: outcome.occurredAt + retryAfterMs,
      }))
      return
    }
    await Effect.runPromise(this.credentials.updateHealth(summary.id, {
      status: "healthy",
      lastUsedAt: outcome.occurredAt,
      lastErrorCategory: null,
      cooldownUntil: null,
    }))
    if (!outcome.activeCredentialId || String(outcome.activeCredentialId) === summary.id) return
    const active = this.credentials.listApiKeys(summary.integrationID).find((item) => item.active)
    if (active?.id !== String(outcome.activeCredentialId) || active.health.status !== "auth-failed") return
    await Effect.runPromise(this.credentials.compareAndSetActive(
      summary.integrationID,
      String(outcome.activeCredentialId),
      summary.id,
    ))
  }

  private async integration(integrationID: string): Promise<Integration.Info> {
    const integration = (await this.list()).find((item) => item.id === integrationID)
    if (!integration) throw new AgentError("INTEGRATION_NOT_FOUND", `未找到认证集成 ${integrationID}`, 404)
    return integration
  }

  private async validateKeyRegion(integrationID: string, key: string) {
    const region = MINIMAX_REGION[integrationID as keyof typeof MINIMAX_REGION]
    if (!region) return
    const request = (url: string) => this.fetcher(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(8_000),
    })
    let selected: Response
    try {
      selected = await request(region.endpoint)
    } catch {
      return
    }
    if (selected.status !== 401) return
    try {
      const alternate = await request(region.alternateEndpoint)
      if (alternate.ok) {
        throw new AgentError(
          "INTEGRATION_REGION_MISMATCH",
          `该 MiniMax API Key 属于另一个地区，请切换到“${region.alternateName}”后重新保存`,
          400,
        )
      }
      if (alternate.status === 401) {
        throw new AgentError("INVALID_CREDENTIAL", "MiniMax 拒绝了该 API Key，请确认密钥正确且套餐仍有效", 400)
      }
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
    }
  }

  private attempt(attemptID: string) {
    const record = this.attempts.get(attemptID)
    if (!record) throw new AgentError("OAUTH_ATTEMPT_NOT_FOUND", "未找到 OAuth 授权尝试", 404)
    return record
  }

  private expire(record: AttemptRecord) {
    if (record.status.status === "pending" && this.now() >= record.attempt.time.expires) {
      record.status = { status: "expired", time: record.attempt.time }
    }
  }

  private pruneAttempts() {
    const now = this.now()
    for (const [attemptID, record] of this.attempts) {
      this.expire(record)
      if (now >= record.attempt.time.expires + this.attemptTtlMs) this.attempts.delete(attemptID)
    }
  }

  private runAttempt(record: AttemptRecord, code?: string): Promise<Connection.Info> {
    if (record.running) return record.running
    record.running = (async () => {
      try {
        this.expire(record)
        if (record.status.status !== "pending") {
          if (record.status.status === "complete" && record.connection) return record.connection
          if (record.status.status === "expired") throw new AgentError("OAUTH_ATTEMPT_EXPIRED", "OAuth 授权已过期", 410)
          if (record.status.status === "failed") throw new AgentError("OAUTH_ATTEMPT_FAILED", record.status.message, 400)
          throw new AgentError("OAUTH_ATTEMPT_FAILED", "OAuth 授权状态无效", 500)
        }
        const value = await Effect.runPromise(record.callback(code))
        if (!Schema.is(Credential.Value)(value)) {
          throw new AgentError("INVALID_CREDENTIAL", "OAuth 提供方返回了无效凭据", 502)
        }
        this.expire(record)
        if (record.status.status !== "pending") {
          throw new AgentError("OAUTH_ATTEMPT_EXPIRED", "OAuth 授权已过期", 410)
        }
        const registrations = await Effect.runPromise(this.pluginHost.authRegistrations(record.integrationID))
        const registration = registrations.find((item) =>
          item.method.type === "oauth" && item.method.id === record.methodID)
        const generatedLabel = value.type === "oauth" && registration && "label" in registration
          ? registration.label?.(value)
          : undefined
        const label = record.label ?? generatedLabel
        const summary = await Effect.runPromise(this.credentials.set({
          integrationID: String(record.integrationID),
          methodID: String(record.methodID),
          ...(label === undefined ? {} : { label }),
          value,
        }))
        const connection: Connection.Info = {
          type: "credential",
          id: Credential.ID.make(summary.id),
          label: summary.label,
        }
        record.connection = connection
        record.status = { status: "complete", time: record.attempt.time }
        return connection
      } catch (cause) {
        const error = toAgentError(cause, "OAUTH_ATTEMPT_FAILED", "OAuth 授权失败", 502)
        if (record.status.status === "pending") {
          record.status = { status: "failed", message: error.message, time: record.attempt.time }
        }
        throw error
      }
    })()
    return record.running
  }

  private async credentialForProvider(providerID: Provider.ID): Promise<Credential.Value | undefined> {
    try {
      const integrationID = this.integrationByProvider.get(String(providerID)) ?? Integration.ID.make(String(providerID))
      const stored = await Effect.runPromise(this.credentials.get<Credential.Value>(String(integrationID)))
      if (!stored && String(integrationID) !== String(providerID)) {
        const fallback = await Effect.runPromise(this.credentials.get<Credential.Value>(String(providerID)))
        if (!fallback) return undefined
        if (!Schema.is(Credential.Value)(fallback.value)) throw new AgentError("INVALID_CREDENTIAL", "存储的 Provider 凭据无效", 500)
        return this.refreshOAuth(Integration.ID.make(fallback.integrationID), fallback.value, fallback.label)
      }
      if (!stored) return undefined
      if (!Schema.is(Credential.Value)(stored.value)) throw new AgentError("INVALID_CREDENTIAL", "存储的 Provider 凭据无效", 500)
      return this.refreshOAuth(Integration.ID.make(stored.integrationID), stored.value, stored.label)
    } catch (cause) {
      throw toAgentError(cause, "CREDENTIAL_READ_FAILED", "无法解析 Provider 凭据")
    }
  }

  private async refreshOAuth(integrationID: Integration.ID, value: Credential.Value, label: string) {
    if (value.type !== "oauth" || value.expires === 0 || value.expires > this.now() + 60_000) return value
    const registrations = await Effect.runPromise(this.pluginHost.authRegistrations(integrationID))
    const registration = registrations.find((item): item is Extract<AuthRegistration, { method: Integration.OAuthMethod }> =>
      item.method.type === "oauth" && item.method.id === value.methodID)
    if (!registration?.refresh) throw new AgentError("OAUTH_REFRESH_UNAVAILABLE", `集成 ${integrationID} 的 OAuth 凭据已过期`, 401)
    const refreshed = await Effect.runPromise(registration.refresh(value))
    if (!Schema.is(Credential.OAuth)(refreshed)) throw new AgentError("INVALID_CREDENTIAL", "OAuth 刷新返回了无效凭据", 502)
    await Effect.runPromise(this.credentials.set({
      integrationID: String(integrationID),
      methodID: String(refreshed.methodID),
      label,
      value: refreshed,
    }))
    return refreshed
  }
}
