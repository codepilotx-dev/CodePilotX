/**
 * Beta Session Tracing for CodePilotX
 *
 * NO-OP FACADE: All beta session tracing has been removed.
 * All public exports are preserved so callers don't need updating.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isEnvTruthy } from '../envUtils.js'
import { jsonStringify } from '../slowOperations.js'

/**
 * Check if beta tracing is enabled — always returns false.
 */
export function isBetaTracingEnabled(): boolean {
  return false
}

/**
 * Truncate content to max length — returns original content unchanged.
 */
export function truncateContent(
  content: string,
  _maxLen?: number,
): string {
  return content
}

/**
 * LLMRequestNewContext type — kept for compatibility.
 */
export interface LLMRequestNewContext {
  toolUses?: number
  toolResults?: number
  totalToolDurationMs?: number
  truncatedMessages?: unknown[]
  hasSystemPromptResult?: boolean
  newContext?: unknown
}

/**
 * Clear beta tracing state — no-op.
 */
export function clearBetaTracingState(): void {
  // No-op
}

/**
 * Add beta interaction attributes — no-op.
 */
export function addBetaInteractionAttributes(
  _userPrompt: string,
): void {
  // No-op
}

/**
 * Add beta LLM request attributes — no-op.
 */
export function addBetaLLMRequestAttributes(
  _newContext?: LLMRequestNewContext,
): void {
  // No-op
}

/**
 * Add beta LLM response attributes — no-op.
 */
export function addBetaLLMResponseAttributes(
  _rawResponse?: unknown,
  _model?: string,
): void {
  // No-op
}

/**
 * Add beta tool input attributes — no-op.
 */
export function addBetaToolInputAttributes(
  _toolName: string,
  _toolInput?: unknown,
): void {
  // No-op
}

/**
 * Add beta tool result attributes — no-op.
 */
export function addBetaToolResultAttributes(
  _toolOutput?: string,
): void {
  // No-op
}
