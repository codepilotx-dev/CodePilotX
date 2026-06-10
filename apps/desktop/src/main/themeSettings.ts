import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopThemeSettings } from '../shared/types.js'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../shared/theme.js'

const THEME_SETTINGS_DIRECTORY = join(
  homedir(),
  '.oh-my-openagent',
  'desktop',
)
const THEME_SETTINGS_FILE = join(THEME_SETTINGS_DIRECTORY, 'theme.json')

export async function readDesktopThemeSettings(): Promise<DesktopThemeSettings> {
  try {
    const raw = await readFile(THEME_SETTINGS_FILE, 'utf8')
    return normalizeDesktopThemeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_DESKTOP_THEME_SETTINGS
  }
}

export async function saveDesktopThemeSettings(
  settings: DesktopThemeSettings,
): Promise<void> {
  const normalized = normalizeDesktopThemeSettings(settings)
  await mkdir(THEME_SETTINGS_DIRECTORY, { recursive: true })
  await writeFile(
    THEME_SETTINGS_FILE,
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  )
}
