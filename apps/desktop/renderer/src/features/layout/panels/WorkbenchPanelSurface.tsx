import { forwardRef } from 'react'
import type React from 'react'
import type { WorkbenchPanelTarget } from '../dock/rightDockState.js'

export function WorkbenchPanelSurface({
  target,
  header,
  children,
}: {
  target: WorkbenchPanelTarget
  header: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div className="workbench-panel-surface">
      <div
        className={`${
          target === 'right' ? 'right-dock-header' : 'bottom-panel-header'
        } workbench-panel-header`}
      >
        {header}
      </div>
      {children}
    </div>
  )
}

export const WorkbenchPanelContent = forwardRef<
  HTMLDivElement,
  {
    target: WorkbenchPanelTarget
    children: React.ReactNode
  }
>(function WorkbenchPanelContent(
  { target, children },
  ref,
): React.ReactNode {
  return (
    <div
      ref={ref}
      className="right-dock-content workbench-panel-content"
      data-app-shell-tab-panel-controller={target}
      tabIndex={-1}
    >
      {children}
    </div>
  )
})
