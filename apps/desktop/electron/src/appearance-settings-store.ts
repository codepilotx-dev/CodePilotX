import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

export type AppearanceVariant = "light" | "dark"
export type AppearanceMode = AppearanceVariant | "system"
export type HexColor = `#${string}`

export interface DesktopChromeTheme {
  accent: HexColor
  surface: HexColor
  ink: HexColor
  contrast: number
  opaqueWindows: boolean
  fonts: {
    ui: string | null
    code: string | null
  }
  semanticColors: {
    diffAdded: HexColor
    diffRemoved: HexColor
    skill: HexColor
  }
}

export interface DesktopThemeSettingsV3 {
  version: 3
  mode: AppearanceMode
  chromeThemes: Record<AppearanceVariant, DesktopChromeTheme>
  codeThemeIds: Record<AppearanceVariant, string>
  pointerCursorEnabled: boolean
  reduceMotion: "system" | "on" | "off"
  fontSmoothingEnabled: boolean
  fontSizes: {
    ui: number
    code: number
  }
}

const DEFAULT_CHROME_THEMES: Record<AppearanceVariant, DesktopChromeTheme> = {
  light: {
    accent: "#339cff",
    surface: "#ffffff",
    ink: "#1a1c1f",
    contrast: 45,
    opaqueWindows: false,
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
    opaqueWindows: false,
    fonts: { ui: null, code: null },
    semanticColors: {
      diffAdded: "#40c977",
      diffRemoved: "#fa423e",
      skill: "#ad7bf9",
    },
  },
}

export const DEFAULT_APPEARANCE_SETTINGS: DesktopThemeSettingsV3 = {
  version: 3,
  mode: "system",
  chromeThemes: DEFAULT_CHROME_THEMES,
  codeThemeIds: { light: "codex-light", dark: "codex-dark" },
  pointerCursorEnabled: false,
  reduceMotion: "system",
  fontSmoothingEnabled: true,
  fontSizes: { ui: 14, code: 12 },
}

type RecordValue = Record<string, unknown>

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
    opaqueWindows: booleanOr(source.opaqueWindows, fallback.opaqueWindows),
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

export function normalizeAppearanceSettings(value: unknown): DesktopThemeSettingsV3 {
  const source = isRecord(value) ? value : {}
  const mode = source.mode === "light" || source.mode === "dark" || source.mode === "system"
    ? source.mode
    : DEFAULT_APPEARANCE_SETTINGS.mode
  const codeThemeIds = isRecord(source.codeThemeIds) ? source.codeThemeIds : {}
  const chromeThemes = isRecord(source.chromeThemes) ? source.chromeThemes : {}
  const fontSizes = isRecord(source.fontSizes) ? source.fontSizes : {}
  const legacyOpaque = typeof source.glassmorphismEnabled === "boolean"
    ? !source.glassmorphismEnabled
    : undefined

  const normalizeVariant = (variant: AppearanceVariant): DesktopChromeTheme => {
    const normalized = normalizeChromeTheme(chromeThemes[variant], DEFAULT_CHROME_THEMES[variant])
    return legacyOpaque === undefined || isRecord(chromeThemes[variant])
      ? normalized
      : { ...normalized, opaqueWindows: legacyOpaque }
  }

  return {
    version: 3,
    mode,
    chromeThemes: {
      light: normalizeVariant("light"),
      dark: normalizeVariant("dark"),
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

export class AppearanceSettingsStore {
  readonly #filePath: string
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(userDataDirectory: string, fileName = "appearance-settings.json") {
    this.#filePath = join(userDataDirectory, fileName)
  }

  get filePath(): string {
    return this.#filePath
  }

  async load(): Promise<DesktopThemeSettingsV3> {
    try {
      const source = await readFile(this.#filePath, "utf8")
      const parsed: unknown = JSON.parse(source)
      const normalized = normalizeAppearanceSettings(parsed)
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) await this.save(normalized)
      return normalized
    } catch (error) {
      if (!isMissingFileError(error) && !(error instanceof SyntaxError)) {
        // Permission and I/O errors should not be disguised as corrupt settings.
        throw error
      }
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

  async #writeAtomically(settings: DesktopThemeSettingsV3): Promise<void> {
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

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}
