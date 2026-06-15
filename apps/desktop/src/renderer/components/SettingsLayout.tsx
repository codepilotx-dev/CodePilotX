import { desktopClient } from '../services/desktopClient.js'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SettingsNav } from './SettingsNav.js'
import { SettingsPage } from './SettingsPage.js'
import { WindowChrome } from './WindowChrome.js'
import { GlobalErrorModal } from './GlobalErrorModal.js'
import { useDesktopLayout } from '../features/layout/useDesktopLayout.js'

export function SettingsLayout(): React.ReactNode {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') ?? 'general'
  const [activeTab, setActiveTab] = useState(requestedTab)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { sidebarCollapsed, sidebarWidth, toggleSidebarCollapsed } =
    useDesktopLayout()

  useEffect(() => {
    setActiveTab(requestedTab)
  }, [requestedTab])

  function handleTabChange(tab: string): void {
    setActiveTab(tab)
    setSearchParams(tab === 'general' ? {} : { tab })
  }

  const windowChrome = (
    <WindowChrome
      sidebarCollapsed={sidebarCollapsed}
      isMaximized={false}
      onToggleSidebar={toggleSidebarCollapsed}
      onClose={() => {
        void desktopClient.closeWindow()
      }}
      onMinimize={() => {
        void desktopClient.minimizeWindow()
      }}
      onToggleMaximize={() => {
        void desktopClient.toggleWindowMaximized()
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
        onTabChange={handleTabChange}
        onBack={() => navigate(-1)}
      />
    </aside>
  )

  return (
    <div className="app-shell">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      <div className="desktop-chrome">{windowChrome}</div>
      <div className="app-body">
        {sidebar}
        <section className="desktop-main">
          <SettingsPage activeTab={activeTab} onError={setErrorMessage} />
        </section>
      </div>
    </div>
  )
}
