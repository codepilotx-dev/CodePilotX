import type React from 'react'

type Props = {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function DesktopAppShell({
  menuBar,
  sidebar,
  children,
}: Props): React.ReactNode {
  return (
    <div className="app-shell">
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
