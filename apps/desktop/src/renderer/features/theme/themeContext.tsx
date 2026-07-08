import { desktopClient } from '../../services/desktopClient.js'
import type React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from '../../../shared/types.js'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  getDesktopThemeForSelection,
  getDesktopThemeIdForVariant,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'

type DesktopThemeContextValue = {
  settings: DesktopThemeSettings
  resolvedVariant: DesktopThemeVariant
  draft: DesktopThemeDraft
  setMode: (mode: DesktopThemeMode) => Promise<void>
  saveSettings: (settings: DesktopThemeSettings) => Promise<void>
}

const DesktopThemeContext = createContext<DesktopThemeContextValue | null>(null)

type DesktopThemeDraft = {
  settings: DesktopThemeSettings
  resolvedVariant: DesktopThemeVariant
  dirty: boolean
  saving: boolean
  setSettings: (settings: DesktopThemeSettings) => void
  setMode: (mode: DesktopThemeMode) => void
  save: () => Promise<DesktopThemeSettings>
  reset: () => void
  autoSave: () => void
}

const THEME_VARIABLES = [
  '--contrast',
  '--color-bg',
  '--color-bg-soft',
  '--color-bg-mask',
  '--color-bg-hover',
  '--color-bg-row-hover',
  '--color-bg-chip-hover',
  '--color-bg-card',
  '--color-popover-bg',
  '--color-popover-border',
  '--color-popover-divider',
  '--glass-surface-bg',
  '--glass-surface-border',
  '--glass-surface-highlight',
  '--glass-surface-text',
  '--glass-surface-text-meta',
  '--glass-surface-text-disabled',
  '--glass-surface-blur',
  '--color-surface',
  '--color-ink',
  '--color-border',
  '--color-border-soft',
  '--color-border-faint',
  '--color-border-row',
  '--color-danger',
  '--color-warning',
  '--color-success',
  '--color-text',
  '--color-text-strong',
  '--color-text-meta',
  '--color-text-soft',
  '--color-text-mute',
  '--color-text-placeholder',
  '--color-text-disabled',
  '--color-text-on-accent',
  '--color-icon',
  '--color-icon-soft',
  '--color-icon-arrow',
  '--color-accent',
  '--color-send-bg',
  '--color-send-bg-hover',
  '--color-send-bg-disabled',
  '--color-user-bubble-bg',
  '--color-scrollbar',
  '--color-scrollbar-hover',
  '--color-diff-added',
  '--color-diff-removed',
  '--color-skill',
  '--surface-base',
  '--surface-canvas',
  '--surface-panel',
  '--surface-raised',
  '--surface-subtle',
  '--border-subtle',
  '--border-muted',
  '--shadow-float',
  '--shadow-raised',
  '--shadow-resting',
  '--color-chrome-bg',
  '--color-sidebar-bg',
  '--color-sidebar-active-bg',
  '--color-sidebar-hover-bg',
  '--color-workbench-bg',
  '--color-panel-bg',
  '--color-panel-elevated-bg',
  '--color-panel-border',
  '--color-panel-shadow',
  '--color-panel-shadow-raised',
  '--color-panel-shadow-soft',
  '--state-hover-bg',
  '--state-active-bg',
  '--font-family-sans',
  '--font-family-mono',
  '--font-size-ui',
  '--font-size-code',
  '--font-size-11',
  '--font-size-12',
  '--font-size-13',
  '--font-size-14',
  '--font-size-15',
  '--font-size-16',
  '--font-size-18',
  '--font-size-26',
]

