import { desktopClient } from '../../services/desktopClient.js'
import type React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/types.js'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  getDesktopThemeForVariant,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'

type DesktopThemeContextValue = {
  settings: DesktopThemeSettings
  resolvedVariant: DesktopThemeVariant
  setMode: (mode: DesktopThemeMode) => Promise<void>
  saveSettings: (settings: DesktopThemeSettings) => Promise<void>
}

const DesktopThemeContext = createContext<DesktopThemeContextValue | null>(null)

const THEME_VARIABLES = [
  '--contrast',
  '--c-bg',
  '--c-bg-soft',
  '--c-bg-mask',
  '--c-bg-hover',
  '--c-bg-row-hover',
  '--c-bg-chip-hover',
  '--c-bg-card',
  '--c-surface',
  '--c-ink',
  '--c-border',
  '--c-border-soft',
  '--c-border-faint',
  '--c-border-row',
  '--c-danger',
  '--c-warning',
  '--c-success',
  '--c-text',
  '--c-text-strong',
  '--c-text-meta',
  '--c-text-soft',
  '--c-text-mute',
  '--c-text-placeholder',
  '--c-text-disabled',
  '--c-icon',
  '--c-icon-soft',
  '--c-icon-arrow',
  '--c-accent',
  '--c-send-bg',
  '--c-send-bg-hover',
  '--c-send-bg-disabled',
  '--c-scrollbar',
  '--c-scrollbar-hover',
  '--c-diff-added',
  '--c-diff-removed',
  '--c-skill',
  '--ff-sans',
  '--ff-mono',
]

