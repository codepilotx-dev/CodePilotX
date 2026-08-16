import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  DesktopChromeTheme,
  DesktopHexColor,
  DesktopThemeFontFace,
  DesktopThemeSettingsV7,
  DesktopThemeVariant,
} from "@codepilotx/shared/desktop-theme"
import {
  desktopThemeFontFaceMatchesFamily,
} from "@codepilotx/shared/desktop-theme"

export type {
  DesktopChromeTheme,
  DesktopThemeSettingsV7,
} from "@codepilotx/shared/desktop-theme"

type HexColor = DesktopHexColor
type AppearanceVariant = DesktopThemeVariant

const DEFAULT_CHROME_THEMES: Record<AppearanceVariant, DesktopChromeTheme> = {
  light: {
    accent: "#339cff",
    surface: "#ffffff",
    ink: "#1a1c1f",
    contrast: 45,
    fonts: { ui: null, code: null, uiFace: null, codeFace: null },
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#ba2623",
      skill: "#924ff7",
    },
  },
  dark: {
    accent: "#339cff",
    surface: "#181818",
    ink: "#ffffff",
    contrast: 60,
    fonts: { ui: null, code: null, uiFace: null, codeFace: null },
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
  },
}

export const DEFAULT_APPEARANCE_SETTINGS: DesktopThemeSettingsV7 = {
  version: 7,
  mode: "system",
  chromeThemes: DEFAULT_CHROME_THEMES,
  codeThemeIds: { light: "codex-light", dark: "codex-dark" },
  pointerCursorEnabled: false,
  reduceMotion: "system",
  fontSmoothingEnabled: true,
  fontSizes: { ui: 14, code: 12 },
}

