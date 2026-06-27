import type React from 'react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, PanelRight, Plus, X } from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import type { RightDockPanelContext, RightDockToolId } from './rightDockTools.js'
import {
  getRightDockTool,
  isRightDockToolEnabled,
  rightDockTools,
} from './rightDockTools.js'
import { rightDockPanelRenderers } from './rightDockPanelRenderers.js'
import type { RightDockState } from './rightDockState.js'

type Props = {
  state: RightDockState
  browserState: DesktopBrowserState | null
  debugMode?: boolean
  defaultBranch: string | null
  files: DesktopFileEntry[]
  gitStatus: DesktopGitStatus | null
  isRefreshingReview: boolean
  maxWidth: number
  minWidth: number
  reviewView: DesktopReviewView
  selectedFile: DesktopFilePreview | null
  sessionId: string | null
  sessionStatus: DesktopSessionStatus
  width: number
  workspace: DesktopWorkspace | null
  onAppendBrowserAnnotation: (text: string) => void
  onBrowserStateChange: (state: DesktopBrowserState) => void
  onClose: () => void
  onCloseTool: (tool: RightDockToolId) => void
  onCreateBranch: () => void
  onOpenTool: (tool: RightDockToolId) => void
  onOpenWorkspacePath: () => void
  onPreviewFile: (file: DesktopFileEntry) => void
  onRefreshReview: () => void
  onResetWidth: () => void
  onSelectTool: (tool: RightDockToolId) => void
  onSetWidth: (width: number) => void
  onToggleReviewView: () => void
}

