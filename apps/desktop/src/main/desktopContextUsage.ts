import { getSdkBetas } from '@claudecode/tui/bootstrap/state.js'
import { getContextWindowForModel } from '@claudecode/tui/utils/context.js'
import type { DesktopContextUsage } from '../shared/types.js'

type UsageLike = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
}

export function buildDesktopContextUsage(params: {
  model: string
  usage: UsageLike
  provider?: string | null
}): DesktopContextUsage | null {
  const inputTokens = numberOrZero(params.usage.input_tokens)
  const outputTokens = numberOrZero(params.usage.output_tokens)
  const cacheCreationInputTokens = numberOrZero(
    params.usage.cache_creation_input_tokens,
  )
  const cacheReadInputTokens = numberOrZero(
    params.usage.cache_read_input_tokens,
  )

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheCreationInputTokens === 0 &&
    cacheReadInputTokens === 0
  ) {
    return null
  }

  const contextWindow = getContextWindowForModel(params.model, getSdkBetas())
  const usedTokens =
    inputTokens +
    outputTokens +
    cacheCreationInputTokens +
    cacheReadInputTokens
  const remainingTokens = Math.max(0, contextWindow - usedTokens)
  const usedPercent = clampPercent(
    Math.round((usedTokens / contextWindow) * 100),
  )

  return {
    model: params.model,
    provider:
      params.provider === undefined
        ? inferProviderFromModel(params.model)
        : params.provider || undefined,
    contextWindow,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    usedTokens,
    remainingTokens,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  }
}

export function inferProviderFromModel(model: string): string | undefined {
  const normalized = model.trim().toLowerCase()
  if (!normalized || normalized === 'unknown') return undefined
  const slash = normalized.indexOf('/')
  if (slash > 0) return normalized.slice(0, slash)
  if (normalized.startsWith('minimax-')) return 'minimax'
  if (normalized.startsWith('deepseek-')) return 'deepseek'
  if (normalized.startsWith('claude-')) return 'anthropic'
  return undefined
}

export function getUsageFromAssistantRecord(
  message: Record<string, unknown>,
): { model: string; usage: UsageLike } | null {
  const wrappedMessage = message.message
  if (!wrappedMessage || typeof wrappedMessage !== 'object') {
    return null
  }
  const record = wrappedMessage as Record<string, unknown>
  if (!record.usage || typeof record.usage !== 'object') {
    return null
  }
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model
      : 'unknown'
  return { model, usage: record.usage as UsageLike }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}
