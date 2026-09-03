import type React from 'react'
import { PanelBottom, PanelRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
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
    <PanelBottom
      aria-hidden="true"
      className="workspace-panel-icon workspace-panel-icon--bottom"
      data-open={open}
      size={APP_ICON_SIZE}
      strokeWidth={APP_ICON_STROKE_WIDTH}
    />
  )
}

export function RightPanelToggleIcon({ open }: { open: boolean }): React.ReactNode {
  return (
    <PanelRight
      aria-hidden="true"
      className="workspace-panel-icon workspace-panel-icon--right"
      data-open={open}
      size={APP_ICON_SIZE}
      strokeWidth={APP_ICON_STROKE_WIDTH}
    />
  )
}