export function RightDock({
  state,
  browserState,
  debugMode = false,
  defaultBranch,
  files,
  gitStatus,
  isRefreshingReview,
  maxWidth,
  minWidth,
  reviewView,
  selectedFile,
  sessionId,
  sessionStatus,
  width,
  workspace,
  onAppendBrowserAnnotation,
  onBrowserStateChange,
  onClose,
  onCloseTool,
  onCreateBranch,
  onOpenTool,
  onOpenWorkspacePath,
  onPreviewFile,
  onRefreshReview,
  onResetWidth,
  onSelectTool,
  onSetWidth,
  onToggleReviewView,
}: Props): React.ReactNode {
  const flags = useMemo<RightDockPanelContext['flags']>(() => ({ debugMode }), [debugMode])
  const openedTools = useMemo(
    () =>
      state.openTools
        .map(id => getRightDockTool(id))
        .filter(
          (tool): tool is NonNullable<ReturnType<typeof getRightDockTool>> =>
            Boolean(tool) && isRightDockToolEnabled(tool.id, flags),
        ),
    [flags, state.openTools],
  )
  const addableTools = useMemo(
    () => rightDockTools.filter(tool => isRightDockToolEnabled(tool.id, flags)),
    [flags],
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const resizeStartRef = useRef<{
    startWidth: number
    startX: number
  } | null>(null)
  const [resizing, setResizing] = useState(false)

const panelContext = useMemo<RightDockPanelContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch,
        gitStatus,
        isRefreshing: isRefreshingReview,
        reviewView,
        sessionStatus,
        workspacePath: workspace?.path ?? null,
        onClose,
        onCreateBranch,
        onOpenWorkspacePath,
        onRefreshDiff: onRefreshReview,
        onToggleReviewView,
      },
      browser: {
        state: browserState,
        onAppendAnnotation: onAppendBrowserAnnotation,
        onStateChange: onBrowserStateChange,
      },
      files: {
        files,
        selectedFile,
        workspace,
        onPreviewFile,
      },
      flags,
    }),
    [
      browserState,
      defaultBranch,
      files,
      flags,
      gitStatus,
      isRefreshingReview,
      onAppendBrowserAnnotation,
      onBrowserStateChange,
      onClose,
      onCreateBranch,
      onOpenWorkspacePath,
      onRefreshReview,
      onToggleReviewView,
      reviewView,
      selectedFile,
      sessionId,
      sessionStatus,
      workspace,
    ],
  )

  useEffect(() => {
    if (!state.open || state.activeTool !== 'browser') {
      void desktopClient
        .setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 })
        .then(onBrowserStateChange)
        .catch(() => undefined)
    }
  }, [onBrowserStateChange, state.activeTool, state.open])

  useEffect(() => {
    if (!resizing) return

    const handlePointerMove = (event: PointerEvent): void => {
      const start = resizeStartRef.current
      if (!start) return
      onSetWidth(start.startWidth + start.startX - event.clientX)
    }

    const handlePointerUp = (): void => {
      resizeStartRef.current = null
      setResizing(false)
      document.body.classList.remove('right-dock-is-resizing')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.classList.remove('right-dock-is-resizing')
    }
  }, [onSetWidth, resizing])

  const activePanelRenderer = state.activeTool
    ? rightDockPanelRenderers[state.activeTool]
    : null

  return (
    <aside
      className={resizing ? 'right-dock resizing' : 'right-dock'}
      aria-label="右侧工具栏"
      style={{ flexBasis: width, maxWidth, minWidth, width }}
    >
      <div
        aria-label="调整右侧栏宽度"
        aria-orientation="vertical"
        aria-valuemax={maxWidth}
        aria-valuemin={minWidth}
        aria-valuenow={width}
        className="right-dock-resize-handle"
        role="separator"
        tabIndex={0}
        title="拖拽调整宽度，双击恢复默认宽度"
        onDoubleClick={onResetWidth}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            onSetWidth(width + 24)
            return
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            onSetWidth(width - 24)
            return
          }
          if (event.key === 'Home') {
            event.preventDefault()
            onSetWidth(maxWidth)
            return
          }
          if (event.key === 'End') {
            event.preventDefault()
            onSetWidth(minWidth)
          }
        }}
        onPointerDown={event => {
          event.preventDefault()
          resizeStartRef.current = {
            startWidth: width,
            startX: event.clientX,
          }
          document.body.classList.add('right-dock-is-resizing')
          setResizing(true)
        }}
      />
      <header className="right-dock-tabs">
        <div className="right-dock-tab-list" role="tablist">
          {openedTools.length > 0 ? (
            openedTools.map((tool, index) => {
              const isActive = state.activeTool === tool.id
              return (
                <Fragment key={tool.id}>
                  {index > 0 ? <span className="right-dock-tab-divider" /> : null}
                  <div
                    className={
                      isActive ? 'right-dock-tab-wrap active' : 'right-dock-tab-wrap'
                    }
                    role="tab"
                    aria-selected={isActive}
                  >
                    <button
                      className={isActive ? 'right-dock-tab active' : 'right-dock-tab'}
                      title={tool.label}
                      type="button"
                      onClick={() => onSelectTool(tool.id)}
                    >
                      <span className="right-dock-tab-icon">{tool.icon}</span>
                      <span>{tool.label}</span>
                    </button>
                    <IconButton
                      className="right-dock-tab-close"
                      title={`关闭 ${tool.label}`}
                      onClick={event => {
                        event.stopPropagation()
                        onCloseTool(tool.id)
                      }}
                    >
                      <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                  </div>
                </Fragment>
              )
            })
          ) : (
            <span className="right-dock-tab-empty">使用 + 添加工具</span>
          )}
          <PopoverMenu
            align="end"
            className="popover-right-dock-add"
            open={menuOpen}
            side="bottom"
            sideOffset={6}
            trigger={
              <button
                className="right-dock-add-button"
                type="button"
                title="添加工具"
              >
                <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </button>
            }
            onOpenChange={setMenuOpen}
          >
            {addableTools.map(tool => {
              const opened = state.openTools.includes(tool.id)
              const isActive = state.activeTool === tool.id
              return (
                <PopoverItem
                  key={tool.id}
                  active={isActive}
                  icon={tool.icon}
                  selected={opened}
                  shortcut={tool.shortcut}
                  onClick={() => {
                    if (opened) {
                      onSelectTool(tool.id)
                    } else {
                      onOpenTool(tool.id)
                    }
                    setMenuOpen(false)
                  }}
                >
                  {tool.label}
                </PopoverItem>
              )
            })}
          </PopoverMenu>
        </div>
        <div className="right-dock-controls">
          <IconButton className="right-dock-control" title="隐藏右侧面板" onClick={onClose}>
            <Minus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton className="right-dock-control active" title="关闭右侧面板" onClick={onClose}>
            <PanelRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
      </header>

      <div className="right-dock-content">
        {state.open && activePanelRenderer ? activePanelRenderer(panelContext) : (
          <div className="right-dock-empty-state">
            <strong>右侧工具栏</strong>
            <span>使用 + 选择要打开的工具</span>
          </div>
        )}
      </div>
    </aside>
  )
}