type RecordValue = Record<string, unknown>
const CURRENT_APPEARANCE_SETTINGS_VERSION = 7

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function colorOr(value: unknown, fallback: HexColor): HexColor {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase() as HexColor
    : fallback
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function fontOr(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

function faceFieldOr(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null
}

function fontFaceOr(value: unknown): DesktopThemeFontFace | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  const family = faceFieldOr(value.family, 200)
  const fullName = faceFieldOr(value.fullName, 200)
  const postscriptName = faceFieldOr(value.postscriptName, 200)
  if (!family || !fullName || !postscriptName) return null
  return { family, fullName, postscriptName }
}

function codeThemeIdOr(value: unknown, fallback: string): string {
  if (value === "auto") return fallback
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/i.test(value)
    ? value
    : fallback
}

function normalizeChromeTheme(value: unknown, fallback: DesktopChromeTheme): DesktopChromeTheme {
  const source = isRecord(value) ? value : {}
  const fonts = isRecord(source.fonts) ? source.fonts : {}
  const semanticColors = isRecord(source.semanticColors) ? source.semanticColors : {}
  const ui = fontOr(fonts.ui)
  const code = fontOr(fonts.code)
  const uiFace = fontFaceOr(fonts.uiFace)
  const codeFace = fontFaceOr(fonts.codeFace)
  return {
    accent: colorOr(source.accent, fallback.accent),
    surface: colorOr(source.surface, fallback.surface),
    ink: colorOr(source.ink, fallback.ink),
    contrast: numberInRange(source.contrast, fallback.contrast, 0, 100),
    // Face keys are always persisted explicitly: clearing a face writes
    // `null` so Agent key-path edits can never leave stale face subkeys.
    fonts: {
      ui,
      uiFace: desktopThemeFontFaceMatchesFamily(ui, uiFace) ? uiFace : null,
      code,
      codeFace: desktopThemeFontFaceMatchesFamily(code, codeFace) ? codeFace : null,
    },
    semanticColors: {
      diffAdded: colorOr(semanticColors.diffAdded, fallback.semanticColors.diffAdded),
      diffRemoved: colorOr(semanticColors.diffRemoved, fallback.semanticColors.diffRemoved),
      skill: colorOr(semanticColors.skill, fallback.semanticColors.skill),
    },
  }
}

export function normalizeAppearanceSettings(value: unknown): DesktopThemeSettingsV7 {
  const source = isRecord(value) ? value : {}
  const mode = source.mode === "light" || source.mode === "dark" || source.mode === "system"
    ? source.mode
    : DEFAULT_APPEARANCE_SETTINGS.mode
  const codeThemeIds = isRecord(source.codeThemeIds) ? source.codeThemeIds : {}
  const chromeThemes = isRecord(source.chromeThemes) ? source.chromeThemes : {}
  const fontSizes = isRecord(source.fontSizes) ? source.fontSizes : {}
  return {
    version: 7,
    mode,
    chromeThemes: {
      light: normalizeChromeTheme(chromeThemes.light, DEFAULT_CHROME_THEMES.light),
      dark: normalizeChromeTheme(chromeThemes.dark, DEFAULT_CHROME_THEMES.dark),
    },
    codeThemeIds: {
      light: codeThemeIdOr(codeThemeIds.light, "codex-light"),
      dark: codeThemeIdOr(codeThemeIds.dark, "codex-dark"),
    },
    pointerCursorEnabled: booleanOr(
      source.pointerCursorEnabled,
      DEFAULT_APPEARANCE_SETTINGS.pointerCursorEnabled,
    ),
    reduceMotion: source.reduceMotion === "on" || source.reduceMotion === "off"
      ? source.reduceMotion
      : "system",
    fontSmoothingEnabled: booleanOr(
      source.fontSmoothingEnabled,
      DEFAULT_APPEARANCE_SETTINGS.fontSmoothingEnabled,
    ),
    fontSizes: {
      ui: numberInRange(fontSizes.ui, 14, 11, 16),
      code: numberInRange(fontSizes.code, 12, 8, 24),
    },
  }
}

/**
 * V7 is a preserve-style upgrade over V6: every existing mode, theme color,
 * code theme, cursor, motion, font-size, and font-smoothing value survives,
 * and only the nullable `uiFace`/`codeFace` keys plus `version: 7` are added.
 *
 * V6 was an intentional solid-surface reset. Known V1-V5 documents are still
 * replaced with the new defaults instead of carrying old palette choices into
 * the semantic-token contract. Future documents remain protected from
 * downgrade.
 */
export function migrateAppearanceSettings(value: unknown): DesktopThemeSettingsV7 {
  if (!isRecord(value)) {
    throw new UnsupportedAppearanceSettingsVersionError(value)
  }

  const originalVersion = value.version
  if (
    typeof originalVersion !== "number"
    || !Number.isInteger(originalVersion)
    || originalVersion < 1
  ) {
    throw new UnsupportedAppearanceSettingsVersionError(originalVersion)
  }
  if (originalVersion > CURRENT_APPEARANCE_SETTINGS_VERSION) {
    throw new NewerAppearanceSettingsVersionError(originalVersion)
  }

  if (originalVersion < 6) {
    return normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
  }
  return normalizeAppearanceSettings(value)
}

export class UnsupportedAppearanceSettingsVersionError extends Error {
  constructor(readonly version: unknown) {
    super("无法识别外观设置版本，原设置文件已保留")
    this.name = "UnsupportedAppearanceSettingsVersionError"
  }
}

export class NewerAppearanceSettingsVersionError extends Error {
  constructor(readonly version: number) {
    super(`外观设置版本 ${version} 高于当前支持的版本，原设置文件已保留`)
    this.name = "NewerAppearanceSettingsVersionError"
  }
}

export class AppearanceSettingsStore {
  readonly #filePath: string
  readonly #logger: AppearanceSettingsLogger | undefined
  #writeQueue: Promise<void> = Promise.resolve()
  #existingVersionChecked = false

  constructor(
    userDataDirectory: string,
    logger?: AppearanceSettingsLogger,
    fileName = "appearance-settings.json",
  ) {
    this.#filePath = join(userDataDirectory, fileName)
    this.#logger = logger
  }

  get filePath(): string {
    return this.#filePath
  }

  async load(): Promise<DesktopThemeSettingsV7> {
    try {
      const source = await readFile(this.#filePath, "utf8")
      let parsed: unknown
      try {
        parsed = JSON.parse(source)
      } catch (error) {
        if (error instanceof SyntaxError) {
          return this.#removeCorruptAndReset()
        }
        throw error
      }
      const normalized = migrateAppearanceSettings(parsed)
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) await this.save(normalized)
      return normalized
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      const fallback = normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
      await this.save(fallback)
      return fallback
    }
  }

  save(value: unknown): Promise<void> {
    const normalized = migrateAppearanceSettings(value)
    const write = this.#writeQueue.then(async () => {
      await this.#assertExistingVersionWritable()
      await this.#writeAtomically(normalized)
    })
    this.#writeQueue = write.catch(() => undefined)
    return write
  }

  async #assertExistingVersionWritable(): Promise<void> {
    if (this.#existingVersionChecked) return
    try {
      const existing = JSON.parse(await readFile(this.#filePath, "utf8"))
      if (
        isRecord(existing)
        && typeof existing.version === "number"
        && existing.version > CURRENT_APPEARANCE_SETTINGS_VERSION
      ) {
        throw new NewerAppearanceSettingsVersionError(existing.version)
      }
    } catch (error) {
      if (!isMissingFileError(error) && !(error instanceof SyntaxError)) throw error
    }
    this.#existingVersionChecked = true
  }

  async #removeCorruptAndReset(): Promise<DesktopThemeSettingsV7> {
    await rm(this.#filePath, { force: true })
    this.#logger?.info("appearance-settings.corrupt-reset", { reason: "invalid-json" })
    const fallback = normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    await this.save(fallback)
    return fallback
  }

  async #writeAtomically(settings: DesktopThemeSettingsV7): Promise<void> {
    const directory = dirname(this.#filePath)
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporaryPath, this.#filePath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

export interface AppearanceSettingsLogger {
  info(event: string, fields?: Record<string, unknown>): void
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
