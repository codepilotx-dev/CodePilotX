import type React from 'react'
import { SquareTerminal } from 'lucide-react'
import { IconButton } from '../../../components/ui/IconButton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
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
      {showBottomPanel ? (
        <IconButton
          aria-label={terminalVisible ? '隐藏集成终端' : '打开集成终端'}
          aria-pressed={terminalVisible}
          className="workspace-shell-control-button"
          disabled={!terminalAvailable}
          title={terminalAvailable
            ? terminalVisible ? '隐藏集成终端' : '打开集成终端 (Ctrl+`)'
            : '创建任务后可使用集成终端'}
          variant="plain"
          onClick={onToggleTerminal}
        >
          <SquareTerminal
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
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
