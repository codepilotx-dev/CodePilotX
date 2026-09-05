export type DesktopThemeVariant = "light" | "dark"
export type DesktopThemeMode = DesktopThemeVariant | "system"
export type DesktopHexColor = `#${string}`

export function deriveDesktopSurfaceUnder(
  surface: string,
  ink: string,
  variant: DesktopThemeVariant,
  contrast: number,
): string {
  const parseHex = (value: string) => {
    const hex = value.replace("#", "")
    return {
      red: Number.parseInt(hex.slice(0, 2), 16),
      green: Number.parseInt(hex.slice(2, 4), 16),
      blue: Number.parseInt(hex.slice(4, 6), 16),
    }
  }
  const surfaceRgb = parseHex(surface)
  const inkRgb = parseHex(ink)
  const dark = variant === "dark"
  const target = dark ? { red: 0, green: 0, blue: 0 } : inkRgb
  const amount = Math.max(
    0,
    Math.min(
      1,
      (dark ? 0.16 : 0.04)
        + (contrast - (dark ? 60 : 45)) * (dark ? 0.0015 : 0.0012),
    ),
  )
  const mix = (channel: keyof typeof surfaceRgb) => Math.round(
    surfaceRgb[channel]
      + (target[channel] - surfaceRgb[channel]) * amount,
  )
  const toHex = (value: number) => value.toString(16).padStart(2, "0")

  return `#${toHex(mix("red"))}${toHex(mix("green"))}${toHex(mix("blue"))}`
}

/**
 * One locally installed system font face, as returned by the Local Font
 * Access enumeration. Only display metadata crosses the typed bridge; font
 * files, Blobs, and filesystem paths are never exposed to the renderer.
 */
export type DesktopSystemFontFace = {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

/**
 * Persisted font-face selection. The style is intentionally omitted: a
 * non-default style is re-resolved against the live system enumeration, and
 * `null` always means "family only / default face".
 */
export type DesktopThemeFontFace = Pick<
  DesktopSystemFontFace,
  "family" | "fullName" | "postscriptName"
>

export const DESKTOP_THEME_SETTINGS_VERSION = 7

export function isNewerDesktopThemeSettingsVersion(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const version = (value as { version?: unknown }).version
  return typeof version === "number"
    && Number.isInteger(version)
    && version > DESKTOP_THEME_SETTINGS_VERSION
}

export function desktopThemeFontFaceMatchesFamily(
  family: string | null | undefined,
  face: DesktopThemeFontFace | null | undefined,
): boolean {
  if (!family || !face) return false
  const firstFamily = family.split(",", 1)[0]?.trim() ?? ""
  const unquoted =
    firstFamily.length >= 2
    && ((firstFamily.startsWith('"') && firstFamily.endsWith('"'))
      || (firstFamily.startsWith("'") && firstFamily.endsWith("'")))
      ? firstFamily.slice(1, -1)
      : firstFamily
  return unquoted.toLowerCase() === face.family.trim().toLowerCase()
}

export type DesktopSystemFontsResult =
  | { ok: true; fonts: DesktopSystemFontFace[] }
  | { ok: false; error: "unsupported" | "denied" | "failed" }

export type DesktopChromeTheme = {
  accent: DesktopHexColor
  contrast: number
  fonts: {
    code: string | null
    codeFace?: DesktopThemeFontFace | null
    ui: string | null
    uiFace?: DesktopThemeFontFace | null
  }
  ink: DesktopHexColor
  semanticColors: {
    diffAdded: DesktopHexColor
    diffRemoved: DesktopHexColor
    skill: DesktopHexColor
  }
  surface: DesktopHexColor
}

export type DesktopThemeSettingsV6<CodeThemeId extends string = string> = {
  version: 6
  mode: DesktopThemeMode
  chromeThemes: Record<DesktopThemeVariant, DesktopChromeTheme>
  codeThemeIds: Record<DesktopThemeVariant, CodeThemeId>
  pointerCursorEnabled: boolean
  reduceMotion: "system" | "on" | "off"
  fontSmoothingEnabled: boolean
  fontSizes: {
    code: number
    ui: number
  }
}

/**
 * V7 adds nullable `uiFace`/`codeFace` font-face selections next to the
 * existing `fonts.ui`/`fonts.code` families. V6 documents remain valid input
 * for the preserve-style migration and stay type-compatible because the face
 * keys are optional.
 */
export type DesktopThemeSettingsV7<CodeThemeId extends string = string> =
  Omit<DesktopThemeSettingsV6<CodeThemeId>, "version"> & { version: 7 }