export function DesktopThemeProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const [settings, setSettings] = useState<DesktopThemeSettings>(
    DEFAULT_DESKTOP_THEME_SETTINGS,
  )
  const [draftSettings, setDraftSettings] = useState<DesktopThemeSettings>(
    DEFAULT_DESKTOP_THEME_SETTINGS,
  )
  const draftSettingsRef = useRef(draftSettings)
  draftSettingsRef.current = draftSettings
  const [draftSaving, setDraftSaving] = useState(false)
  const [systemVariant, setSystemVariant] =
    useState<DesktopThemeVariant>(getSystemThemeVariant)
  const [systemReduceMotion, setSystemReduceMotion] = useState(
    getSystemReduceMotion,
  )

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getThemeSettings()
      .then(next => {
        if (mounted) {
          const normalized = normalizeDesktopThemeSettings(next)
          setSettings(normalized)
          setDraftSettings(normalized)
        }
      })
      .catch(() => {
        if (mounted) {
          setSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
          setDraftSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
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

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (): void => {
      setSystemReduceMotion(query.matches)
    }
    handleChange()
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  const resolvedVariant =
    settings.mode === 'system' ? systemVariant : settings.mode
  const draftResolvedVariant =
    draftSettings.mode === 'system' ? systemVariant : draftSettings.mode
  const draftDirty = !desktopThemeSettingsEqual(draftSettings, settings)

  useEffect(() => {
    applyDesktopTheme(draftSettings, draftResolvedVariant, systemReduceMotion)
  }, [draftResolvedVariant, draftSettings, systemReduceMotion])

  const saveSettings = useCallback(
    async (nextSettings: DesktopThemeSettings): Promise<void> => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      setSettings(normalized)
      setDraftSettings(normalized)
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

  const setDraftMode = useCallback((mode: DesktopThemeMode): void => {
    setDraftSettings(current =>
      normalizeDesktopThemeSettings({ ...current, mode }),
    )
  }, [])

  const setDraftSettingsValue = useCallback(
    (nextSettings: DesktopThemeSettings): void => {
      setDraftSettings(normalizeDesktopThemeSettings(nextSettings))
    },
    [],
  )

  const saveDraft = useCallback(async (): Promise<DesktopThemeSettings> => {
    const normalized = normalizeDesktopThemeSettings(draftSettingsRef.current)
    setDraftSaving(true)
    try {
      await desktopClient.saveThemeSettings(normalized)
      setSettings(normalized)
      setDraftSettings(normalized)
      return normalized
    } finally {
      setDraftSaving(false)
    }
  }, [])

  const resetDraft = useCallback((): void => {
    setDraftSettings(settings)
  }, [settings])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  const autoSave = useCallback(() => {
    setTimeout(() => { void saveDraftRef.current(); }, 0)
  }, [])

  const draft = useMemo<DesktopThemeDraft>(
    () => ({
      settings: draftSettings,
      resolvedVariant: draftResolvedVariant,
      dirty: draftDirty,
      saving: draftSaving,
      setSettings: setDraftSettingsValue,
      setMode: setDraftMode,
      save: saveDraft,
      reset: resetDraft,
      autoSave,
    }),
    [
      draftDirty,
      draftResolvedVariant,
      draftSaving,
      draftSettings,
      resetDraft,
      saveDraft,
      setDraftMode,
      setDraftSettingsValue,
      autoSave,
    ],
  )

  const value = useMemo<DesktopThemeContextValue>(
    () => ({
      settings,
      resolvedVariant,
      draft,
      setMode,
      saveSettings,
    }),
    [draft, resolvedVariant, saveSettings, setMode, settings],
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
  systemReduceMotion: boolean,
): void {
  const root = document.documentElement
  const reduceMotion =
    settings.reduceMotion === 'system'
      ? systemReduceMotion
      : settings.reduceMotion === 'on'
  root.dataset.theme = variant
  root.dataset.themeId = getDesktopThemeIdForVariant(settings, variant)
  root.classList.toggle('light-theme', variant === 'light')
  root.classList.toggle('dark-theme', variant === 'dark')
  root.dataset.glassSurfaces = settings.glassmorphismEnabled ? 'on' : 'off'
  root.dataset.pointerCursor = settings.pointerCursorEnabled ? 'on' : 'off'
  root.dataset.reduceMotion = reduceMotion ? 'on' : 'off'
  root.style.setProperty('color-scheme', variant)

  for (const variable of THEME_VARIABLES) {
    root.style.removeProperty(variable)
  }

  const config = getDesktopThemeForSelection(settings, variant)
  const { theme } = config
  const dracula = variant === 'dark' && config.codeThemeId === 'dracula'
  const contrast = clamp(theme.contrast, 0, 100)
  root.classList.toggle('dracula-theme', dracula)
  const bgSoftMix = contrastMix(contrast, 1, 6)
  const bgRowHoverMix = variant === 'dark' ? 12 : 7
  const layoutTokens = deriveLayoutThemeTokens(theme, variant, contrast)
  const sidebarHoverBg =
    layoutTokens['--color-sidebar-hover-bg'] ?? surfaceInkMix(theme, 3 + contrast * 0.19)
  root.style.setProperty('--contrast', String(contrast))
  root.style.setProperty('--color-bg', theme.surface)
  root.style.setProperty('--color-bg-soft', surfaceInkMix(theme, bgSoftMix))
  root.style.setProperty('--color-bg-mask', surfaceInkMix(theme, bgSoftMix))
  root.style.setProperty('--color-bg-hover', sidebarHoverBg)
  root.style.setProperty('--color-bg-row-hover', sidebarHoverBg)
  root.style.setProperty('--color-bg-chip-hover', sidebarHoverBg)
  root.style.setProperty('--color-bg-card', surfaceInkMix(theme, contrastMix(contrast, 1, 4)))
  root.style.setProperty('--color-popover-bg', theme.surface)
  root.style.setProperty('--color-popover-border', surfaceInkMix(theme, contrastMix(contrast, 4, 8)))
  root.style.setProperty('--color-popover-divider', surfaceInkMix(theme, contrastMix(contrast, 3, 6)))
  root.style.setProperty(
    '--glass-surface-bg',
    variant === 'dark'
      ? colorMix(theme.surface, 20, 'transparent')
      : colorMix(theme.surface, 20, 'transparent'),
  )
  root.style.setProperty(
    '--glass-surface-border',
    variant === 'dark'
      ? 'rgba(255, 255, 255, 0.14)'
      : colorMix(theme.ink, 10, 'transparent'),
  )
  root.style.setProperty(
    '--glass-surface-highlight',
    variant === 'dark'
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(255, 255, 255, 0.72)',
  )
  root.style.setProperty(
    '--glass-surface-text',
    variant === 'dark' ? 'rgba(255, 255, 255, 0.94)' : theme.ink,
  )
  root.style.setProperty(
    '--glass-surface-text-meta',
    variant === 'dark'
      ? 'rgba(255, 255, 255, 0.72)'
      : colorMix(theme.ink, 78, theme.surface),
  )
  root.style.setProperty(
    '--glass-surface-text-disabled',
    variant === 'dark'
      ? 'rgba(255, 255, 255, 0.42)'
      : colorMix(theme.ink, 52, theme.surface),
  )
  root.style.setProperty('--glass-surface-blur', '14px')
  root.style.setProperty('--color-surface', theme.surface)
  root.style.setProperty('--color-ink', theme.ink)
  root.style.setProperty('--color-border', surfaceInkMix(theme, contrastMix(contrast, 6, 12)))
  root.style.setProperty('--color-border-soft', surfaceInkMix(theme, contrastMix(contrast, 4, 8)))
  root.style.setProperty('--color-border-faint', surfaceInkMix(theme, contrastMix(contrast, 2, 5)))
  root.style.setProperty('--color-border-row', surfaceInkMix(theme, contrastMix(contrast, 2, 5)))
  root.style.setProperty('--color-danger', theme.semanticColors.diffRemoved)
  root.style.setProperty('--color-warning', '#d4a017')
  root.style.setProperty('--color-success', theme.semanticColors.diffAdded)
  root.style.setProperty('--color-text', theme.ink)
  root.style.setProperty('--color-text-strong', theme.ink)
  root.style.setProperty('--color-text-meta', surfaceInkMix(theme, contrastMix(contrast, 55, 70)))
  root.style.setProperty('--color-text-soft', surfaceInkMix(theme, contrastMix(contrast, 45, 60)))
  root.style.setProperty('--color-text-mute', surfaceInkMix(theme, contrastMix(contrast, 35, 50)))
  root.style.setProperty('--color-text-placeholder', surfaceInkMix(theme, contrastMix(contrast, 25, 40)))
  root.style.setProperty('--color-text-disabled', surfaceInkMix(theme, contrastMix(contrast, 15, 25)))
  root.style.setProperty('--color-text-on-accent', '#ffffff')
  root.style.setProperty('--color-icon', theme.ink)
  root.style.setProperty('--color-icon-soft', surfaceInkMix(theme, contrastMix(contrast, 40, 55)))
  root.style.setProperty('--color-icon-arrow', surfaceInkMix(theme, contrastMix(contrast, 30, 45)))
  root.style.setProperty('--color-accent', theme.accent)
  root.style.setProperty('--color-send-bg', theme.accent)
  root.style.setProperty(
    '--color-send-bg-hover',
    isDefaultDarkAccent(theme.accent) ? '#a9583e' : accentMix(theme, variant === 'dark' ? 12 : 18),
  )
  root.style.setProperty(
    '--color-send-bg-disabled',
    isDefaultDarkAccent(theme.accent) ? '#e6dfd8' : accentMix(theme, 50),
  )
  root.style.setProperty('--color-user-bubble-bg', surfaceInkMix(theme, bgRowHoverMix))
  root.style.setProperty('--color-scrollbar', surfaceInkMix(theme, contrastMix(contrast, 8, 14)))
  root.style.setProperty('--color-scrollbar-hover', surfaceInkMix(theme, contrastMix(contrast, 15, 25)))
  root.style.setProperty('--color-diff-added', theme.semanticColors.diffAdded)
  root.style.setProperty('--color-diff-removed', theme.semanticColors.diffRemoved)
  root.style.setProperty('--color-skill', theme.semanticColors.skill)
  root.style.setProperty('--state-hover-bg', sidebarHoverBg)
  root.style.setProperty('--state-active-bg', surfaceInkMix(theme, 5 + contrast * 0.22))
  root.style.setProperty('--color-bg-subtle', surfaceInkMix(theme, contrast * 0.08))
  root.style.setProperty('--color-accent-a3', colorMix(theme.accent, 30, 'transparent'))
  root.style.setProperty('--color-accent-11', colorMix(theme.accent, 85, theme.surface))
  for (const [name, value] of Object.entries(layoutTokens)) {
    root.style.setProperty(name, value)
  }
  root.style.setProperty(
    '--font-family-sans',
    buildFontFamilyStack(theme.fonts.ui),
  )
  root.style.setProperty(
    '--font-family-mono',
    buildFontFamilyStack(theme.fonts.code),
  )
  const uiFontSize = clamp(settings.fontSizes.ui, 11, 20)
  const codeFontSize = clamp(settings.fontSizes.code, 10, 20)
  root.style.setProperty('--font-size-ui', `${uiFontSize}px`)
  root.style.setProperty('--font-size-code', `${codeFontSize}px`)
  root.style.setProperty('--font-size-11', `${uiFontSize - 3}px`)
  root.style.setProperty('--font-size-12', `${uiFontSize - 2}px`)
  root.style.setProperty('--font-size-13', `${uiFontSize - 1}px`)
  root.style.setProperty('--font-size-14', `${uiFontSize}px`)
  root.style.setProperty('--font-size-15', `${uiFontSize + 1}px`)
  root.style.setProperty('--font-size-16', `${uiFontSize + 2}px`)
  root.style.setProperty('--font-size-18', `${uiFontSize + 4}px`)
  root.style.setProperty('--font-size-26', `${uiFontSize + 12}px`)
}

function getSystemThemeVariant(): DesktopThemeVariant {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getSystemReduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ThemeTokens = DesktopThemeConfigV1['theme']

function deriveLayoutThemeTokens(
  theme: ThemeTokens,
  variant: DesktopThemeVariant,
  contrast: number,
): Record<string, string> {
  if (variant === 'dark') {
    const sidebarMix = contrastMix(contrast, 6, 15)
    const workbenchMix = contrastMix(contrast, 10, 22)
    const panelMix = contrastMix(contrast, 15, 28)
    const raisedMix = contrastMix(contrast, 20, 36)
    return {
      '--surface-base': surfaceInkMix(theme, workbenchMix),
      '--surface-canvas': surfaceInkMix(theme, contrastMix(contrast, 12, 24)),
      '--surface-panel': surfaceInkMix(theme, panelMix),
      '--surface-raised': surfaceInkMix(theme, raisedMix),
      '--surface-subtle': surfaceInkMix(theme, sidebarMix),
      '--surface-product': '#11100f',
      '--surface-product-raised': '#252320',
      '--border-subtle': surfaceInkMix(theme, contrastMix(contrast, 30, 46)),
      '--border-muted': surfaceInkMix(theme, contrastMix(contrast, 20, 34)),
      '--shadow-resting': '0 1px 2px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.03) inset',
      '--shadow-raised': '0 12px 34px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.22)',
      '--shadow-float': '0 24px 64px rgba(0, 0, 0, 0.38), 0 8px 24px rgba(0, 0, 0, 0.28)',
      '--color-chrome-bg': surfaceInkMix(theme, contrast * 0.15),
      '--color-sidebar-bg': surfaceInkMix(theme, contrast * 0.15),
      '--color-sidebar-active-bg': surfaceInkMix(theme, 3 + contrast * 0.19),
      '--color-sidebar-hover-bg': surfaceInkMix(theme, 3 + contrast * 0.19),
      '--color-workbench-bg': surfaceInkMix(theme, workbenchMix),
      '--color-panel-bg': surfaceInkMix(theme, panelMix),
      '--color-panel-elevated-bg': surfaceInkMix(theme, raisedMix),
      '--color-panel-border': surfaceInkMix(theme, contrastMix(contrast, 28, 42)),
      '--color-panel-shadow': 'var(--shadow-float)',
      '--color-panel-shadow-raised': 'var(--shadow-raised)',
      '--color-panel-shadow-soft': 'var(--shadow-resting)',
    }
  }

  const workbenchMix = contrastMix(contrast, 2, 7)
  const subtleMix = contrastMix(contrast, 3, 9)
  const raisedMix = contrastMix(contrast, 0, 3)
  return {
    '--surface-base': surfaceInkMix(theme, workbenchMix),
    '--surface-canvas': surfaceInkMix(theme, contrastMix(contrast, 0, 2)),
    '--surface-panel': theme.surface,
    '--surface-raised': surfaceInkMix(theme, raisedMix),
    '--surface-subtle': surfaceInkMix(theme, subtleMix),
    '--surface-product': '#181715',
    '--surface-product-raised': '#252320',
    '--border-subtle': surfaceInkMix(theme, contrastMix(contrast, 7, 13)),
    '--border-muted': surfaceInkMix(theme, contrastMix(contrast, 3, 8)),
    '--shadow-resting': `0 1px 2px ${colorMix(theme.ink, 5, 'transparent')}, 0 1px 0 ${colorMix(theme.surface, 70, 'transparent')} inset`,
    '--shadow-raised': `0 10px 28px ${colorMix(theme.ink, 8, 'transparent')}, 0 1px 2px ${colorMix(theme.ink, 5, 'transparent')}`,
    '--shadow-float': `0 22px 60px ${colorMix(theme.ink, 12, 'transparent')}, 0 8px 24px ${colorMix(theme.ink, 8, 'transparent')}`,
    '--color-chrome-bg': surfaceInkMix(theme, contrast * 0.15),
    '--color-sidebar-bg': surfaceInkMix(theme, contrast * 0.15),
    '--color-sidebar-active-bg': surfaceInkMix(theme, 3 + contrast * 0.19),
    '--color-sidebar-hover-bg': surfaceInkMix(theme, 3 + contrast * 0.19),
    '--color-workbench-bg': surfaceInkMix(theme, workbenchMix),
    '--color-panel-bg': theme.surface,
    '--color-panel-elevated-bg': surfaceInkMix(theme, raisedMix),
    '--color-panel-border': surfaceInkMix(theme, contrastMix(contrast, 7, 13)),
    '--color-panel-shadow': 'var(--shadow-float)',
    '--color-panel-shadow-raised': 'var(--shadow-raised)',
    '--color-panel-shadow-soft': 'var(--shadow-resting)',
  }
}

function contrastMix(contrast: number, low: number, high: number): number {
  return Math.round(low + (clamp(contrast, 0, 100) / 100) * (high - low))
}

function surfaceInkMix(theme: ThemeTokens, inkPercent: number): string {
  return colorMix(theme.surface, 100 - inkPercent, theme.ink)
}

function colorMix(first: string, firstPercent: number, second: string): string {
  return `color-mix(in srgb, ${first} ${firstPercent}%, ${second})`
}

function isDefaultDarkAccent(accent: string): boolean {
  return accent.toLowerCase() === '#cc785c'
}

function accentMix(theme: ThemeTokens, inkPercent: number): string {
  return colorMix(theme.accent, 100 - inkPercent, theme.ink)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatFontFamilyStack(value: string): string {
  return value
    .split(',')
    .map(formatFontFamilyName)
    .filter(Boolean)
    .join(', ')
}

function buildFontFamilyStack(entry: {
  preset: string
  fallback: string
}): string {
  const presetStack = formatFontFamilyStack(entry.preset)
  const fallbackStack = formatFontFamilyStack(entry.fallback)
  if (!presetStack) return fallbackStack
  if (!fallbackStack) return presetStack
  return `${presetStack}, ${fallbackStack}`
}

function formatFontFamilyName(value: string): string {
  const fontName = value.trim()
  if (!fontName) return ''
  if (isQuotedFontFamily(fontName) || isCssFunction(fontName)) return fontName
  if (isGenericFontFamily(fontName)) return fontName
  return `"${fontName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isQuotedFontFamily(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
}

function isCssFunction(value: string): boolean {
  return /^[a-z-]+\(/i.test(value)
}

function isGenericFontFamily(value: string): boolean {
  return new Set([
    '-apple-system',
    'BlinkMacSystemFont',
    'cursive',
    'emoji',
    'fangsong',
    'fantasy',
    'math',
    'monospace',
    'sans-serif',
    'serif',
    'system-ui',
    'ui-monospace',
    'ui-rounded',
    'ui-sans-serif',
    'ui-serif',
  ]).has(value)
}

function desktopThemeSettingsEqual(
  left: DesktopThemeSettings,
  right: DesktopThemeSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
