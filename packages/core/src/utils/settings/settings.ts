/**
 * Settings utilities for @codepilotx/core.
 *
 * This shim delegates to the app runtime rather than re-exporting from TUI.
 */

import { requireCoreAppRuntime } from '../../runtime/appRuntime.js'
import type { SettingsJson } from '../../runtime/appRuntime.js'

export function getSettings_DEPRECATED<T = SettingsJson>(): T | undefined {
  return requireCoreAppRuntime().settings.getSettings_DEPRECATED<T>()
}

export function getInitialSettings<T = SettingsJson>(): T {
  return requireCoreAppRuntime().settings.getInitialSettings<T>()
}

export function getSettingsForSource(
  source: string,
): SettingsJson | undefined {
  return requireCoreAppRuntime().settings.getSettingsForSource(source)
}

export function updateSettingsForSource(
  source: string,
  updater: (current: SettingsJson) => SettingsJson,
): void {
  return requireCoreAppRuntime().settings.updateSettingsForSource(
    source,
    updater,
  )
}
