import type React from 'react'

type Props = {
  menuBar: React.ReactNode
  sidebar: React.ReactNode
  children: React.ReactNode
  menubarDebugMode?: boolean
  appBodyRef?: React.Ref<HTMLDivElement>
}

export function DesktopAppShell({
  menuBar,
  sidebar,
  children,
  menubarDebugMode = false,
  appBodyRef,
}: Props): React.ReactNode {
  return (
    <div
      className={
        menubarDebugMode
          ? 'app-shell menubar-debug-mode tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text'
          : 'app-shell tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text'
      }
    >
      <div className="desktop-menubar tw:shrink-0 tw:bg-app-chrome">{menuBar}</div>
      <div
        className="app-body tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden"
        ref={appBodyRef}
      >
        {sidebar}
        <section className="desktop-main tw:flex tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:bg-app-canvas">
          <div className="desktop-main-stage tw:min-w-0 tw:flex-1 tw:overflow-hidden">{children}</div>
        </section>
      </div>
    </div>
  )
}
