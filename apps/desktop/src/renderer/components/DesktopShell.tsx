import type React from 'react'

type Props = {
  windowChrome: React.ReactNode
  sidebar: React.ReactNode
  content: React.ReactNode
  composer: React.ReactNode
}

export function DesktopShell({
  windowChrome,
  sidebar,
  content,
  composer,
}: Props): React.ReactNode {
  return (
    <div className="app-shell">
      <div className="desktop-chrome">{windowChrome}</div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <div className="desktop-main-stage">
            {content}
            {composer ? <div className="desktop-main-composer">{composer}</div> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
