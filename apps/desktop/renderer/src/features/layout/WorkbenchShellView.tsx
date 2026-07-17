import type React from 'react'
import { DesktopAppShell } from './DesktopAppShell.js'

export function WorkbenchShellView({
  menuBar,
  sidebar,
  debugMode,
  appBodyRef,
  children,
}: {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  debugMode: boolean
  appBodyRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}): React.ReactNode {
  return (
    <DesktopAppShell
      menuBar={menuBar}
      sidebar={sidebar}
      menubarDebugMode={debugMode}
      appBodyRef={appBodyRef}
    >
      {children}
    </DesktopAppShell>
  )
}
