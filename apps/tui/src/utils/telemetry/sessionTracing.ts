/**
 * Session Tracing for CodePilotX
 *
 * NO-OP FACADE: All OpenTelemetry session tracing has been removed.
 * All public exports are preserved so callers don't need updating.
 */

import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isBetaTracingEnabled } from './betaSessionTracing.js'
import { isPerfettoTracingEnabled } from './perfettoTracing.js'

// Inline Span type since @opentelemetry/api is removed
export type Span = { end: () => void; isRecording: () => boolean }

// Re-export for callers
export { isBetaTracingEnabled }

/**
 * LLMRequestNewContext type definition
 */
export type LLMRequestNewContext = {
  toolUses?: number
  toolResults?: number
  truncatedMessages?: AssistantMessage[] | UserMessage[]
  hasSystemPromptResult?: boolean
  totalToolDurationMs?: number
}

/**
 * Check if enhanced telemetry is enabled — always returns false.
 */
export function isEnhancedTelemetryEnabled(): boolean {
  return false
}

/**
 * Start an interaction span — returns a no-op span.
 */
export function startInteractionSpan(_userPrompt: string): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * End an interaction span — no-op.
 */
export function endInteractionSpan(): void {
  // No-op
}

/**
 * Start an LLM request span — returns a no-op span.
 */
export function startLLMRequestSpan(
  _params: unknown,
  _newContext?: LLMRequestNewContext,
): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * End an LLM request span — no-op.
 */
export function endLLMRequestSpan(
  _rawResponse?: unknown,
  _model?: string,
): void {
  // No-op
}

/**
 * Start a tool span — returns a no-op span.
 */
export function startToolSpan(
  _toolName: string,
  _toolInput?: unknown,
): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * Start a tool blocked-on-user span — returns a no-op span.
 */
export function startToolBlockedOnUserSpan(): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * End a tool blocked-on-user span — no-op.
 */
export function endToolBlockedOnUserSpan(
  _toolResult?: string,
): void {
  // No-op
}

/**
 * Start a tool execution span — returns a no-op span.
 */
export function startToolExecutionSpan(): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * End a tool execution span — no-op.
 */
export function endToolExecutionSpan(
  _metadata?: {
    durationMs?: number
    toolUseId?: string
    wasCached?: boolean
  },
): void {
  // No-op
}

/**
 * End a tool span — no-op.
 */
export function endToolSpan(
  _toolResult?: string,
  _resultTokens?: number,
): void {
  // No-op
}

/**
 * Add tool content event — no-op.
 */
export function addToolContentEvent(
  _toolName: string,
  _contentType: string,
  _content?: string,
): void {
  // No-op
}

/**
 * Get the current span — returns null.
 */
export function getCurrentSpan(): Span | null {
  return null
}

/**
 * Execute a function within a span — runs the function without tracing.
 */
export async function executeInSpan<T>(
  _spanName: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fn()
}

/**
 * Start a hook span — returns a no-op span.
 */
export function startHookSpan(
  _hookEvent: string,
  _toolUseId: string,
): Span {
  return { end: () => {}, isRecording: () => false }
}

/**
 * End a hook span — no-op.
 */
export function endHookSpan(
  _hookEvent?: string,
  _toolUseId?: string,
  _isError?: boolean,
): void {
  // No-op
}
