import type React from 'react'
import { IconButton } from '../../../components/ui/IconButton.js'
import type { WorkbenchPanelSnapshot } from './rightDockState.js'

export type WorkspaceShellControlsProps = {
  rightDockState: WorkbenchPanelSnapshot
  terminalAvailable: boolean
  terminalVisible: boolean
  showBottomPanel: boolean
  showRightPanel: boolean
  onToggleTerminal: () => void
  onToggleRightPanel: () => void
}

export function WorkspaceShellControls({
  rightDockState,
  terminalAvailable,
  terminalVisible,
  showBottomPanel,
  showRightPanel,
  onToggleTerminal,
  onToggleRightPanel,
}: WorkspaceShellControlsProps): React.ReactNode {
  if (!showBottomPanel && !showRightPanel) return null

  return (
    <div className="workspace-shell-controls">
      <div aria-hidden="true" className="workspace-shell-controls__divider" />
      {showBottomPanel ? (
        <IconButton
          aria-label={terminalVisible ? '隐藏底部面板' : '打开底部面板'}
          aria-pressed={terminalVisible}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          disabled={!terminalAvailable}
          size="toolbar"
          title={terminalAvailable
            ? terminalVisible ? '隐藏底部面板' : '打开底部面板 (Ctrl+`)'
            : '创建任务后可使用底部面板'}
          onClick={onToggleTerminal}
        >
          <BottomPanelToggleIcon open={terminalVisible} />
        </IconButton>
      ) : null}
      {showRightPanel ? (
        <IconButton
          aria-label={rightDockState.open ? '关闭右侧面板' : '显示右侧面板'}
          aria-pressed={rightDockState.open}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          size="toolbar"
          title={rightDockState.open ? '关闭右侧面板' : '显示右侧面板'}
          onClick={onToggleRightPanel}
        >
          <RightPanelToggleIcon open={rightDockState.open} />
        </IconButton>
      ) : null}
    </div>
  )
}

export function BottomPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <rect height="14" rx="2.5" stroke="currentColor" width="16" x="2" y="3" />
      <path
        d={open ? 'M2.5 12.5h15' : 'M7 12.5h6'}
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function RightPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
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
