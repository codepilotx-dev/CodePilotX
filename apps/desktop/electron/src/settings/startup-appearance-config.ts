import { readFile } from "node:fs/promises"
import { parse } from "smol-toml"
import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV6,
} from "./appearance-settings-store.js"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export async function readStartupAppearanceConfig(
  configPath: string,
  legacyAppearancePath?: string,
): Promise<DesktopThemeSettingsV6> {
  try {
    const parsed = parse(await readFile(configPath, "utf8"))
    const desktop = isObject(parsed.desktop) ? parsed.desktop : null
    if (desktop && isObject(desktop.appearance)) {
      return normalizeAppearanceSettings(desktop.appearance)
    }
  } catch {}
  if (legacyAppearancePath) {
    try {
      return normalizeAppearanceSettings(
        JSON.parse(await readFile(legacyAppearancePath, "utf8")),
      )
    } catch {}
  }
  return normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
}
