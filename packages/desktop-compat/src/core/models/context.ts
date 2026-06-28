export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

export function getContextWindowForModel(model: string): number {
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

  const knownThirdPartyWindow = getKnownThirdPartyContextWindow(model)
  if (knownThirdPartyWindow !== undefined) {
    return knownThirdPartyWindow
  }

  return MODEL_CONTEXT_WINDOW_DEFAULT
}

function getKnownThirdPartyContextWindow(model: string): number | undefined {
  const normalized = model.toLowerCase()
  if (normalized.includes('gpt-4.1')) return 1_000_000
  if (normalized.includes('gpt-4o')) return 128_000
  if (normalized.includes('gpt-oss-120b')) return 131_072
  if (normalized.includes('llama-3.3-70b')) return 131_072
  if (normalized.includes('deepseek')) return 64_000
  return undefined
}
