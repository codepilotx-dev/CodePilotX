import type React from 'react'

type Props = {
  windowChrome: React.ReactNode
  menuBar: React.ReactNode
  mainToolbar: React.ReactNode
  sidebar: React.ReactNode
  content: React.ReactNode
  composer: React.ReactNode
  drawer: React.ReactNode
}

export function DesktopShell({
  windowChrome,
  menuBar,
  mainToolbar,
  sidebar,
  content,
  composer,
  drawer,
}: Props): React.ReactNode {
  return (
    <div className="app-shell">
      <div className="desktop-chrome">
        {windowChrome}
        {menuBar}
      </div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          {mainToolbar}
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
