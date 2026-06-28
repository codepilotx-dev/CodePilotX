import { unsupportedCoreFeature } from '../errors/unsupported.js'

export function getSettings_DEPRECATED(): Record<string, unknown> | null {
  unsupportedCoreFeature(
    'settings',
    'Settings loading still depends on TUI bootstrap/config state.',
  )
}
