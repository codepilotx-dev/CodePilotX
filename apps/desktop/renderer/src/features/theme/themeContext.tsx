import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type DesktopThemeMode = 'light' | 'dark'

type DesktopThemeContextValue = {
  mode: DesktopThemeMode
  setMode: (mode: DesktopThemeMode) => void
}

const DesktopThemeContext = createContext<DesktopThemeContextValue | null>(null)

export function DesktopThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [mode, setMode] = useState<DesktopThemeMode>('light')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = mode
    root.dataset.themeId = mode === 'dark' ? 'static-dark' : 'static-light'
    root.dataset.glassSurfaces = 'on'
    root.dataset.pointerCursor = 'on'
    root.dataset.reduceMotion = 'off'
    root.classList.toggle('dark-theme', mode === 'dark')
    root.classList.toggle('light-theme', mode === 'light')
    root.style.setProperty('color-scheme', mode)
  }, [mode])

  const value = useMemo(() => ({ mode, setMode }), [mode])
  return <DesktopThemeContext.Provider value={value}>{children}</DesktopThemeContext.Provider>
}

export function useDesktopTheme(): DesktopThemeContextValue {
  const context = useContext(DesktopThemeContext)
  if (!context) throw new Error('useDesktopTheme must be used inside DesktopThemeProvider.')
  return context
}
