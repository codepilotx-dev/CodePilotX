import type { Model } from "@codepilotx/model-schema"
import type { BundledSDK, ProviderLoader } from "./types"

// Keep every import specifier literal so `bun build --compile` can collect it.
// Catalog/config package names are only used as keys into this allowlist.
export const BUNDLED_PROVIDERS: Readonly<Record<string, ProviderLoader>> = Object.freeze({
  "@ai-sdk/amazon-bedrock": () => import("@ai-sdk/amazon-bedrock").then((module) => module.createAmazonBedrock),
  "@ai-sdk/amazon-bedrock/mantle": () => import("@ai-sdk/amazon-bedrock/mantle").then((module) => module.createBedrockMantle),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then((module) => module.createAnthropic),
  "@ai-sdk/azure": () => import("@ai-sdk/azure").then((module) => module.createAzure),
  "@ai-sdk/google": () => import("@ai-sdk/google").then((module) => module.createGoogleGenerativeAI),
  "@ai-sdk/google-vertex": () => import("@ai-sdk/google-vertex").then((module) => module.createVertex),
  "@ai-sdk/google-vertex/anthropic": () => import("@ai-sdk/google-vertex/anthropic").then((module) => module.createVertexAnthropic),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((module) => module.createOpenAI),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible").then((module) => module.createOpenAICompatible),
  "@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider").then((module) => module.createOpenRouter),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((module) => module.createXai),
  "@ai-sdk/mistral": () => import("@ai-sdk/mistral").then((module) => module.createMistral),
  "@ai-sdk/groq": () => import("@ai-sdk/groq").then((module) => module.createGroq),
  "@ai-sdk/deepinfra": () => import("@ai-sdk/deepinfra").then((module) => module.createDeepInfra),
  "@ai-sdk/cerebras": () => import("@ai-sdk/cerebras").then((module) => module.createCerebras),
  "@ai-sdk/cohere": () => import("@ai-sdk/cohere").then((module) => module.createCohere),
  "@ai-sdk/gateway": () => import("@ai-sdk/gateway").then((module) => module.createGateway),
  "@ai-sdk/togetherai": () => import("@ai-sdk/togetherai").then((module) => module.createTogetherAI),
  "@ai-sdk/perplexity": () => import("@ai-sdk/perplexity").then((module) => module.createPerplexity),
  "@ai-sdk/vercel": () => import("@ai-sdk/vercel").then((module) => module.createVercel),
  "@ai-sdk/alibaba": () => import("@ai-sdk/alibaba").then((module) => module.createAlibaba),
  "gitlab-ai-provider": () => import("gitlab-ai-provider").then((module) => module.createGitLab),
  "@ai-sdk/github-copilot": () => import("@ai-sdk/openai-compatible").then((module) => module.createOpenAICompatible),
  "venice-ai-sdk-provider": () => import("venice-ai-sdk-provider").then((module) => module.createVenice),
  "@jerome-benoit/sap-ai-provider-v2": () => import("@jerome-benoit/sap-ai-provider-v2").then((module) => (options: any) => {
    const provider = module.createSAPAIProvider(options)
    return { languageModel: (modelID: string) => provider.languageModel(modelID) as never }
  }),
})

export function selectLanguageModel(sdk: BundledSDK, model: Model.Info) {
  const npm = model.api.type === "aisdk" ? model.api.package : ""
  const id = model.api.id
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/xai") return sdk.responses?.(id) ?? sdk.languageModel(id)
  if (npm === "@ai-sdk/azure") return sdk.responses?.(id) ?? sdk.messages?.(id) ?? sdk.chat?.(id) ?? sdk.languageModel(id)
  if (npm === "@ai-sdk/amazon-bedrock/mantle") {
    const safeguard = id === "openai.gpt-oss-safeguard-20b" || id === "openai.gpt-oss-safeguard-120b"
    return safeguard ? sdk.chat?.(id) ?? sdk.languageModel(id) : sdk.responses?.(id) ?? sdk.languageModel(id)
  }
  if (npm === "@ai-sdk/github-copilot") {
    if (id.startsWith("gpt-5") && !id.startsWith("gpt-5-mini")) return sdk.responses?.(id) ?? sdk.chat?.(id) ?? sdk.languageModel(id)
    return sdk.chat?.(id) ?? sdk.languageModel(id)
  }
  return sdk.languageModel(id)
}
