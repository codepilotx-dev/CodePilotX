import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { SettingsPage } from './SettingsPage.js'
import { WindowChrome } from './WindowChrome.js'
import { useDesktopLayout } from '../features/layout/useDesktopLayout.js'

export function SettingsLayout(): React.ReactNode {
  const navigate = useNavigate()
  const { sidebarCollapsed, toggleSidebarCollapsed } = useDesktopLayout()

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
      <div className="settings-page-wrapper">
        <button
          className="back-to-app-button"
          onClick={() => navigate(-1)}
          type="button"
        >
          <ArrowLeft size={16} />
          <span>返回应用</span>
        </button>
        <SettingsPage onClose={() => navigate(-1)} />
      </div>
    </div>
  )
}