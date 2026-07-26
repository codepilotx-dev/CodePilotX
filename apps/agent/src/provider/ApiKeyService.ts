import { Credential, Provider } from "@codepilotx/model-schema"
import { Effect, Schema } from "effect"
import { AgentError } from "../domain"
import type {
  ApiKeyHealth,
  ApiKeySummary as StoredApiKeySummary,
  EncryptedCredentialRepository,
} from "../auth/EncryptedCredentialRepository"
import type { IntegrationService } from "./IntegrationService"
import type { PiModelService } from "./pi"

export type PublicApiKeySummary = {
  id: Credential.ID
  providerId: Provider.ID
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  priority: number
  health: {
    status: ApiKeyHealth["status"]
    lastTestedAt?: number
    lastUsedAt?: number
    errorCategory?: NonNullable<ApiKeyHealth["errorCategory"]>
    cooldownUntil?: number
  }
  createdAt: number
  updatedAt: number
}

type FailureCategory = "authentication" | "rate-limit" | "network" | "unknown"

const valueAt = (value: unknown, key: string): unknown =>
  value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined

const statusCode = (cause: unknown): number | undefined => {
  const direct = valueAt(cause, "statusCode") ?? valueAt(cause, "status")
  if (typeof direct === "number") return direct
  const nested = valueAt(cause, "cause")
  return nested === cause ? undefined : statusCode(nested)
}

const failureCategory = (cause: unknown): FailureCategory => {
  const status = statusCode(cause)
  if (status === 401 || status === 403) return "authentication"
  if (status === 429) return "rate-limit"
  if (cause instanceof TypeError || /network|fetch|socket|connect|timeout/i.test(cause instanceof Error ? cause.message : "")) return "network"
  return "unknown"
}

export class ApiKeyService {
  constructor(
    private readonly providers: PiModelService,
    private readonly integrations: IntegrationService,
    private readonly credentials: EncryptedCredentialRepository,
  ) {}

  async list(providerID?: string): Promise<PublicApiKeySummary[]> {
    const mappings = await this.providerMappings()
    const integrationID = providerID ? await this.integrationID(providerID) : undefined
    return this.credentials.listApiKeys(integrationID)
      .filter((summary) => !summary.integrationID.startsWith("usage."))
      .map((summary) =>
      this.publicSummary(summary, mappings.get(summary.integrationID) ?? Provider.ID.make(summary.integrationID)))
  }

  async create(input: { providerID: string; label: string; key: string }) {
    const integrationID = await this.integrationID(input.providerID, true)
    const summary = await Effect.runPromise(this.credentials.createApiKey({
      integrationID,
      label: input.label,
      key: input.key,
    }))
    return this.publicSummary(summary, Provider.ID.make(input.providerID))
  }

