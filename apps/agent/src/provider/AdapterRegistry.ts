import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { Effect } from "effect"
import { AgentError, type ResolvedModel } from "../domain"
import type { CredentialStore } from "../auth/CredentialStore"

export class AdapterRegistry {
  constructor(private readonly credentials: CredentialStore) {}

  resolve(model: ResolvedModel): Effect.Effect<LanguageModel, AgentError> {
    return Effect.flatMap(this.credentials.get(model.providerID), (apiKey) => Effect.try({
      try: () => {
        if (!apiKey) throw new AgentError("PROVIDER_NOT_CONFIGURED", `请先配置 ${model.providerID} 的 API Key`, 409)
        const options = { apiKey, ...(model.baseURL ? { baseURL: model.baseURL } : {}), ...(model.headers ? { headers: model.headers } : {}) }
        switch (model.protocol) {
          case "openai": return createOpenAI(options)(model.modelID)
          case "anthropic": return createAnthropic(options)(model.modelID)
          case "openai-compatible": {
            if (!model.baseURL) throw new AgentError("BASE_URL_REQUIRED", "OpenAI-Compatible Provider 必须配置 baseURL", 400)
            return createOpenAICompatible({ name: model.providerID, baseURL: model.baseURL, apiKey, ...(model.headers ? { headers: model.headers } : {}) })(model.modelID)
          }
        }
      },
      catch: (cause) => cause instanceof AgentError ? cause : new AgentError("MODEL_ADAPTER_FAILED", "模型适配器创建失败", 500, cause),
    }))
  }
}
