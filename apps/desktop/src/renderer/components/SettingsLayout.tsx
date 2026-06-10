import type React from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsNav } from './SettingsNav.js'
import { SettingsPage } from './SettingsPage.js'
import { WindowChrome } from './WindowChrome.js'
import { useDesktopLayout } from '../features/layout/useDesktopLayout.js'

export function SettingsLayout(): React.ReactNode {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('general')
  const { sidebarCollapsed, sidebarWidth, toggleSidebarCollapsed } =
    useDesktopLayout()

  const windowChrome = (
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
  )

  const sidebar = (
    <aside
      aria-label="Settings"
      className={[
        'desktop-sidebar',
        'settings-shell-sidebar',
        sidebarCollapsed ? 'is-collapsed' : '',
      ].join(' ')}
      style={{ '--sidebar-current-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <SettingsNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onBack={() => navigate(-1)}
      />
    </aside>
  )

  return (
    <div className="app-shell">
      <div className="desktop-chrome">{windowChrome}</div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <SettingsPage activeTab={activeTab} />
        </section>
      </div>
    </div>
  )
}
