import { bundledThemes } from 'shiki/themes'

export type SyntaxThemeVariant = 'light' | 'dark'

type SyntaxThemePair = Readonly<Record<SyntaxThemeVariant, string>>

const CODEPILOTX_THEME: SyntaxThemePair = {
  light: 'github-light-default',
  dark: 'github-dark-default',
}

export const SyntaxThemeRegistry: Readonly<
  Record<string, SyntaxThemePair>
> = {
  codepilotx: CODEPILOTX_THEME,
  catppuccin: {
    light: 'catppuccin-latte',
    dark: 'catppuccin-mocha',
  },
  dracula: {
    light: 'dracula',
    dark: 'dracula',
  },
  github: CODEPILOTX_THEME,
  material: {
    light: 'material-theme-lighter',
    dark: 'material-theme',
  },
  'vscode-plus': {
    light: 'light-plus',
    dark: 'dark-plus',
  },
}

export function resolveThemeId(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): string {
  const normalized = codeThemeId?.trim().toLowerCase() ?? ''
  const mappedTheme = SyntaxThemeRegistry[normalized]?.[variant]
  if (mappedTheme) return mappedTheme

  if (normalized && Object.hasOwn(bundledThemes, normalized)) {
    return normalized
  }

  return CODEPILOTX_THEME[variant]
}