  async update(input: { credentialID: string; label?: string; key?: string }) {
    let summary = this.requiredSummary(input.credentialID)
    if (input.label !== undefined) summary = await Effect.runPromise(this.credentials.renameApiKey(input.credentialID, input.label))
    if (input.key !== undefined) summary = await Effect.runPromise(this.credentials.replaceApiKey(input.credentialID, input.key))
    const providerID = (await this.providerMappings()).get(summary.integrationID) ?? Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async setActive(providerID: string, credentialID: string) {
    const integrationID = await this.integrationID(providerID, true)
    const summary = await Effect.runPromise(this.credentials.setActive(integrationID, credentialID))
    return this.publicSummary(summary, Provider.ID.make(providerID))
  }

  async setEnabled(credentialID: string, enabled: boolean) {
    this.requiredSummary(credentialID)
    const summary = await Effect.runPromise(this.credentials.setEnabled(credentialID, enabled))
    const providerID = (await this.providerMappings()).get(summary.integrationID) ?? Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async reorder(providerID: string, credentialIDs: readonly string[]) {
    const integrationID = await this.integrationID(providerID, true)
    const summaries = await Effect.runPromise(this.credentials.reorder(integrationID, credentialIDs))
    return summaries.map((summary) => this.publicSummary(summary, Provider.ID.make(providerID)))
  }

  async delete(credentialID: string) {
    const summary = this.requiredSummary(credentialID)
    await Effect.runPromise(this.credentials.deleteApiKey(credentialID))
    const providerID = (await this.providerMappings()).get(summary.integrationID) ?? Provider.ID.make(summary.integrationID)
    return this.credentials.listApiKeys(summary.integrationID).map((item) => this.publicSummary(item, providerID))
  }

  async test(credentialID: string): Promise<PublicApiKeySummary> {
    const summary = this.requiredSummary(credentialID)
    const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(credentialID))
    if (!stored || stored.kind !== "api-key" || !Schema.is(Credential.Key)(stored.value)) {
      throw new AgentError("CREDENTIAL_NOT_FOUND", "未找到可测试的 API Key", 404)
    }
    const providerID = (await this.providerMappings()).get(summary.integrationID) ?? Provider.ID.make(summary.integrationID)
    const model = (await this.providers.models()).find((candidate) => candidate.providerID === providerID && candidate.enabled)
    if (!model) throw new AgentError("PROVIDER_UNAVAILABLE", `Provider ${providerID} 没有可用模型`, 409)
    const testedAt = Date.now()
    try {
      const piModel = await this.providers.getPiModel({
        providerID,
        id: model.id,
      })
      const response = await this.providers.pi.completeSimple(
        piModel,
        {
          messages: [{
            role: "user",
            content: "Reply OK.",
            timestamp: Date.now(),
          }],
        },
        {
          apiKey: stored.value.key,
          maxTokens: 8,
          signal: AbortSignal.timeout(15_000),
          maxRetries: 0,
        },
      )
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage ?? "API Key 测试请求失败")
      }
      await Effect.runPromise(this.credentials.updateHealth(credentialID, {
        status: "healthy",
        lastTestedAt: testedAt,
        lastUsedAt: testedAt,
        lastErrorCategory: null,
        cooldownUntil: null,
      }))
    } catch (cause) {
      const category = failureCategory(cause)
      await Effect.runPromise(this.credentials.updateHealth(credentialID, {
        status: category === "authentication" ? "auth-failed" : category === "rate-limit" ? "rate-limited" : "error",
        lastTestedAt: testedAt,
        lastErrorCategory: category,
        cooldownUntil: category === "rate-limit" ? testedAt + 60_000 : null,
      }))
      throw new AgentError(
        category === "authentication" ? "AUTHORIZATION_FAILED" : category === "rate-limit" ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
        category === "authentication" ? "API Key 鉴权失败" : category === "rate-limit" ? "API Key 当前受到限流" : "API Key 测试请求失败",
        category === "authentication" ? 401 : category === "rate-limit" ? 429 : 502,
      )
    }
    return (await this.list(String(providerID))).find((item) => item.id === credentialID)!
  }

  async copyMaterial(credentialID: string): Promise<string> {
    this.requiredSummary(credentialID)
    const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(credentialID))
    if (!stored || stored.kind !== "api-key" || !Schema.is(Credential.Key)(stored.value)) {
      throw new AgentError("CREDENTIAL_NOT_FOUND", "未找到可复制的 API Key", 404)
    }
    return stored.value.key
  }

  private requiredSummary(credentialID: string) {
    const summary = this.credentials.listApiKeys().find((item) =>
      item.id === credentialID && !item.integrationID.startsWith("usage."))
    if (!summary) throw new AgentError("CREDENTIAL_NOT_FOUND", "未找到 API Key", 404)
    return summary
  }

  private async providerMappings() {
    const result = new Map<string, Provider.ID>()
    for (const provider of await this.providers.list()) {
      const integrationID = String(provider.integrationID ?? provider.id)
      if (!result.has(integrationID)) result.set(integrationID, provider.id)
    }
    return result
  }

  private async integrationID(providerID: string, requireKeyMethod = false) {
    const provider = (await this.providers.list()).find((item) => String(item.id) === providerID)
    if (!provider) throw new AgentError("INTEGRATION_NOT_FOUND", `未找到 Provider ${providerID}`, 404)
    const integrationID = String(provider.integrationID ?? provider.id)
    if (requireKeyMethod) {
      const integration = (await this.integrations.list()).find((item) => String(item.id) === integrationID)
      if (!integration?.methods.some((method) => method.type === "key")) {
        throw new AgentError("INTEGRATION_NOT_FOUND", `Provider ${providerID} 不支持 API Key`, 400)
      }
    }
    return integrationID
  }

  private publicSummary(summary: StoredApiKeySummary, providerId: Provider.ID): PublicApiKeySummary {
    return {
      id: Credential.ID.make(summary.id),
      providerId,
      label: summary.label,
      maskedValue: summary.maskedValue,
      enabled: summary.enabled,
      active: summary.active,
      priority: summary.priority,
      health: {
        status: summary.health.status,
        ...(summary.health.lastTestedAt === null ? {} : { lastTestedAt: summary.health.lastTestedAt }),
        ...(summary.health.lastUsedAt === null ? {} : { lastUsedAt: summary.health.lastUsedAt }),
        ...(summary.health.errorCategory === null ? {} : { errorCategory: summary.health.errorCategory }),
        ...(summary.health.cooldownUntil === null ? {} : { cooldownUntil: summary.health.cooldownUntil }),
      },
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }
  }
}
