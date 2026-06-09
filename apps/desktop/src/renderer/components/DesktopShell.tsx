import type React from 'react'

type Props = {
  sidebar: React.ReactNode
  topbar: React.ReactNode
  content: React.ReactNode
  composer: React.ReactNode
  drawer: React.ReactNode
}

export function DesktopShell({
  sidebar,
  topbar,
  content,
  composer,
  drawer,
}: Props): React.ReactNode {
  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">{sidebar}</aside>
      <section className="desktop-main">
        <header className="desktop-main-topbar">{topbar}</header>
        <div className="desktop-main-stage">{content}</div>
        <div className="desktop-main-composer">{composer}</div>
      </section>
      {drawer}
    </div>
  )
}
