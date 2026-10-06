import type React from 'react'
import { PanelBottom, PanelRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import type { WorkbenchPanelSnapshot, WorkspaceLayout } from './rightDockState.js'

export type WorkspaceShellControlsProps = {
  rightDockState: WorkbenchPanelSnapshot
  hasWorkspaceTabs: boolean
  workspaceLayout: WorkspaceLayout
  /** 空工作区的“新建标签页”复用浏览器标签创建流程；不可用时禁用并给出原因。 */
  canCreateWorkspaceTab: boolean
  createWorkspaceTabReason?: string
  terminalAvailable: boolean
  terminalVisible: boolean
  showBottomPanel: boolean
  showRightPanel: boolean
  onToggleTerminal: () => void
  /** 在仅聊天与分屏之间切换。 */
  onStepWorkspaceLayout: () => void
  onCreateWorkspaceTab: () => void
}

/**
 * 右侧工作区入口文案与可观察布局同步：
 * chat 显示“显示标签页”（无标签时是“新建标签页”），split 显示“隐藏标签页”。
 */
export function resolveWorkspaceControlPresentation(
  layout: WorkspaceLayout,
  hasTabs: boolean,
): { label: string; pressed: boolean } {
  if (layout === 'chat') {
    return { label: hasTabs ? '显示标签页' : '新建标签页', pressed: false }
  }
  return { label: '隐藏标签页', pressed: true }
}

export function WorkspaceShellControls({
  canCreateWorkspaceTab,
  createWorkspaceTabReason,
  hasWorkspaceTabs,
  workspaceLayout,
  terminalAvailable,
  terminalVisible,
  showBottomPanel,
  showRightPanel,
  onToggleTerminal,
  onStepWorkspaceLayout,
  onCreateWorkspaceTab,
}: WorkspaceShellControlsProps): React.ReactNode {
  if (!showBottomPanel && !showRightPanel) return null

  const workspaceControl = resolveWorkspaceControlPresentation(
    workspaceLayout,
    hasWorkspaceTabs,
  )
  const creatingEmptyWorkspace = workspaceLayout === 'chat' && !hasWorkspaceTabs

  return (
    <div className="workspace-shell-controls">
      <div aria-hidden="true" className="workspace-shell-controls__divider" />
      {showBottomPanel ? (
        <Button isIconOnly
          aria-label={terminalVisible ? '隐藏底部面板' : '打开底部面板'}
          aria-pressed={terminalVisible}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          disabled={!terminalAvailable}
          size="toolbar"
          title={
            terminalAvailable
              ? terminalVisible
                ? '隐藏底部面板'
                : '打开底部面板 (Ctrl+`)'
              : '创建任务后可使用底部面板'
          }
          onClick={onToggleTerminal}
        >
          <BottomPanelToggleIcon open={terminalVisible} />
        </Button>
      ) : null}
      {showRightPanel ? (
        <Button isIconOnly
          aria-label={
            creatingEmptyWorkspace
              ? `${workspaceControl.label} (Ctrl+Shift+B)`
              : workspaceControl.label
          }
          aria-pressed={creatingEmptyWorkspace ? false : workspaceControl.pressed}
          className="workspace-shell-control-button"
          color="ghostSecondary"
          disabled={creatingEmptyWorkspace && !canCreateWorkspaceTab}
          size="toolbar"
          title={
            creatingEmptyWorkspace
              ? canCreateWorkspaceTab
                ? '新建标签页 (Ctrl+Shift+B)'
                : (createWorkspaceTabReason ?? '当前环境无法新建标签页')
              : `${workspaceControl.label} (Ctrl+Shift+B)`
          }
          onClick={creatingEmptyWorkspace ? onCreateWorkspaceTab : onStepWorkspaceLayout}
        >
          <RightPanelToggleIcon open={creatingEmptyWorkspace ? false : workspaceControl.pressed} />
        </Button>
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
