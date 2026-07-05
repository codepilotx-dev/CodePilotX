/**
 * GrowthBook feature flag service
 *
 * LOCAL-ONLY MODE: All remote GrowthBook SDK calls have been removed.
 * Feature flags resolve from the following priority order:
 *   1. Environment variable overrides (CLAUDE_INTERNAL_FC_OVERRIDES, ant-only)
 *   2. Local config overrides (/config Gates tab, ant-only)
 *   3. Disk cache (cachedGrowthBookFeatures from previous session)
 *   4. Default value provided by caller
 *
 * The public API surface is preserved so callers don't need updating.
 */

import { isEqual, memoize } from 'lodash-es'
import {
  getIsNonInteractiveSession,
  getSessionTrustAccepted,
} from '../../bootstrap/state.js'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { createSignal } from '../../utils/signal.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type GitHubActionsMetadata,
  getUserForGrowthBook,
} from '../../utils/user.js'

/**
 * User attributes sent to GrowthBook for targeting.
 * Uses UUID suffix (not Uuid) to align with GrowthBook conventions.
 */
export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: GitHubActionsMetadata
}

// Listeners notified when GrowthBook feature values refresh.
type GrowthBookRefreshListener = () => void | Promise<void>
const refreshed = createSignal()

/** Call a listener with sync-throw and async-rejection both routed to logError. */
function callSafe(listener: GrowthBookRefreshListener): void {
  try {
    void Promise.resolve(listener()).catch(e => {
      logError(e)
    })
  } catch (e) {
    logError(e)
  }
}

/**
 * Register a callback to fire when GrowthBook feature values refresh.
 * Returns an unsubscribe function.
 */
export function onGrowthBookRefresh(
  listener: GrowthBookRefreshListener,
): () => void {
  return refreshed.subscribe(() => callSafe(listener))
}

/**
 * Parse env var overrides for GrowthBook features.
 * Set CLAUDE_INTERNAL_FC_OVERRIDES to a JSON object mapping feature keys to values
 * to bypass remote eval and disk cache. Only active when USER_TYPE is 'ant'.
 */
let envOverrides: Record<string, unknown> | null = null
let envOverridesParsed = false

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true
    if (process.env.USER_TYPE === 'ant') {
      const raw = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
      if (raw) {
        try {
          envOverrides = JSON.parse(raw) as Record<string, unknown>
          logForDebugging(
            `GrowthBook: Using env var overrides for ${Object.keys(envOverrides!).length} features: ${Object.keys(envOverrides!).join(', ')}`,
          )
        } catch {
          logError(
            new Error(
              `GrowthBook: Failed to parse CLAUDE_INTERNAL_FC_OVERRIDES: ${raw}`,
            ),
          )
        }
      }
    }
  }
  return envOverrides
}

/**
 * Check if a feature has an env-var override (CLAUDE_INTERNAL_FC_OVERRIDES).
 */
export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

/**
 * Local config overrides set via /config Gates tab (ant-only).
 */
function getConfigOverrides(): Record<string, unknown> | undefined {
  if (process.env.USER_TYPE !== 'ant') return undefined
  try {
    return getGlobalConfig().growthBookOverrides
  } catch {
    return undefined
  }
}

/**
 * Enumerate all known GrowthBook features and their current resolved values
 * (not including overrides). In-memory payload first, disk cache fallback.
 */
export function getAllGrowthBookFeatures(): Record<string, unknown> {
  return getGlobalConfig().cachedGrowthBookFeatures ?? {}
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

/**
 * Set or clear a single config override. Pass undefined to clear.
 * Fires onGrowthBookRefresh listeners so systems that bake gate values into
 * long-lived objects rebuild.
 */
export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      const current = c.growthBookOverrides ?? {}
      if (value === undefined) {
        if (!(feature in current)) return c
        const { [feature]: _, ...rest } = current
        if (Object.keys(rest).length === 0) {
          const { growthBookOverrides: __, ...configWithout } = c
          return configWithout
        }
        return { ...c, growthBookOverrides: rest }
      }
      if (isEqual(current[feature], value)) return c
      return { ...c, growthBookOverrides: { ...current, [feature]: value } }
    })
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

export function clearGrowthBookConfigOverrides(): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      if (
        !c.growthBookOverrides ||
        Object.keys(c.growthBookOverrides).length === 0
      ) {
        return c
      }
      const { growthBookOverrides: _, ...rest } = c
      return rest
    })
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

/**
 * Check override sources (env vars → config overrides) before falling
 * through to the cache/default pathway.
 */
function checkOverrides<T>(
  feature: string,
): { found: true; value: T } | { found: false } {
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return { found: true, value: overrides[feature] as T }
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return { found: true, value: configOverrides[feature] as T }
  }
  return { found: false }
}

