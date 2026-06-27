import type React from 'react'

type Props = {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  children: React.ReactNode
  menubarDebugMode?: boolean
}

export function DesktopAppShell({
  menuBar,
  sidebar,
  children,
  menubarDebugMode = false,
}: Props): React.ReactNode {
  return (
    <div
      className={menubarDebugMode ? 'app-shell menubar-debug-mode' : 'app-shell'}
    >
      <div className="desktop-menubar">{menuBar}</div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <div className="desktop-main-stage">{children}</div>
        </section>
      </div>
    </div>
  )
}
