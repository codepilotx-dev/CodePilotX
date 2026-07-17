import type React from 'react'
import { DesktopAppShell } from './DesktopAppShell.js'

export function WorkbenchShellView({
  menuBar,
  sidebar,
  debugMode,
  children,
}: {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  debugMode: boolean
  children: React.ReactNode
}): React.ReactNode {
  return (
    <DesktopAppShell
      menuBar={menuBar}
      sidebar={sidebar}
      menubarDebugMode={debugMode}
    >
      {children}
    </DesktopAppShell>
  )
}