export function DesktopThemeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const [settings, setSettings] = useState<DesktopThemeSettings>(
    DEFAULT_DESKTOP_THEME_SETTINGS,
  )
  const [systemVariant, setSystemVariant] =
    useState<DesktopThemeVariant>(getSystemThemeVariant)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getThemeSettings()
      .then(next => {
        if (mounted) {
          setSettings(normalizeDesktopThemeSettings(next))
        }
      })
      .catch(() => {
        if (mounted) {
          setSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (): void => {
      setSystemVariant(query.matches ? 'dark' : 'light')
    }
    handleChange()
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const resolvedVariant =
    settings.mode === 'system' ? systemVariant : settings.mode

  useEffect(() => {
    applyDesktopTheme(settings, resolvedVariant)
  }, [resolvedVariant, settings])

  const saveSettings = useCallback(
    async (nextSettings: DesktopThemeSettings): Promise<void> => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      setSettings(normalized)
      await desktopClient.saveThemeSettings(normalized)
    },
    [],
  )

  const setMode = useCallback(
    async (mode: DesktopThemeMode): Promise<void> => {
      await saveSettings({ ...settings, mode })
    },
    [saveSettings, settings],
  )

  const value = useMemo<DesktopThemeContextValue>(
    () => ({
      settings,
      resolvedVariant,
      setMode,
      saveSettings,
    }),
    [resolvedVariant, saveSettings, setMode, settings],
  )

  return (
    <DesktopThemeContext.Provider value={value}>
      {children}
    </DesktopThemeContext.Provider>
  )
}

export function useDesktopTheme(): DesktopThemeContextValue {
  const context = useContext(DesktopThemeContext)
  if (!context) {
    throw new Error('useDesktopTheme must be used inside DesktopThemeProvider.')
  }
  return context
}

function applyDesktopTheme(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): void {
  const root = document.documentElement
  root.dataset.theme = variant
  root.classList.toggle('light-theme', variant === 'light')
  root.classList.toggle('dark-theme', variant === 'dark')
  root.style.setProperty('color-scheme', variant)

  for (const variable of THEME_VARIABLES) {
    root.style.removeProperty(variable)
  }

  if (variant === 'light') {
    root.classList.remove('dracula-theme')
    return
  }

  const config = getDesktopThemeForVariant(settings, 'dark')
  const { theme } = config
  const dracula = config.codeThemeId === 'dracula'
  root.classList.toggle('dracula-theme', dracula)
  root.style.setProperty('--contrast', String(theme.contrast))
  root.style.setProperty('--c-bg', theme.surface)
  root.style.setProperty('--c-bg-soft', dracula ? 'var(--purple-2)' : 'var(--gray-2)')
  root.style.setProperty('--c-bg-mask', dracula ? 'var(--purple-2)' : 'var(--gray-2)')
  root.style.setProperty('--c-bg-hover', dracula ? 'var(--purple-4)' : 'var(--gray-4)')
  root.style.setProperty('--c-bg-row-hover', dracula ? 'var(--purple-3)' : 'var(--gray-3)')
  root.style.setProperty('--c-bg-chip-hover', dracula ? 'var(--pink-a2)' : 'var(--blue-3)')
  root.style.setProperty('--c-bg-card', dracula ? 'var(--purple-2)' : 'var(--gray-2)')
  root.style.setProperty('--c-surface', theme.surface)
  root.style.setProperty('--c-ink', theme.ink)
  root.style.setProperty('--c-border', dracula ? 'var(--purple-6)' : 'var(--gray-6)')
  root.style.setProperty('--c-border-soft', dracula ? 'var(--purple-5)' : 'var(--gray-5)')
  root.style.setProperty('--c-border-faint', dracula ? 'var(--purple-4)' : 'var(--gray-4)')
  root.style.setProperty('--c-border-row', dracula ? 'var(--purple-4)' : 'var(--gray-4)')
  root.style.setProperty('--c-danger', 'var(--red-11)')
  root.style.setProperty('--c-warning', 'var(--amber-11)')
  root.style.setProperty('--c-success', 'var(--green-11)')
  root.style.setProperty('--c-text', theme.ink)
  root.style.setProperty('--c-text-strong', 'var(--gray-12)')
  root.style.setProperty('--c-text-meta', 'var(--gray-11)')
  root.style.setProperty('--c-text-soft', 'var(--gray-11)')
  root.style.setProperty('--c-text-mute', 'var(--gray-9)')
  root.style.setProperty('--c-text-placeholder', 'var(--gray-9)')
  root.style.setProperty('--c-text-disabled', 'var(--gray-8)')
  root.style.setProperty('--c-icon', 'var(--gray-11)')
  root.style.setProperty('--c-icon-soft', 'var(--gray-10)')
  root.style.setProperty('--c-icon-arrow', 'var(--gray-9)')
  root.style.setProperty('--c-accent', theme.accent)
  root.style.setProperty('--c-send-bg', theme.accent)
  root.style.setProperty('--c-send-bg-hover', getAccentHoverColor(theme.accent))
  root.style.setProperty('--c-send-bg-disabled', getAccentDisabledColor(theme.accent))
  root.style.setProperty('--c-scrollbar', 'var(--gray-6)')
  root.style.setProperty('--c-scrollbar-hover', 'var(--gray-8)')
  root.style.setProperty('--c-diff-added', theme.semanticColors.diffAdded)
  root.style.setProperty('--c-diff-removed', theme.semanticColors.diffRemoved)
  root.style.setProperty('--c-skill', theme.semanticColors.skill)
  root.style.setProperty(
    '--ff-sans',
    `${theme.fonts.ui}, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif`,
  )
  root.style.setProperty(
    '--ff-mono',
    `"${theme.fonts.code}", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace`,
  )
}

function getSystemThemeVariant(): DesktopThemeVariant {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getAccentHoverColor(accent: string): string {
  switch (accent.toLowerCase()) {
    case '#ff79c6':
      return 'var(--pink-10)'
    case '#ff8dcc':
      return '#de51a8'
    case '#00a2c7':
      return '#23afd0'
    case '#8e4ec6':
    case '#d19dff':
      return '#9a5cd0'
    case '#f76b15':
      return '#ff801f'
    default:
      return '#3b9eff'
  }
}

function getAccentDisabledColor(accent: string): string {
  switch (accent.toLowerCase()) {
    case '#ff79c6':
      return 'var(--pink-a2)'
    case '#ff8dcc':
      return '#591c47'
    case '#00a2c7':
      return '#004558'
    case '#8e4ec6':
    case '#d19dff':
      return '#48295c'
    case '#f76b15':
      return '#562800'
    default:
      return '#104d87'
  }
}
