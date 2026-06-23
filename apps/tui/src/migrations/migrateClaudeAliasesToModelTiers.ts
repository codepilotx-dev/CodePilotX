import {
  getMainLoopModelOverride,
  setMainLoopModelOverride,
} from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migrate legacy Claude-family aliases to CodePilotX task-tier aliases.
 *
 * Idempotent: only writes when a legacy alias is present.
 */
export function migrateClaudeAliasesToModelTiers(): void {
  const model = getSettingsForSource('userSettings')?.model
  const migratedModel = migrateModelAlias(model)
  let didMigrate = false
  if (migratedModel !== model) {
    updateSettingsForSource('userSettings', { model: migratedModel })
    didMigrate = true
  }

  const override = getMainLoopModelOverride()
  const migratedOverride = migrateModelAlias(override)
  if (migratedOverride !== override) {
    setMainLoopModelOverride(migratedOverride)
    didMigrate = true
  }

  if (didMigrate) {
    logEvent('tengu_claude_aliases_to_model_tiers_migration', {})
  }
}

function migrateModelAlias<T extends string | null | undefined>(model: T): T {
  switch (model) {
    case 'haiku':
      return 'fast' as T
    case 'sonnet':
      return 'default' as T
    case 'opus':
    case 'best':
      return 'deep' as T
    case 'opusplan':
      return 'plan' as T
    case 'sonnet[1m]':
      return 'default[1m]' as T
    case 'opus[1m]':
      return 'deep[1m]' as T
    default:
      return model
  }
}
