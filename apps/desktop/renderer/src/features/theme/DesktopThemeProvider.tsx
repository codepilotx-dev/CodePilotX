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
import { applyThemeFontFaceStyles } from './themeFontFaces.js'
import {
  DesktopThemeContext,
  type DesktopThemeContextValue,
  type DesktopThemeDraft,
} from './themeContext.js'

const SETTINGS_THEME_VARIABLES = [
  '--cpx-sys-font-family-sans',
  '--cpx-sys-font-family-mono',
  '--cpx-sys-font-size-ui',
  '--cpx-sys-font-size-code',
  '--cpx-sys-font-size-xs',
  '--cpx-sys-font-size-sm',
  '--cpx-sys-font-size-md',
  '--cpx-sys-font-size-lg',
  '--cpx-sys-font-size-xl',
  '--cpx-sys-font-size-2xl',
  '--cpx-sys-font-size-3xl',
  '--cpx-sys-font-family-mono',
  '--cpx-sys-font-family-sans',
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
  const titleBarOverlayPayloadRef = useRef('')
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
        if (!mounted) return
        const normalized = normalizeDesktopThemeSettings(next)
        committedSettingsRef.current = normalized
        draftSettingsRef.current = normalized
        setSettings(normalized)
        setDraftSettings(normalized)
      })
      .catch(() => {
        if (!mounted) return
        committedSettingsRef.current = DEFAULT_DESKTOP_THEME_SETTINGS
        draftSettingsRef.current = DEFAULT_DESKTOP_THEME_SETTINGS
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
    )
    return synchronizeTitleBarOverlay(titleBarOverlayPayloadRef)
  }, [
    draftResolvedVariant,
    draftSettings,
    systemReduceMotion,
  ])

  useEffect(() => {
    // Inject dynamic @font-face rules that bind local font sources and
    // font-variation-settings ('wght') to dedicated application font aliases.
    const config = getDesktopThemeForSelection(
      draftSettings,
      draftResolvedVariant,
    )
    const uiFace = config.theme.fonts.uiFace ?? null
    const codeFace = config.theme.fonts.codeFace ?? null
    applyThemeFontFaceStyles(uiFace, codeFace)
  }, [draftResolvedVariant, draftSettings])

  const persistSettings = useCallback(
    async (nextSettings: DesktopThemeSettings): Promise<DesktopThemeSettings> => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      pendingSavesRef.current += 1
      setDraftSaving(true)
      const operation = saveQueueRef.current.then(async () => {
        await desktopClient.saveThemeSettings(normalized)
        committedSettingsRef.current = normalized
        setSettings(normalized)
      })
      saveQueueRef.current = operation.catch(() => undefined)
      try {
        await operation
        return normalized
      } catch (error) {
        if (
          desktopThemeSettingsEqual(draftSettingsRef.current, normalized)
        ) {
          const rollback = committedSettingsRef.current
          draftSettingsRef.current = rollback
          setDraftSettings(rollback)
        }
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
      draftSettingsRef.current = normalized
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
    const normalized = normalizeDesktopThemeSettings({
      ...draftSettingsRef.current,
      mode,
    })
    draftSettingsRef.current = normalized
    setDraftSettings(normalized)
  }, [])

  const setDraftSettingsValue = useCallback(
    (nextSettings: DesktopThemeSettings): void => {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      draftSettingsRef.current = normalized
      setDraftSettings(normalized)
    },
    [],
  )

  const saveDraft = useCallback(async (): Promise<DesktopThemeSettings> => {
    return persistSettings(draftSettingsRef.current)
  }, [persistSettings])

  const resetDraft = useCallback((): void => {
    const committed = committedSettingsRef.current
    draftSettingsRef.current = committed
    setDraftSettings(committed)
  }, [])

  const updateAndAutoSave = useCallback(
    async (
      updater: (current: DesktopThemeSettings) => DesktopThemeSettings,
    ): Promise<void> => {
      const normalized = normalizeDesktopThemeSettings(
        updater(draftSettingsRef.current),
      )
      draftSettingsRef.current = normalized
      setDraftSettings(normalized)
      await persistSettings(normalized)
    },
    [persistSettings],
  )

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft
  const autoSave = useCallback((nextSettings?: DesktopThemeSettings) => {
    if (nextSettings) {
      const normalized = normalizeDesktopThemeSettings(nextSettings)
      draftSettingsRef.current = normalized
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
      updateAndAutoSave,
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
      updateAndAutoSave,
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
      draft,
      setMode,
      saveSettings,
    }),
    [
      activeTheme,
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

function synchronizeTitleBarOverlay(
  lastPayloadRef: { current: string },
): () => void {
  const update = window.codePilotXDesktop?.updateTitleBarOverlay
  if (!update) return () => undefined

  let animationFrame = 0
  const sync = (): void => {
    cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(() => {
      const titleBar = document.querySelector<HTMLElement>('.desktop-menubar')
      if (!titleBar) return
      const styles = getComputedStyle(titleBar)
      const backgroundColor = cssColorToHex(styles.backgroundColor)
      const foregroundColor = cssColorToHex(
        styles.color || getComputedStyle(document.documentElement)
          .getPropertyValue('--cpx-sys-color-fg-primary'),
      )
      const height = Math.round(titleBar.getBoundingClientRect().height)
      if (!backgroundColor || !foregroundColor || height < 24 || height > 80) return
      const payload = { backgroundColor, foregroundColor, height }
      const serialized = JSON.stringify(payload)
      if (serialized === lastPayloadRef.current) return
      lastPayloadRef.current = serialized
      void update(payload).catch(() => undefined)
    })
  }

  sync()
  const titleBar = document.querySelector<HTMLElement>('.desktop-menubar')
  const observer = titleBar && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(sync)
    : null
  if (titleBar) observer?.observe(titleBar)
  window.addEventListener('resize', sync)
  return () => {
    cancelAnimationFrame(animationFrame)
    observer?.disconnect()
    window.removeEventListener('resize', sync)
  }
}

export function cssColorToHex(value: string): string | null {
  const color = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  const match = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*[\d.]+)?\s*\)$/i.exec(color)
  if (!match) return null
  const channels = match.slice(1, 4).map(channel => Number(channel))
  if (channels.some(channel => channel < 0 || channel > 255)) return null
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
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
  root.dataset.windowType = window.codePilotXDesktop ? 'electron' : 'browser-mock'
  root.dataset.os = 'windows'
  root.classList.toggle('light-theme', variant === 'light')
  root.classList.toggle('dark-theme', variant === 'dark')
  root.classList.toggle('electron-light', variant === 'light')
  root.classList.toggle('electron-dark', variant === 'dark')
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
  root.style.setProperty('--cpx-sys-font-size-ui', `${uiFontSize}px`)
  root.style.setProperty('--cpx-sys-font-size-code', `${codeFontSize}px`)
  root.style.setProperty('--cpx-sys-font-size-xs', `${uiFontSize - 3}px`)
  root.style.setProperty('--cpx-sys-font-size-sm', `${uiFontSize - 2}px`)
  root.style.setProperty('--cpx-sys-font-size-md', `${uiFontSize}px`)
  root.style.setProperty('--cpx-sys-font-size-lg', `${uiFontSize + 2}px`)
  root.style.setProperty('--cpx-sys-font-size-xl', `${uiFontSize + 4}px`)
  root.style.setProperty('--cpx-sys-font-size-2xl', `${uiFontSize + 6}px`)
  root.style.setProperty('--cpx-sys-font-size-3xl', `${uiFontSize + 10}px`)
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
