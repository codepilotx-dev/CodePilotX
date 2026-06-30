import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import type { DesktopStoredSettings } from '../shared/types.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../shared/settingsSchema.js'
import { readGlobalAgentsMd, saveGlobalAgentsMd } from './desktopAgentsMd.js'

const SETTINGS_FILE_NAME = 'settings.json'
export function getDesktopConfigDirectoryPath(): string {
  return join(getOpenAgentConfigHomeDir(), 'desktop')
}

export function getOpenAgentConfigHomeDir(): string {
  return (
    process.env[CODEPILOTX_CONFIG_DIR_ENV] ??
    process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] ??
    join(homedir(), CODEPILOTX_CONFIG_DIR_NAME)
  )
}

function getDesktopSettingsPath(): string {
  return join(getDesktopConfigDirectoryPath(), SETTINGS_FILE_NAME)
}

export async function readDesktopStoredSettings(): Promise<DesktopStoredSettings> {
  const configHomeDir = getOpenAgentConfigHomeDir()
  const globalAgentsMd = await readGlobalAgentsMd(configHomeDir)
  try {
    const raw = await readFile(getDesktopSettingsPath(), 'utf8')
    const settings = normalizeDesktopStoredSettings(JSON.parse(raw))
    return {
      ...settings,
      customInstructions: globalAgentsMd ?? settings.customInstructions,
    }
  } catch {
    return {
      ...defaultDesktopStoredSettings(),
      customInstructions: globalAgentsMd ?? '',
    }
  }
}

export async function saveDesktopStoredSettings(
  settings: DesktopStoredSettings,
): Promise<DesktopStoredSettings> {
  const normalized = normalizeDesktopStoredSettings(settings)
  const settingsPath = getDesktopSettingsPath()
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2), 'utf8')
  await saveGlobalAgentsMd(
    getOpenAgentConfigHomeDir(),
    normalized.customInstructions,
  )
  return normalized
}
