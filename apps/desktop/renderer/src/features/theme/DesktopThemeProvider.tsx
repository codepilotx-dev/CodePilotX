import { desktopClient } from '../../services/desktop-client/index.js'
import type React from 'react'
import {
  useCallback,
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
  getCodeThemeSelectionForVariant,
  getDesktopThemeForSelection,
  getDesktopThemeIdForVariant,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'
import { deriveThemeVariables } from './themeVariables.js'
import {
  DesktopThemeContext,
  type DesktopThemeContextValue,
  type DesktopThemeDraft,
} from './themeContext.js'

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
  '--vscode-font-size',
  '--vscode-editor-font-size',
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
  const committedSettingsRef = useRef(settings)
  committedSettingsRef.current = settings
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSavesRef = useRef(0)
  const [draftSaving, setDraftSaving] = useState(false)
  const [backdropSupported, setBackdropSupported] = useState(false)
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
        if (!mounted) return
        const normalized = normalizeDesktopThemeSettings(next)
        committedSettingsRef.current = normalized
        setSettings(normalized)
        setDraftSettings(normalized)
      })
      .catch(() => {
        if (!mounted) return
        setSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
        setDraftSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const bridge = window.codePilotXDesktop
    let cancelled = false
    if (bridge?.getSystemTheme && bridge.onSystemThemeChange) {
      void bridge.getSystemTheme().then(theme => {
        if (!cancelled) setSystemVariant(theme)
      })
      const unsubscribe = bridge.onSystemThemeChange(setSystemVariant)
      return () => {
        cancelled = true
        unsubscribe()
      }
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (): void => {
      setSystemVariant(query.matches ? 'dark' : 'light')
    }
    handleChange()
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    let mounted = true
    void window.codePilotXDesktop
      ?.getWindowBackdropCapability?.()
      .then(capability => {
        if (mounted) setBackdropSupported(capability.supported)
      })
      .catch(() => {
        if (mounted) setBackdropSupported(false)
      })
    return () => {
      mounted = false
    }
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

  const draftResolvedVariant =
    draftSettings.mode === 'system' ? systemVariant : draftSettings.mode
  const draftDirty = !desktopThemeSettingsEqual(draftSettings, settings)
  const activeTheme = useMemo(
    () => getDesktopThemeForSelection(draftSettings, draftResolvedVariant),
    [draftResolvedVariant, draftSettings],
  )

  useEffect(() => {
    applyDesktopTheme(
      draftSettings,
      draftResolvedVariant,
      systemReduceMotion,
      backdropSupported,
    )
    const configuredOpaque =
      draftSettings.chromeThemes[draftResolvedVariant].opaqueWindows
    if (backdropSupported) {
      void window.codePilotXDesktop
        ?.applyWindowBackdrop?.(!configuredOpaque)
        .catch(() => undefined)
    }
  }, [
    backdropSupported,
    draftResolvedVariant,
    draftSettings,
    systemReduceMotion,
  ])

  const persistSettings = useCallback(
    async (nextSettings: DesktopThemeSettings): Promise<DesktopThemeSettings> => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      pendingSavesRef.current += 1
      setDraftSaving(true)
      const operation = saveQueueRef.current.then(async () => {
        await desktopClient.saveThemeSettings(normalized)
        committedSettingsRef.current = normalized
        setSettings(normalized)
        setDraftSettings(current =>
          desktopThemeSettingsEqual(current, normalized)
            ? normalized
            : current,
        )
      })
      saveQueueRef.current = operation.catch(() => undefined)
      try {
        await operation
        return normalized
      } catch (error) {
        setDraftSettings(current =>
          desktopThemeSettingsEqual(current, normalized)
            ? committedSettingsRef.current
            : current,
        )
        throw error
      } finally {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current === 0) setDraftSaving(false)
      }
    },
    [],
  )

  const saveSettings = useCallback(
    async (nextSettings: DesktopThemeSettings): Promise<void> => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      setDraftSettings(normalized)
      await persistSettings(normalized)
    },
    [persistSettings],
  )

  const setMode = useCallback(
    async (mode: DesktopThemeMode): Promise<void> => {
      await saveSettings({ ...draftSettingsRef.current, mode })
    },
    [saveSettings],
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
    return persistSettings(draftSettingsRef.current)
  }, [persistSettings])

  const resetDraft = useCallback((): void => {
    setDraftSettings(committedSettingsRef.current)
  }, [])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft
  const autoSave = useCallback((nextSettings?: DesktopThemeSettings) => {
    if (nextSettings) {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      setDraftSettings(normalized)
      void persistSettings(normalized).catch(() => undefined)
      return
    }
    setTimeout(() => {
      void saveDraftRef.current().catch(() => undefined)
    }, 0)
  }, [persistSettings])

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
      autoSave,
      draftDirty,
      draftResolvedVariant,
      draftSaving,
      draftSettings,
      resetDraft,
      saveDraft,
      setDraftMode,
      setDraftSettingsValue,
    ],
  )

  const value = useMemo<DesktopThemeContextValue>(
    () => ({
      settings,
      resolvedVariant: draftResolvedVariant,
      activeTheme,
      codeThemeId: getCodeThemeSelectionForVariant(
        draftSettings,
        draftResolvedVariant,
      ),
      backdropSupported,
      draft,
      setMode,
      saveSettings,
    }),
    [
      activeTheme,
      backdropSupported,
      draft,
      draftResolvedVariant,
      draftSettings,
      saveSettings,
      setMode,
      settings,
    ],
  )

  return (
    <DesktopThemeContext.Provider value={value}>
      {children}
    </DesktopThemeContext.Provider>
  )
}

