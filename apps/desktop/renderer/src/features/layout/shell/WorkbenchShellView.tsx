import type React from 'react'
import type { WorkspaceLayout } from '../dock/rightDockState.js'

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
  workspaceLayout: WorkspaceLayout
  resizeActive: boolean
}

/**
 * 主 Chat 与右侧工作区始终占据固定的 React 树位置：布局切换只改变几何与可见性，
 * 不卸载宿主，也不在容器之间搬运组件。
 */
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
  workspaceLayout,
  resizeActive,
}: WorkbenchShellViewProps): React.ReactNode {
  return (
    <div
      className="app-shell tw:flex tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:text-app-text"
      data-primary-sidebar-visible={primarySidebarVisible}
      data-auxiliary-panel-visible={auxiliaryPanelVisible}
      data-bottom-panel-visible={bottomPanelVisible}
      data-resize-active={resizeActive}
      data-workspace-layout={workspaceLayout}
    >
      <div className="desktop-menubar tw:shrink-0">{menuBar}</div>
      <div className="app-body tw:flex tw:min-h-0 tw:flex-1 tw:overflow-hidden" ref={appBodyRef}>
        {primarySidebar}
        <section className="desktop-main tw:flex tw:min-w-0 tw:flex-1 tw:overflow-hidden">
          <div className="desktop-main-stage tw:min-w-0 tw:flex-1 tw:overflow-hidden">
            <div className="desktop-workspace" ref={workspaceRef} style={workspaceStyle}>
              {workspaceHeader}
              <div className="desktop-workspace__upper">
                {mainContent}
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
