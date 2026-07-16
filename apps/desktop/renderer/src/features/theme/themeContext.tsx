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
import { deriveThemeVariables } from './themeVariables.js'

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

const SETTINGS_THEME_VARIABLES = [
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
  '--font-size-17',
  '--font-size-18',
  '--font-size-20',
  '--font-size-24',
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

  for (const variable of SETTINGS_THEME_VARIABLES) {
    root.style.removeProperty(variable)
  }

  const config = getDesktopThemeForSelection(settings, variant)
  for (const [name, value] of Object.entries(deriveThemeVariables(config))) {
    root.style.setProperty(name, value)
  }
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
  root.style.setProperty('--font-size-17', `${uiFontSize + 3}px`)
  root.style.setProperty('--font-size-18', `${uiFontSize + 4}px`)
  root.style.setProperty('--font-size-20', `${uiFontSize + 6}px`)
  root.style.setProperty('--font-size-24', `${uiFontSize + 10}px`)
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function desktopThemeSettingsEqual(
  left: DesktopThemeSettings,
  right: DesktopThemeSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
