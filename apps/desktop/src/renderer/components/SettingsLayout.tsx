import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsPage } from './SettingsPage.js'
import { WindowChrome } from './WindowChrome.js'
import { useDesktopLayout } from '../features/layout/useDesktopLayout.js'

export function SettingsLayout(): React.ReactNode {
  const navigate = useNavigate()
  const { sidebarCollapsed, sidebarWidth, toggleSidebarCollapsed } =
    useDesktopLayout()

  return (
    <div className="desktop-frame">
      <div className="desktop-chrome">
        <WindowChrome
          sidebarCollapsed={sidebarCollapsed}
          isMaximized={false}
          onToggleSidebar={toggleSidebarCollapsed}
          onClose={() => {
            void window.desktopApi.closeWindow()
          }}
          onMinimize={() => {
            void window.desktopApi.minimizeWindow()
          }}
          onToggleMaximize={() => {
            void window.desktopApi.toggleWindowMaximized()
          }}
          onFileMenuAction={() => {}}
          onEditMenuAction={() => {}}
          onViewMenuAction={() => {}}
          onWindowMenuAction={() => {}}
          onHelpMenuAction={() => {}}
        />
      </div>
      <div className="app-body">
        <div
          aria-hidden="true"
          className={[
            'settings-sidebar-spacer',
            sidebarCollapsed ? 'is-collapsed' : '',
          ].join(' ')}
          style={{ '--sidebar-current-w': `${sidebarWidth}px` } as React.CSSProperties}
        />
        <div className="settings-page-wrapper">
          <SettingsPage onClose={() => navigate(-1)} />
        </div>
      </div>
    </div>
  )
}
