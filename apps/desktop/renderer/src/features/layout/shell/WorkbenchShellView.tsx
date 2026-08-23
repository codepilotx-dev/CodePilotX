import type React from 'react'

export interface WorkbenchShellViewProps {
  menuBar: React.ReactNode
  primarySidebar: React.ReactNode
  workspaceHeader: React.ReactNode
  mainContent: React.ReactNode
  auxiliaryPanel?: React.ReactNode
  bottomPanel?: React.ReactNode
  appBodyRef?: React.Ref<HTMLDivElement>
  workspaceRef?: React.Ref<HTMLDivElement>
  workspaceStyle?: React.CSSProperties
  primarySidebarVisible: boolean
  auxiliaryPanelVisible: boolean
  bottomPanelVisible: boolean
  auxiliaryMaximized: boolean
  resizeActive: boolean
}

export function WorkbenchShellView({
  menuBar,
  primarySidebar,
  workspaceHeader,
  mainContent,
  auxiliaryPanel,
  bottomPanel,
  appBodyRef,
  workspaceRef,
  workspaceStyle,
  primarySidebarVisible,
  auxiliaryPanelVisible,
  bottomPanelVisible,
  auxiliaryMaximized,
  resizeActive,
}: WorkbenchShellViewProps): React.ReactNode {
  return (
    <div
      className="app-shell tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:text-app-text"
      data-primary-sidebar-visible={primarySidebarVisible}
      data-auxiliary-panel-visible={auxiliaryPanelVisible}
      data-bottom-panel-visible={bottomPanelVisible}
      data-auxiliary-maximized={auxiliaryMaximized}
      data-resize-active={resizeActive}
    >
      <div className="desktop-menubar tw:shrink-0">{menuBar}</div>
      <div
        className="app-body tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden"
        ref={appBodyRef}
      >
        {auxiliaryMaximized ? null : primarySidebar}
        <section className="desktop-main tw:flex tw:min-w-0 tw:flex-1 tw:overflow-hidden">
          <div className="desktop-main-stage tw:min-w-0 tw:flex-1 tw:overflow-hidden">
            <div
              className="desktop-workspace"
              ref={workspaceRef}
              style={workspaceStyle}
            >
              {workspaceHeader}
              <div className="desktop-workspace__upper">
                {auxiliaryMaximized ? null : mainContent}
                {auxiliaryPanel}
              </div>
              {bottomPanel}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
