import { Credential, Provider } from "@codepilotx/model-schema"
import { Effect, Schema } from "effect"
import { AgentError } from "../domain"
import type {
  ApiKeyHealth,
  ApiKeySummary as StoredApiKeySummary,
  ProviderCredentialRepository,
} from "../auth/ProviderCredentialRepository"
import { secretScrubber } from "../security/SecretScrubber"
import type { PiModelService } from "./pi"

export type PublicApiKeySummary = {
  id: Credential.ID
  providerId: Provider.ID
  kind: "api-key"
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  order: number
  health: {
    status: ApiKeyHealth["status"]
    lastTestedAt?: number
    errorCategory?: NonNullable<ApiKeyHealth["errorCategory"]>
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
  const message = cause instanceof Error ? cause.message : ""
  if (status === 401 || status === 403) return "authentication"
  if (status === 429) return "rate-limit"
  if (
    /\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication failed|(?:invalid|incorrect)[\s_-]+api[\s_-]*key|api[\s_-]*key[\s_-]+(?:invalid|incorrect)/i.test(message)
  ) return "authentication"
  if (/\b429\b|rate[\s_-]?limit/i.test(message)) return "rate-limit"
  if (cause instanceof TypeError || /network|fetch|socket|dns|connect|timeout|timed?\s*out/i.test(message)) return "network"
  return "unknown"
}

const failurePrefix = (category: FailureCategory) => {
  switch (category) {
    case "authentication":
      return "API Key 鉴权失败"
    case "rate-limit":
      return "API Key 当前受到限流"
    case "network":
      return "API Key 网络请求失败"
    default:
      return "API Key 测试失败"
  }
}

const formatTestFailure = (category: FailureCategory, cause: unknown, apiKey: string) => {
  const prefix = failurePrefix(category)
  if (!(cause instanceof Error)) return prefix
  const withoutCurrentKey = apiKey ? cause.message.split(apiKey).join("<redacted>") : cause.message
  const detail = secretScrubber.scrubText(withoutCurrentKey).replace(/\s+/g, " ").trim().slice(0, 500)
  return detail ? `${prefix}：${detail}` : prefix
}

export type PublicApiKeyTestResult = {
  credential: PublicApiKeySummary
  ok: boolean
  message: string
}

export class ApiKeyService {
  constructor(
    private readonly providers: PiModelService,
    private readonly credentials: ProviderCredentialRepository,
  ) {}

  async list(providerID?: string): Promise<PublicApiKeySummary[]> {
    if (providerID) await this.requiredProviderID(providerID)
    return this.credentials.listApiKeys(providerID)
      .filter((summary) => !summary.integrationID.startsWith("usage."))
      .map((summary) =>
        this.publicSummary(summary, Provider.ID.make(summary.integrationID)))
  }

  async create(input: { providerID: string; label: string; key: string }) {
    const integrationID = await this.requiredProviderID(input.providerID, true)
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
    const providerID = Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async setActive(providerID: string, credentialID: string) {
    const integrationID = await this.requiredProviderID(providerID, true)
    const summary = await Effect.runPromise(this.credentials.setActive(integrationID, credentialID))
    return this.publicSummary(summary, Provider.ID.make(providerID))
  }

  async setEnabled(credentialID: string, enabled: boolean) {
    this.requiredSummary(credentialID)
    const summary = await Effect.runPromise(this.credentials.setEnabled(credentialID, enabled))
    const providerID = Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async reorder(providerID: string, credentialIDs: readonly string[]) {
    const integrationID = await this.requiredProviderID(providerID, true)
    const summaries = await Effect.runPromise(this.credentials.reorder(integrationID, credentialIDs))
    return summaries.map((summary) => this.publicSummary(summary, Provider.ID.make(providerID)))
  }

  async delete(credentialID: string) {
    const summary = this.requiredSummary(credentialID)
    await Effect.runPromise(this.credentials.deleteApiKey(credentialID))
    const providerID = Provider.ID.make(summary.integrationID)
    return this.credentials.listApiKeys(summary.integrationID).map((item) => this.publicSummary(item, providerID))
  }

  async test(credentialID: string): Promise<PublicApiKeyTestResult> {
    const summary = this.requiredSummary(credentialID)
    const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(credentialID))
    if (!stored || stored.kind !== "api-key" || !Schema.is(Credential.Key)(stored.value)) {
      throw new AgentError("CREDENTIAL_NOT_FOUND", "未找到可测试的 API Key", 404)
    }
    const providerID = Provider.ID.make(summary.integrationID)
    const model = (await this.providers.models()).find((candidate) => candidate.providerID === providerID && candidate.enabled)
    if (!model) {
      return {
        credential: this.publicSummary(summary, providerID),
        ok: false,
        message: `配置不可用：Provider ${providerID} 没有可用模型`,
      }
    }
    const piModel = await this.providers.getPiModel({
      providerID,
      id: model.id,
    })
    const testedAt = Date.now()
    try {
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
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(response.errorMessage ?? "")
      }
    } catch (cause) {
      const category = failureCategory(cause)
      await Effect.runPromise(this.credentials.updateHealth(credentialID, {
        status: category === "authentication" ? "auth-failed" : category === "rate-limit" ? "rate-limited" : "error",
        lastTestedAt: testedAt,
        lastErrorCategory: category,
        cooldownUntil: null,
      }))
      const credential = (await this.list(String(providerID))).find((item) => item.id === credentialID)!
      return {
        credential,
        ok: false,
        message: formatTestFailure(category, cause, stored.value.key),
      }
    }
    await Effect.runPromise(this.credentials.updateHealth(credentialID, {
      status: "healthy",
      lastTestedAt: testedAt,
      lastErrorCategory: null,
      cooldownUntil: null,
    }))
    return {
      credential: (await this.list(String(providerID))).find((item) => item.id === credentialID)!,
      ok: true,
      message: "API Key 可用。",
    }
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

  private async requiredProviderID(providerID: string, requireKeyMethod = false) {
    const provider = (await this.providers.list()).find((item) => String(item.id) === providerID)
    if (!provider) throw new AgentError("PROVIDER_NOT_FOUND", `未找到 Provider ${providerID}`, 404)
    if (requireKeyMethod && !provider.auth.apiKey) {
      throw new AgentError("PROVIDER_UNAVAILABLE", `Provider ${providerID} 不支持 API Key`, 400)
    }
    return providerID
  }

  private publicSummary(summary: StoredApiKeySummary, providerId: Provider.ID): PublicApiKeySummary {
    return {
      id: Credential.ID.make(summary.id),
      providerId,
      kind: "api-key",
      label: summary.label,
      maskedValue: summary.maskedValue,
      enabled: summary.enabled,
      active: summary.active,
      order: summary.priority,
      health: {
        status: summary.health.status,
        ...(summary.health.lastTestedAt === null ? {} : { lastTestedAt: summary.health.lastTestedAt }),
        ...(summary.health.errorCategory === null ? {} : { errorCategory: summary.health.errorCategory }),
      },
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }
  }
}
