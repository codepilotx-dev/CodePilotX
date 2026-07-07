/**
 * Config utilities for @codepilotx/core.
 *
 * This shim delegates to the app runtime rather than re-exporting from TUI.
 */

import { requireCoreAppRuntime } from '../runtime/appRuntime.js'
import type {
  CoreAccountInfo,
  CoreGlobalConfig,
} from '../runtime/appRuntime.js'

export type { CoreAccountInfo as AccountInfo } from '../runtime/appRuntime.js'

export function enableConfigs(): void {
  requireCoreAppRuntime().config.enableConfigs()
}

export function getGlobalConfig<T = CoreGlobalConfig>(): T {
  return requireCoreAppRuntime().config.getGlobalConfig<T>()
}

export function saveGlobalConfig(
  updater: (current: CoreGlobalConfig) => CoreGlobalConfig,
): void {
  return requireCoreAppRuntime().config.saveGlobalConfig(updater)
}
