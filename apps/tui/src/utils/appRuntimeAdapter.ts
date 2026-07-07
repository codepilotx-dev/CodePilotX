/**
 * TUI adapter for the core app runtime.
 *
 * Injects TUI-native implementations of auth, config, and settings into
 * `@codepilotx/core` so core OAuth/config/shim functions work without
 * reverse imports.
 *
 * Call once during app startup, before any core auth/config/settings
 * wrappers are used. Follows the same pattern as
 * `apps/tui/src/services/mcp/configRuntimeAdapter.ts`.
 */

import { configureCoreAppRuntime } from '@codepilotx/core/runtime/appRuntime.js'
import type {
  AppRuntime,
  CoreGlobalConfig,
  SettingsJson,
} from '@codepilotx/core/runtime/appRuntime.js'
import {
  getAnthropicApiKey,
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
  hasProfileScope,
  isClaudeAISubscriber,
  saveApiKey,
} from './auth.js'
import {
  enableConfigs,
  getGlobalConfig,
  saveGlobalConfig,
} from './config.js'
import {
  getInitialSettings,
  getSettingsForSource,
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from './settings/settings.js'

/**
 * Configure the core app runtime with TUI-native implementations.
 * Must be called once during app initialization (before any core
 * auth/config/settings shims are invoked).
 */
export function configureTuiCoreAppRuntime(): void {
  const runtime: AppRuntime = {
    auth: {
      hasProfileScope,
      isClaudeAISubscriber,
      saveApiKey,
      getAnthropicApiKey,
      getAuthTokenSource,
      getOauthAccountInfo,
      hasAnthropicApiKeyAuth,
    },
    config: {
      enableConfigs,
      getGlobalConfig: <T>() => getGlobalConfig() as T,
      saveGlobalConfig: (
        updater: (current: CoreGlobalConfig) => CoreGlobalConfig,
      ) => {
        saveGlobalConfig(updater as Parameters<typeof saveGlobalConfig>[0])
      },
    },
    settings: {
      getSettings_DEPRECATED: <T>() => getSettings_DEPRECATED() as T | undefined,
      getInitialSettings: <T>() => getInitialSettings() as T,
      getSettingsForSource: (source: string) =>
        getSettingsForSource(source) as SettingsJson | undefined,
      updateSettingsForSource: (source, updater) => {
        updateSettingsForSource(
          source,
          updater as Parameters<typeof updateSettingsForSource>[1],
        )
      },
    },
  }

  configureCoreAppRuntime(runtime)
}