/**
 * Read a feature value from disk cache.
 */
function readFromCache<T>(feature: string, defaultValue: T): T {
  try {
    const cached = getGlobalConfig().cachedGrowthBookFeatures?.[feature]
    return cached !== undefined ? (cached as T) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Initialize GrowthBook — no-op. Returns null immediately since
 * remote feature fetching has been removed. Features resolve from
 * env overrides → config overrides → disk cache → default.
 */
export const initializeGrowthBook = memoize(async (): Promise<null> => {
  return null
})

/**
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE instead, which is non-blocking.
 */
export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  const overridden = checkOverrides<T>(feature)
  if (overridden.found) return overridden.value

  // Disk cache read (synchronous, despite the async wrapper)
  return readFromCache(feature, defaultValue)
}

/**
 * Get a feature value from disk cache immediately.
 * This is the preferred method — synchronous and non-blocking.
 * The value may be stale if the cache was written by a previous process.
 */
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  const overridden = checkOverrides<T>(feature)
  if (overridden.found) return overridden.value

  return readFromCache(feature, defaultValue)
}

/**
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE directly.
 */
export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

/**
 * Check a Statsig feature gate via GrowthBook disk cache, with fallback
 * to old Statsig cache for migration period.
 *
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE for new code.
 */
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  const overridden = checkOverrides<boolean>(gate)
  if (overridden.found) return Boolean(overridden.value)

  const config = getGlobalConfig()
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }
  // Fallback to Statsig cache for migration period
  return config.cachedStatsigGates?.[gate] ?? false
}

/**
 * Check a security restriction gate — sync, reads from disk cache.
 * No re-init waiting since remote GrowthBook is removed.
 */
export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  const overridden = checkOverrides<boolean>(gate)
  if (overridden.found) return Boolean(overridden.value)

  const config = getGlobalConfig()
  const statsigCached = config.cachedStatsigGates?.[gate]
  if (statsigCached !== undefined) {
    return Boolean(statsigCached)
  }
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }
  return false
}

/**
 * Check a boolean entitlement gate with fallback-to-blocking semantics.
 * Fast path: disk cache says true → return immediately.
 * Slow path: disk says false/missing → check cache again (no remote fetch).
 */
export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  const overridden = checkOverrides<boolean>(gate)
  if (overridden.found) return Boolean(overridden.value)

  // Fast path: disk cache already says true
  const cached = getGlobalConfig().cachedGrowthBookFeatures?.[gate]
  if (cached === true) {
    return true
  }

  // Slow path: disk says false/missing — no remote fetch available,
  // just return false (the default for uncached gates)
  return false
}

/**
 * Refresh GrowthBook after auth changes — no-op.
 * No remote client to refresh since GrowthBook SDK is removed.
 */
export function refreshGrowthBookAfterAuthChange(): void {
  // No-op
}

/**
 * Reset GrowthBook client state (primarily for testing).
 */
export function resetGrowthBook(): void {
  stopPeriodicGrowthBookRefresh()
  getGrowthBookClient.cache?.clear?.()
  initializeGrowthBook.cache?.clear?.()
  envOverrides = null
  envOverridesParsed = false
}

/**
 * Light refresh — no-op. No remote features to fetch.
 */
export async function refreshGrowthBookFeatures(): Promise<void> {
  // No-op
}

/** Placeholder — not used in local-only mode. */
const getGrowthBookClient = memoize((): null => {
  return null
})

// Periodic refresh is a no-op since there's no remote client.
let refreshInterval: ReturnType<typeof setInterval> | null = null
let beforeExitListener: (() => void) | null = null

/**
 * Set up periodic refresh — no-op.
 */
export function setupPeriodicGrowthBookRefresh(): void {
  // No-op
}

/**
 * Stop periodic refresh (for testing or cleanup).
 */
export function stopPeriodicGrowthBookRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (beforeExitListener) {
    process.removeListener('beforeExit', beforeExitListener)
    beforeExitListener = null
  }
}

// ============================================================================
// Dynamic Config Functions
// ============================================================================

/**
 * Get a dynamic config value — reads from cache.
 * Previously blocked on init; now synchronous.
 */
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_DEPRECATED(configName, defaultValue)
}

/**
 * Get a dynamic config value from disk cache immediately.
 * This is the preferred method for startup-critical paths.
 */
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}

/**
 * Hostname of ANTHROPIC_BASE_URL when it points at a non-Anthropic proxy.
 * Preserved as a utility since it's used by callers.
 */
export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return undefined
  try {
    const host = new URL(baseUrl).host
    if (host === 'api.anthropic.com') return undefined
    return host
  } catch {
    return undefined
  }
}
