import { getProviderModelMetadata } from './providerConfig.js'

export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

const DEEPSEEK_1M_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-reasoner',
  'deepseek-chat',
])

export function getContextWindowForModel(
  model: string,
  provider?: string,
): number {
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  ) {
    const override = parseInt(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, 10)
    if (!Number.isNaN(override) && override > 0) {
      return override
    }
  }

  if (/\[1m\]/i.test(model)) {
    return 1_000_000
  }

  // Prioritize provider catalog metadata when provider is known.
  // The catalog cache is populated during session init / settings page.
  if (provider) {
    try {
      const metadata = getProviderModelMetadata(provider, model)
      if (metadata?.contextWindow && metadata.contextWindow > 0) {
        return metadata.contextWindow
      }
    } catch {
      // Silently fall through to hardcoded patterns
    }
  }

  const knownThirdPartyWindow = getKnownThirdPartyContextWindow(model, provider)
  if (knownThirdPartyWindow !== undefined) {
    return knownThirdPartyWindow
  }

  return MODEL_CONTEXT_WINDOW_DEFAULT
}

function getKnownThirdPartyContextWindow(
  model: string,
  provider?: string,
): number | undefined {
  const normalized = model.toLowerCase()

  // Support provider-prefixed model names (e.g., "deepseek/deepseek-v4-flash")
  if (normalized.includes('/')) {
    const modelName = normalized.split('/').pop()!
    if (DEEPSEEK_1M_MODELS.has(modelName)) {
      return 1_000_000
    }
  }

  if (normalized.includes('gpt-4.1')) return 1_000_000
  if (normalized.includes('gpt-4o')) return 128_000
  if (normalized.includes('gpt-oss-120b')) return 131_072
  if (normalized.includes('llama-3.3-70b')) return 131_072

  // Exact DeepSeek model matching instead of generic catch-all
  // DeepSeek models currently all have 1M context per Models.dev
  if (DEEPSEEK_1M_MODELS.has(normalized)) {
    return 1_000_000
  }

  return undefined
}
