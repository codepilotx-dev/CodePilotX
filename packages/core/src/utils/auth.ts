/**
 * Auth utilities for @codepilotx/core.
 *
 * This shim delegates to the app runtime (configured during app startup)
 * rather than importing directly from the TUI or Desktop layer, keeping
 * packages/core free of reverse dependencies.
 */

import { requireCoreAppRuntime } from '../runtime/appRuntime.js'
import type { CoreAccountInfo } from '../runtime/appRuntime.js'
import type { SubscriptionType } from '../services/oauth/types.js'

export function hasProfileScope(): boolean {
  return requireCoreAppRuntime().auth.hasProfileScope()
}

export function isClaudeAISubscriber(): boolean {
  return requireCoreAppRuntime().auth.isClaudeAISubscriber()
}

export async function saveApiKey(apiKey: string): Promise<void> {
  return requireCoreAppRuntime().auth.saveApiKey(apiKey)
}

export function getAnthropicApiKey(): string | null {
  return requireCoreAppRuntime().auth.getAnthropicApiKey()
}

export function getAuthTokenSource(): { source: string; hasToken: boolean } {
  return requireCoreAppRuntime().auth.getAuthTokenSource()
}

export function getOauthAccountInfo(): CoreAccountInfo | undefined {
  return requireCoreAppRuntime().auth.getOauthAccountInfo()
}

export function hasAnthropicApiKeyAuth(): boolean {
  return requireCoreAppRuntime().auth.hasAnthropicApiKeyAuth()
}
