import type React from 'react'

type Props = {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  content: React.ReactNode
  composer: React.ReactNode
  drawer: React.ReactNode
}

export function DesktopShell({
  menuBar,
  sidebar,
  content,
  composer,
  drawer,
}: Props): React.ReactNode {
  return (
    <div className="app-shell">
      {menuBar}
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <div className="desktop-main-stage">
            {content}
            <div className="desktop-main-composer">{composer}</div>
          </div>
        </section>
        {drawer}
      </div>
    </div>
  )
}
