import { describe, expect, mock, test } from "bun:test"

const create = () => ({ languageModel: () => ({}) })
const modules: Record<string, Record<string, unknown>> = {
  "@ai-sdk/amazon-bedrock": { createAmazonBedrock: create },
  "@ai-sdk/amazon-bedrock/mantle": { createBedrockMantle: create },
  "@ai-sdk/anthropic": { createAnthropic: create },
  "@ai-sdk/azure": { createAzure: create },
  "@ai-sdk/google": { createGoogleGenerativeAI: create },
  "@ai-sdk/google-vertex": { createVertex: create },
  "@ai-sdk/google-vertex/anthropic": { createVertexAnthropic: create },
  "@ai-sdk/openai": { createOpenAI: create },
  "@ai-sdk/openai-compatible": { createOpenAICompatible: create },
  "@openrouter/ai-sdk-provider": { createOpenRouter: create },
  "@ai-sdk/xai": { createXai: create },
  "@ai-sdk/mistral": { createMistral: create },
  "@ai-sdk/groq": { createGroq: create },
  "@ai-sdk/deepinfra": { createDeepInfra: create },
  "@ai-sdk/cerebras": { createCerebras: create },
  "@ai-sdk/cohere": { createCohere: create },
  "@ai-sdk/gateway": { createGateway: create },
  "@ai-sdk/togetherai": { createTogetherAI: create },
  "@ai-sdk/perplexity": { createPerplexity: create },
  "@ai-sdk/vercel": { createVercel: create },
  "@ai-sdk/alibaba": { createAlibaba: create },
  "gitlab-ai-provider": { createGitLab: create },
  "venice-ai-sdk-provider": { createVenice: create },
  "@jerome-benoit/sap-ai-provider-v2": { createSAPAIProvider: create },
}

for (const [specifier, exports] of Object.entries(modules)) mock.module(specifier, () => exports)

describe("bundled provider registry", () => {
  test("loads every literal dynamic import", async () => {
    const { BUNDLED_PROVIDERS } = await import("../src/bundled")
    expect(Object.keys(BUNDLED_PROVIDERS)).toHaveLength(25)
    for (const [name, loader] of Object.entries(BUNDLED_PROVIDERS)) {
      expect(typeof await loader(), name).toBe("function")
    }
  })
})
