import type React from 'react'
import { DesktopAppShell } from './DesktopAppShell.js'

export function WorkbenchShellView({
  menuBar,
  sidebar,
  appBodyRef,
  children,
}: {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  appBodyRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}): React.ReactNode {
  return (
    <DesktopAppShell
      menuBar={menuBar}
      sidebar={sidebar}
      appBodyRef={appBodyRef}
    >
      {children}
    </DesktopAppShell>
  )
}
