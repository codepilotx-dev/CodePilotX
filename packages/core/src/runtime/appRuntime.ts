/**
 * Core application runtime port.
 *
 * Provides a dependency-injection point for TUI and Desktop to supply
 * auth/config/settings implementations to packages/core without creating
 * reverse imports (core → TUI, core → Desktop).
 *
 * Usage:
 *   1. App entrypoint calls `configureCoreAppRuntime({...})` once at startup.
 *   2. Core shim files (`utils/auth.ts`, `utils/config.ts`,
 *      `utils/settings/settings.ts`) call `requireCoreAppRuntime()` to
 *      delegate to the injected implementation.
 *
 * This follows the same pattern as `services/mcp/configRuntime.ts`.
 */

import type {
  BillingType,
  OAuthTokens,
  SubscriptionType,
} from '../services/oauth/types.js'

// ─── Auth Runtime ─────────────────────────────────────────────────────────

/**
 * auth capabilities the core OAuth layer needs from the host application.
 *
 * TUI implements these by delegating to its auth utilities.
 * Desktop implements them with its own credential-reading logic.
 */
export type AuthRuntime = {
  checkAndRefreshOAuthTokenIfNeeded(
    retryCount?: number,
    force?: boolean,
  ): Promise<boolean>

  getClaudeAIOAuthTokens(): OAuthTokens | null

  hasProfileScope(): boolean

  isClaudeAISubscriber(): boolean

  saveApiKey(apiKey: string): Promise<void>

  getAnthropicApiKey(): string | null

  /** Source info for the current auth token. */
  getAuthTokenSource(): { source: string; hasToken: boolean }

  /** Account metadata from the OAuth profile. */
  getOauthAccountInfo(): CoreAccountInfo | undefined

  /** Whether an Anthropic API key is configured. */
  hasAnthropicApiKeyAuth(): boolean
}

// ─── Config Runtime ───────────────────────────────────────────────────────

/**
 * Minimal `AccountInfo` shape consumed by core OAuth code.
 *
 * Only the fields actually used in `packages/core/src/services/oauth/client.ts`
 * are listed here. The TUI adapter bridges to the full TUI type.
 */
export type CoreAccountInfo = {
  accountUuid?: string
  emailAddress?: string
  organizationUuid?: string
  organizationName?: string | null
  organizationRole?: string | null
  workspaceRole?: string | null
  displayName?: string
  hasExtraUsageEnabled?: boolean
  billingType?: BillingType | null
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
}

/**
 * Minimal `GlobalConfig` shape consumed by core OAuth code.
 */
export type CoreGlobalConfig = {
  oauthAccount?: CoreAccountInfo
  [key: string]: unknown
}

export type ConfigRuntime = {
  /** Called once before any config reads. */
  enableConfigs(): void
  /** Read current global config. */
  getGlobalConfig<T = CoreGlobalConfig>(): T
  /** Update global config via updater function. */
  saveGlobalConfig(
    updater: (current: CoreGlobalConfig) => CoreGlobalConfig,
  ): void
}

// ─── Settings Runtime ─────────────────────────────────────────────────────

export type SettingsJson = Record<string, unknown>

export type SettingsRuntime = {
  /** Merged user + project + policy settings (alias for getInitialSettings). */
  getSettings_DEPRECATED<T = SettingsJson>(): T | undefined
  /** Merged settings. */
  getInitialSettings<T = SettingsJson>(): T
  /** Settings for a specific source (user, project, local, policy, flag, etc.). */
  getSettingsForSource(source: string): SettingsJson | undefined
  /** Mutate a specific settings source via updater. */
  updateSettingsForSource(
    source: string,
    updater: (current: SettingsJson) => SettingsJson,
  ): void
}

// ─── Combined App Runtime ─────────────────────────────────────────────────

export type AppRuntime = {
  auth: AuthRuntime
  config: ConfigRuntime
  settings: SettingsRuntime
}

// ─── Module-level state ───────────────────────────────────────────────────

let runtime: AppRuntime | null = null

/**
 * Configure the core app runtime. Must be called once at startup before
 * any core auth/config/settings functions are used.
 *
 * In tests use {@link withCoreAppRuntime} for scoped injection.
 */
export function configureCoreAppRuntime(nextRuntime: AppRuntime): void {
  runtime = { ...nextRuntime }
}

/**
 * Temporarily override the runtime for the duration of `run()`.
 * Handles both sync and async callbacks.
 */
export function withCoreAppRuntime<T>(
  nextRuntime: AppRuntime,
  run: () => T,
): T {
  const previous = runtime
  runtime = { ...nextRuntime }
  try {
    const result = run()
    if (isPromiseLike(result)) {
      return (result as unknown as Promise<unknown>).finally(() => {
        runtime = previous
      }) as T
    }
    runtime = previous
    return result
  } catch (error) {
    runtime = previous
    throw error
  }
}

/**
 * Get the current runtime. Returns null if not configured.
 */
export function getCoreAppRuntime(): AppRuntime | null {
  return runtime
}

/**
 * Require the runtime to be configured; throws if not.
 */
export function requireCoreAppRuntime(): AppRuntime {
  if (!runtime) {
    throw new Error(
      'Core app runtime not configured. Call configureCoreAppRuntime() ' +
        'during app startup before using core auth/config/settings utilities.',
    )
  }
  return runtime
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}
