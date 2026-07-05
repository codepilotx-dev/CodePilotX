/**
 * Remote Managed Settings Service
 *
 * LOCALLY DISABLED: All remote managed settings fetching has been removed.
 * - isEligibleForRemoteManagedSettings() returns false
 * - loadRemoteManagedSettings(), refreshRemoteManagedSettings() are no-ops
 * - Background polling is disabled
 *
 * Local file/MDM managed settings reading is preserved for systems that
 * depend on the public API shape.
 */

import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'

// Background polling state
let pollingIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Check if the current user is eligible for remote managed settings.
 * Always returns false — remote managed settings are disabled.
 */
export function isEligibleForRemoteManagedSettings(): boolean {
  return false
}

/**
 * Wait for the initial remote settings loading to complete.
 * Returns immediately since remote settings are disabled.
 */
export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {
  // No-op
}

/**
 * Initialize the loading promise — no-op.
 */
export function initializeRemoteManagedSettingsLoadingPromise(): void {
  // No-op
}

/**
 * Load remote settings — no-op.
 * Fires a notifyChange so local policy settings are still respected.
 */
export async function loadRemoteManagedSettings(): Promise<void> {
  settingsChangeDetector.notifyChange('policySettings')
}

/**
 * Refresh remote settings asynchronously — no-op.
 * Fires a notifyChange so local policy settings are updated.
 */
export async function refreshRemoteManagedSettings(): Promise<void> {
  settingsChangeDetector.notifyChange('policySettings')
}

/**
 * Clear all remote settings cache — no-op.
 */
export async function clearRemoteManagedSettingsCache(): Promise<void> {
  stopBackgroundPolling()
}

/**
 * Start background polling — no-op since remote settings are disabled.
 */
export function startBackgroundPolling(): void {
  // No-op
}

/**
 * Stop background polling.
 */
export function stopBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
