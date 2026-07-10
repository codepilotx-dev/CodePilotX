import { getContextWindowForModel } from '@codepilotx/core/models/context.js'
import type { DesktopContextUsage } from '../shared/types.js'

type UsageLike = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
  reasoning_tokens?: unknown
  prompt_cache_hit_tokens?: unknown
  prompt_cache_miss_tokens?: unknown
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
  const reasoningTokens = numberOrZero(params.usage.reasoning_tokens)
  const promptCacheHitTokens = numberOrZero(
    params.usage.prompt_cache_hit_tokens,
  )
  const promptCacheMissTokens = numberOrZero(
    params.usage.prompt_cache_miss_tokens,
  )

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheCreationInputTokens === 0 &&
    cacheReadInputTokens === 0 &&
    reasoningTokens === 0 &&
    promptCacheHitTokens === 0 &&
    promptCacheMissTokens === 0
  ) {
    return null
  }

  const provider =
    params.provider === undefined
      ? inferProviderFromModel(params.model)
      : params.provider || undefined
  const contextWindow = getContextWindowForModel(params.model, provider)
  const hasOpenAICompatibleUsageDetails =
    params.usage.reasoning_tokens !== undefined ||
    params.usage.prompt_cache_hit_tokens !== undefined ||
    params.usage.prompt_cache_miss_tokens !== undefined
  const usedTokens =
    inputTokens +
    outputTokens +
    (hasOpenAICompatibleUsageDetails
      ? 0
      : cacheCreationInputTokens + cacheReadInputTokens)
  const remainingTokens = Math.max(0, contextWindow - usedTokens)
  const usedPercent = clampPercent(
    Math.round((usedTokens / contextWindow) * 100),
  )

  return {
    model: params.model,
    provider,
    contextWindow,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
    usedTokens,
    remainingTokens,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  }
}

/**
 * Build a DesktopContextUsage from Rust-sidecar TokenUsage fields.
 *
 * This is the preferred entry point for the Rust app-server notification path
 * (`thread/tokenUsage/updated`). It accepts camelCase Rust protocol field names
 * directly and maps them to the renderer-expected DesktopContextUsage shape.
 *
 * Mapping rules:
 *   inputTokens           → inputTokens
 *   outputTokens          → outputTokens
 *   cachedInputTokens     → promptCacheHitTokens, cacheReadInputTokens
 *   max(0, inputTokens - cachedInputTokens) → promptCacheMissTokens
 *   reasoningOutputTokens → reasoningTokens
 *   usedTokens            = inputTokens + outputTokens
 *   contextWindow         = getContextWindowForModel(model, provider)
 */
export function buildDesktopContextUsageFromRustTokenUsage(params: {
  model: string
  provider?: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}): DesktopContextUsage | null {
  const { model, provider } = params
  const inputTokens = numberOrZero(params.inputTokens)
  const cachedInputTokens = numberOrZero(params.cachedInputTokens)
  const outputTokens = numberOrZero(params.outputTokens)
  const reasoningTokens = numberOrZero(params.reasoningOutputTokens)
  const promptCacheHitTokens = cachedInputTokens
  const cacheReadInputTokens = cachedInputTokens
  const promptCacheMissTokens = Math.max(0, inputTokens - cachedInputTokens)
  const totalTokens = numberOrZero(params.totalTokens)

  // Return null if there is nothing meaningful to display
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cachedInputTokens === 0 &&
    reasoningTokens === 0
  ) {
    return null
  }

  const resolvedProvider =
    provider === undefined
      ? inferProviderFromModel(model)
      : provider || undefined
  const contextWindow = getContextWindowForModel(model, resolvedProvider)
  const usedTokens = inputTokens + outputTokens
  const remainingTokens = Math.max(0, contextWindow - usedTokens)
  const usedPercent = clampPercent(
    Math.round((usedTokens / contextWindow) * 100),
  )

  return {
    model,
    provider: resolvedProvider,
    contextWindow,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens,
    reasoningTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
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