function applyDesktopTheme(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
  systemReduceMotion: boolean,
  backdropSupported: boolean,
): void {
  const root = document.documentElement
  const reduceMotion =
    settings.reduceMotion === 'system'
      ? systemReduceMotion
      : settings.reduceMotion === 'on'
  const opaque =
    settings.chromeThemes[variant].opaqueWindows || !backdropSupported

  root.dataset.theme = variant
  root.dataset.themeId = getDesktopThemeIdForVariant(settings, variant)
  root.classList.toggle('light-theme', variant === 'light')
  root.classList.toggle('dark-theme', variant === 'dark')
  root.classList.toggle('electron-light', variant === 'light')
  root.classList.toggle('electron-dark', variant === 'dark')
  root.classList.toggle('electron-opaque', opaque)
  root.dataset.glassSurfaces = opaque ? 'off' : 'on'
  root.dataset.pointerCursor = settings.pointerCursorEnabled ? 'on' : 'off'
  root.dataset.reduceMotion = reduceMotion ? 'on' : 'off'
  root.style.setProperty('color-scheme', variant)
  root.style.setProperty(
    '-webkit-font-smoothing',
    settings.fontSmoothingEnabled ? 'antialiased' : 'auto',
  )

  for (const variable of SETTINGS_THEME_VARIABLES) {
    root.style.removeProperty(variable)
  }

  const config = getDesktopThemeForSelection(settings, variant)
  root.dataset.codeThemeId = getCodeThemeSelectionForVariant(settings, variant)
  for (const [name, value] of Object.entries(deriveThemeVariables(config))) {
    root.style.setProperty(name, value)
  }

  const uiFontSize = clamp(settings.fontSizes.ui, 11, 16)
  const codeFontSize = clamp(settings.fontSizes.code, 8, 24)
  root.style.setProperty('--font-size-ui', `${uiFontSize}px`)
  root.style.setProperty('--font-size-code', `${codeFontSize}px`)
  root.style.setProperty('--vscode-font-size', `${uiFontSize}px`)
  root.style.setProperty('--vscode-editor-font-size', `${codeFontSize}px`)
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
