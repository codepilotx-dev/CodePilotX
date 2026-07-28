import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  DesktopChromeTheme,
  DesktopHexColor,
  DesktopThemeSettingsV6,
  DesktopThemeVariant,
} from "@codepilotx/shared/desktop-theme"

export type {
  DesktopChromeTheme,
  DesktopThemeSettingsV6,
} from "@codepilotx/shared/desktop-theme"

type HexColor = DesktopHexColor
type AppearanceVariant = DesktopThemeVariant

const DEFAULT_CHROME_THEMES: Record<AppearanceVariant, DesktopChromeTheme> = {
  light: {
    accent: "#339cff",
    surface: "#ffffff",
    ink: "#1a1c1f",
    contrast: 45,
    fonts: { ui: null, code: null },
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
    fonts: { ui: null, code: null },
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
  },
}

export const DEFAULT_APPEARANCE_SETTINGS: DesktopThemeSettingsV6 = {
  version: 6,
  mode: "system",
  chromeThemes: DEFAULT_CHROME_THEMES,
  codeThemeIds: { light: "codex-light", dark: "codex-dark" },
  pointerCursorEnabled: false,
  reduceMotion: "system",
  fontSmoothingEnabled: true,
  fontSizes: { ui: 14, code: 12 },
}

type RecordValue = Record<string, unknown>
const CURRENT_APPEARANCE_SETTINGS_VERSION = 6

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
  return {
    accent: colorOr(source.accent, fallback.accent),
    surface: colorOr(source.surface, fallback.surface),
    ink: colorOr(source.ink, fallback.ink),
    contrast: numberInRange(source.contrast, fallback.contrast, 0, 100),
    fonts: {
      ui: fontOr(fonts.ui),
      code: fontOr(fonts.code),
    },
    semanticColors: {
      diffAdded: colorOr(semanticColors.diffAdded, fallback.semanticColors.diffAdded),
      diffRemoved: colorOr(semanticColors.diffRemoved, fallback.semanticColors.diffRemoved),
      skill: colorOr(semanticColors.skill, fallback.semanticColors.skill),
    },
  }
}

export function normalizeAppearanceSettings(value: unknown): DesktopThemeSettingsV6 {
  const source = isRecord(value) ? value : {}
  const mode = source.mode === "light" || source.mode === "dark" || source.mode === "system"
    ? source.mode
    : DEFAULT_APPEARANCE_SETTINGS.mode
  const codeThemeIds = isRecord(source.codeThemeIds) ? source.codeThemeIds : {}
  const chromeThemes = isRecord(source.chromeThemes) ? source.chromeThemes : {}
  const fontSizes = isRecord(source.fontSizes) ? source.fontSizes : {}
  return {
    version: 6,
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
 * V6 is an intentional solid-surface reset. Known V1-V5 documents are replaced
 * with the new defaults instead of carrying old palette choices into the new
 * semantic-token contract. Future documents remain protected from downgrade.
 */
export function migrateAppearanceSettings(value: unknown): DesktopThemeSettingsV6 {
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

  if (originalVersion < CURRENT_APPEARANCE_SETTINGS_VERSION) {
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

  async load(): Promise<DesktopThemeSettingsV6> {
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
    const normalized = normalizeAppearanceSettings(value)
    const write = this.#writeQueue.then(() => this.#writeAtomically(normalized))
    this.#writeQueue = write.catch(() => undefined)
    return write
  }

  async #removeCorruptAndReset(): Promise<DesktopThemeSettingsV6> {
    await rm(this.#filePath, { force: true })
    this.#logger?.info("appearance-settings.corrupt-reset", { reason: "invalid-json" })
    const fallback = normalizeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    await this.save(fallback)
    return fallback
  }

  async #writeAtomically(settings: DesktopThemeSettingsV6): Promise<void> {
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
