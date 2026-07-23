export type DesktopThemeVariant = "light" | "dark"
export type DesktopThemeMode = DesktopThemeVariant | "system"
export type DesktopHexColor = `#${string}`

export type DesktopChromeTheme = {
  accent: DesktopHexColor
  contrast: number
  fonts: {
    code: string | null
    ui: string | null
  }
  ink: DesktopHexColor
  opaqueWindows: boolean
  semanticColors: {
    diffAdded: DesktopHexColor
    diffRemoved: DesktopHexColor
    skill: DesktopHexColor
  }
  surface: DesktopHexColor
}

export type DesktopThemeSettingsV5<CodeThemeId extends string = string> = {
  version: 5
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
