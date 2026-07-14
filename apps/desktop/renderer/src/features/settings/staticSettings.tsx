import type React from 'react'
import { createContext, useContext } from 'react'

type StaticDesktopSettingsContextValue = {
  readonly staticMode: true
}

const StaticDesktopSettingsContext = createContext<StaticDesktopSettingsContextValue | null>(null)

export function StaticDesktopSettingsProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <StaticDesktopSettingsContext.Provider value={{ staticMode: true }}>
      {children}
    </StaticDesktopSettingsContext.Provider>
  )
}

export function useStaticDesktopSettings(): StaticDesktopSettingsContextValue {
  const context = useContext(StaticDesktopSettingsContext)
  if (!context) throw new Error('useStaticDesktopSettings must be used inside StaticDesktopSettingsProvider.')
  return context
}
