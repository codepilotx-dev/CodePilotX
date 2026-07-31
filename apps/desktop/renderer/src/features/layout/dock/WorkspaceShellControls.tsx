import type React from 'react'
import { IconButton } from '../../../components/ui/IconButton.js'
import type { WorkbenchPanelSnapshot } from './rightDockState.js'

export type WorkspaceShellControlsProps = {
  rightDockState: WorkbenchPanelSnapshot
  bottomPanelVisible: boolean
  showBottomPanel: boolean
  showRightPanel: boolean
  onToggleBottomPanel: () => void
  onToggleRightPanel: () => void
}

export function WorkspaceShellControls({
  rightDockState,
  bottomPanelVisible,
  showBottomPanel,
  showRightPanel,
  onToggleBottomPanel,
  onToggleRightPanel,
}: WorkspaceShellControlsProps): React.ReactNode {
  if (!showBottomPanel && !showRightPanel) return null

  return (
    <div className="workspace-shell-controls">
      {showBottomPanel ? (
        <IconButton
          aria-label={bottomPanelVisible ? '隐藏底部面板' : '显示底部面板'}
          aria-pressed={bottomPanelVisible}
          className="workspace-shell-control-button"
          title={bottomPanelVisible ? '隐藏底部面板' : '显示底部面板'}
          variant="plain"
          onClick={onToggleBottomPanel}
        >
          <BottomPanelToggleIcon open={bottomPanelVisible} />
        </IconButton>
      ) : null}
      {showRightPanel ? (
        <IconButton
          aria-label={rightDockState.open ? '关闭右侧面板' : '显示右侧面板'}
          aria-pressed={rightDockState.open}
          className="workspace-shell-control-button"
          title={rightDockState.open ? '关闭右侧面板' : '显示右侧面板'}
          variant="plain"
          onClick={onToggleRightPanel}
        >
          <RightPanelToggleIcon open={rightDockState.open} />
        </IconButton>
      ) : null}
    </div>
  )
}

function BottomPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <rect height="14" rx="2.5" stroke="currentColor" width="16" x="2" y="3" />
      <path
        d={open ? 'M2.5 12.25h15' : 'M7 12.9h6'}
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RightPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <rect height="14" rx="2.5" stroke="currentColor" width="16" x="2" y="3" />
      <path
        d={open ? 'M12.25 3.5v13' : 'M12.9 7v6'}
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  )
}
