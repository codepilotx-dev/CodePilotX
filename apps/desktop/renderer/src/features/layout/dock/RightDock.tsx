import type React from 'react'
import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Maximize2,
  Minimize2,
  MoveDown,
  MoveRight,
  Pin,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import type { ReviewTabUiState } from '../tabs/conversationUiState.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import type {
  MarkdownFileViewMode,
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from './rightDockState.js'
import {
  createLauncherTab,
  getWorkbenchLauncherDefinitions,
  getWorkbenchTabDefinition,
  type WorkbenchTabRenderContext,
} from '../tabs/workbenchTabRegistry.js'
import type { FileDocumentLoadErrorPhase } from './RightDockPanels.js'
import {
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from '../useSidebarResizeCollapseConfirm.js'

type Props = {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  browserState: DesktopBrowserState | null
  debugMode?: boolean
  defaultBranch: string | null
  files: DesktopFileEntry[]
  gitStatus: DesktopGitStatus | null
  isRefreshingReview: boolean
  diffMarkerStyle: DesktopDiffMarkerStyle
  maxWidth: number
  minWidth: number
  reviewView: DesktopReviewView
  reviewTabState: ReviewTabUiState
  selectedFile: DesktopFilePreview | null
  sessionId: string | null
  sessionStatus: DesktopSessionStatus
  planContentByEventId: Readonly<Record<string, string>>
  width: number
  height?: number
  rightFullWidth?: boolean
  workspace: DesktopWorkspace | null
  onAppendBrowserAnnotation: (text: string) => void
  onBrowserStateChange: (state: DesktopBrowserState) => void
  onClose: () => void
  onCloseTab: (tabId: WorkbenchTabId) => void
  onCloseOtherTabs: (tabId: WorkbenchTabId) => void
  onCloseTabsToRight: (tabId: WorkbenchTabId) => void
  onCreateBranch: () => void
  onFileLoadError: (event: WorkbenchFileLoadErrorEvent) => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  onOpenWorkspacePath: () => void
  onOpenFileFromBrowser: (file: DesktopFileEntry) => void
  onPreviewFile: (file: DesktopFileEntry) => void
  onAppendComposerText: (text: string) => void
  onAddComposerFiles: (filePaths: string[]) => void
  onRefreshReview: () => void
  onReviewTabStateChange: (
    value:
      | ReviewTabUiState
      | ((current: ReviewTabUiState) => ReviewTabUiState),
  ) => void
  onResetWidth: () => void
  onResetHeight?: () => void
  onSelectTab: (tabId: WorkbenchTabId) => void
  onResizePreviewWidth?: (width: number) => void
  onSetWidth: (width: number) => void
  onSetHeight?: (height: number) => void
  onMoveTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  onReorderTab: (
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index: number,
  ) => void
  onPinTab: (tabId: WorkbenchTabId) => void
  onSetFileMarkdownViewMode: (
    tabId: WorkbenchTabId,
    mode: MarkdownFileViewMode,
  ) => void
  onToggleRightFullWidth?: () => void
  onToggleReviewView: () => void
  sideChatComposer: React.ReactNode
  sideChatFocusVersion: number
  activeSideTaskId: string | null
  sideTaskContent?: React.ReactNode
}

type FilePreviewTab = Extract<
  WorkbenchTabDescriptor,
  { kind: 'file-preview' }
>

export type WorkbenchFileLoadErrorEvent = {
  error: Error
  phase: FileDocumentLoadErrorPhase
  tab: FilePreviewTab
  target: WorkbenchPanelTarget
}

export function WorkbenchPanel({
  target,
  state,
  tabsById,
  browserState,
  debugMode = false,
  defaultBranch,
  files,
  gitStatus,
  isRefreshingReview,
  diffMarkerStyle,
  maxWidth,
  minWidth,
  reviewView,
  reviewTabState,
  selectedFile,
  sessionId,
  sessionStatus,
  planContentByEventId,
  width,
  height,
  rightFullWidth = false,
  workspace,
  onAppendBrowserAnnotation,
  onBrowserStateChange,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCreateBranch,
  onFileLoadError,
  onOpenTab,
  onOpenWorkspacePath,
  onOpenFileFromBrowser,
  onPreviewFile,
  onAppendComposerText,
  onAddComposerFiles,
  onRefreshReview,
  onReviewTabStateChange,
  onResetWidth,
  onResetHeight,
  onSelectTab,
  onResizePreviewWidth,
  onSetWidth,
  onSetHeight,
  onMoveTab,
  onReorderTab,
  onPinTab,
  onSetFileMarkdownViewMode,
  onToggleRightFullWidth,
  onToggleReviewView,
  sideChatComposer,
  sideChatFocusVersion,
  activeSideTaskId,
  sideTaskContent,
}: Props): React.ReactNode {
  const flags = useMemo(() => ({ debugMode }), [debugMode])
  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: false,
    maxWidth,
    minWidth,
    width,
    onCollapse: onClose,
    onResizePreview: target === 'right' ? onResizePreviewWidth : undefined,
    onSetWidth,
    direction: 'right',
  })

  const startBottomResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (target !== 'bottom' || !onSetHeight || height === undefined) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height
      const onPointerMove = (moveEvent: PointerEvent): void => {
        onSetHeight(startHeight + startY - moveEvent.clientY)
      }
      const onPointerUp = (): void => {
        document.body.classList.remove('bottom-panel-is-resizing')
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }
      document.body.classList.add('bottom-panel-is-resizing')
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    },
    [height, onSetHeight, target],
  )

  const handleBottomResizeKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (target !== 'bottom' || !onSetHeight || height === undefined) return
      const step = event.shiftKey ? 40 : 10
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        onSetHeight(height + step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        onSetHeight(height - step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        onResetHeight?.()
      }
    },
    [height, onResetHeight, onSetHeight, target],
  )

  const panelContext = useMemo<WorkbenchTabRenderContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch,
        gitStatus,
        isRefreshing: isRefreshingReview,
        diffMarkerStyle,
        reviewView,
        reviewTabState,
        sessionStatus,
        workspacePath: workspace?.path ?? null,
        onAppendComposerText,
        onClose,
        onCreateBranch,
        onOpenWorkspacePath,
        onRefreshDiff: onRefreshReview,
        onReviewTabStateChange,
        onToggleReviewView,
      },
      browser: {
        state: browserState,
        onAppendAnnotation: onAppendBrowserAnnotation,
        onAppendComposerText,
        onStateChange: onBrowserStateChange,
      },
      files: {
        files,
        selectedFile,
        workspace,
        onOpenFileFromBrowser,
        onPreviewFile,
        onAppendComposerText,
        onAddComposerFiles,
        onPinFileTab: onPinTab,
        onSetFileMarkdownViewMode,
        onLoadError: (tab, error, phase) =>
          onFileLoadError({ error, phase, tab, target }),
      },
      planContentByEventId,
      sideChat: {
        composer: sideChatComposer,
        focusVersion: sideChatFocusVersion,
        available: activeSideTaskId === null,
      },
      sideTask: {
        activeTaskId: activeSideTaskId,
        content: sideTaskContent,
      },
      flags,
    }),
    [
      browserState,
      defaultBranch,
      diffMarkerStyle,
      files,
      flags,
      gitStatus,
      isRefreshingReview,
      onAddComposerFiles,
      onAppendBrowserAnnotation,
      onAppendComposerText,
      onBrowserStateChange,
      onClose,
      onCreateBranch,
      onFileLoadError,
      onOpenWorkspacePath,
      onOpenFileFromBrowser,
      onPreviewFile,
      onPinTab,
      onSetFileMarkdownViewMode,
      onRefreshReview,
      onToggleReviewView,
      planContentByEventId,
      reviewView,
      selectedFile,
      sessionId,
      sessionStatus,
      sideChatComposer,
      sideChatFocusVersion,
      activeSideTaskId,
      sideTaskContent,
      target,
      workspace,
    ],
  )

  return (
    <>
      <aside
        aria-label={target === 'right' ? '右侧面板' : '底部面板'}
        className={`${target === 'right' ? 'right-dock' : 'bottom-panel'}${resizing && target === 'right' ? ' resizing' : ''} workbench-panel`}
        data-workbench-panel-target={target}
      >
        {target === 'right' && !rightFullWidth ? (
          <div
            aria-label="调整右侧面板宽度"
            aria-orientation="vertical"
            aria-valuemax={maxWidth}
            aria-valuemin={minWidth}
            aria-valuenow={width}
            className="right-dock-resize-handle"
            role="separator"
            tabIndex={0}
            title="拖拽调整宽度，双击恢复默认宽度"
            onDoubleClick={onResetWidth}
            onKeyDown={handleResizeKey}
            onPointerDown={startResize}
          />
        ) : target === 'bottom' ? (
          <div
            aria-label="调整底部面板高度"
            aria-orientation="horizontal"
            aria-valuemax={Math.floor(window.innerHeight * 0.5)}
            aria-valuemin={160}
            aria-valuenow={height}
            className="bottom-panel-resize-handle"
            role="separator"
            tabIndex={0}
            title="拖拽调整高度，双击恢复默认高度"
            onDoubleClick={onResetHeight}
            onKeyDown={handleBottomResizeKey}
            onPointerDown={startBottomResize}
          />
        ) : null}
        <div className={`${target === 'right' ? 'right-dock-header' : 'bottom-panel-header'} workbench-panel-header`}>
          <WorkbenchTabsHeader
            flags={flags}
            state={state}
            tabsById={tabsById}
            target={target}
            onCloseOtherTabs={onCloseOtherTabs}
            onCloseTab={onCloseTab}
            onCloseTabsToRight={onCloseTabsToRight}
            onMoveTab={onMoveTab}
            onOpenTab={onOpenTab}
            onPinTab={onPinTab}
            onReorderTab={onReorderTab}
            onSelectTab={onSelectTab}
          />
          {target === 'right' && onToggleRightFullWidth ? (
            <IconButton
              aria-pressed={rightFullWidth}
              className="right-dock-full-width"
              title={rightFullWidth ? '恢复右侧面板宽度' : '展开右侧面板'}
              variant="plain"
              onClick={onToggleRightFullWidth}
            >
              {rightFullWidth ? (
                <Minimize2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              ) : (
                <Maximize2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              )}
            </IconButton>
          ) : null}
        </div>
        <div
          className="right-dock-content workbench-panel-content"
          data-app-shell-tab-panel-controller={target}
          tabIndex={-1}
        >
          {state.tabIds.length > 0 ? (
            state.tabIds.map(tabId => {
              const tab = tabsById[tabId]
              if (!tab) return null
              const active = state.activeTabId === tab.id
              const definition = getWorkbenchTabDefinition(tab)
              const shouldMount =
                active ||
                (tab.kind !== 'browser' && tab.kind !== 'side-task')
              return (
                <div
                  key={tab.id}
                  aria-labelledby={`workbench-tab-${target}-${domId(tab.id)}`}
                  className="workbench-tab-panel"
                  hidden={!active}
                  id={`workbench-panel-${target}-${domId(tab.id)}`}
                  role="tabpanel"
                  tabIndex={active ? 0 : -1}
                >
                  {shouldMount ? (
                    <TabErrorBoundary tabId={tab.id}>
                      {definition.render(tab, panelContext)}
                    </TabErrorBoundary>
                  ) : null}
                </div>
              )
            })
          ) : (
            <WorkbenchLauncher
              flags={flags}
              onOpenTab={onOpenTab}
            />
          )}
        </div>
      </aside>
      {collapseConfirmTarget ? (
        <div
          key={collapseConfirmKey}
          aria-hidden="true"
          className="sidebar-collapse-confirm-target"
          style={
            {
              '--sidebar-collapse-target-ms': `${SIDEBAR_COLLAPSE_HOLD_MS}ms`,
              '--sidebar-collapse-target-size': `${SIDEBAR_COLLAPSE_TARGET_SIZE}px`,
              left: `${collapseConfirmTarget.x}px`,
              top: `${collapseConfirmTarget.y}px`,
            } as React.CSSProperties
          }
        />
      ) : null}
    </>
  )
}

function WorkbenchTabsHeader({
  target,
  state,
  tabsById,
  flags,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onOpenTab,
  onSelectTab,
  onMoveTab,
  onReorderTab,
  onPinTab,
}: {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  flags: { debugMode: boolean }
  onCloseTab: (tabId: WorkbenchTabId) => void
  onCloseOtherTabs: (tabId: WorkbenchTabId) => void
  onCloseTabsToRight: (tabId: WorkbenchTabId) => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  onSelectTab: (tabId: WorkbenchTabId) => void
  onMoveTab: Props['onMoveTab']
  onReorderTab: Props['onReorderTab']
  onPinTab: (tabId: WorkbenchTabId) => void
}): React.ReactNode {
  const tabRefs = useRef(new Map<WorkbenchTabId, HTMLButtonElement>())
  const [menuOpen, setMenuOpen] = useState(false)
  const launchers = useMemo(
    () => getWorkbenchLauncherDefinitions(flags),
    [flags],
  )

  useEffect(() => {
    const activeTabId = state.activeTabId
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [state.activeTabId])

  const focusAt = (index: number): void => {
    const tabId = state.tabIds[index]
    if (!tabId) return
    onSelectTab(tabId)
    requestAnimationFrame(() => tabRefs.current.get(tabId)?.focus())
  }

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    tabId: WorkbenchTabId,
  ): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt((index - 1 + state.tabIds.length) % state.tabIds.length)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt((index + 1) % state.tabIds.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(state.tabIds.length - 1)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      onCloseTab(tabId)
    }
  }

  return (
    <div
      className="right-dock-tabs-header"
    >
      <div className="right-dock-tabs-viewport">
        <div
          aria-label={target === 'right' ? '右侧面板标签' : '底部面板标签'}
          className="right-dock-tab-list"
          role="tablist"
        >
          {state.tabIds.map((tabId, index) => {
            const tab = tabsById[tabId]
            if (!tab) return null
            const definition = getWorkbenchTabDefinition(tab)
            const tabIcon = definition.getIcon?.(tab) ?? definition.icon
            const active = state.activeTabId === tab.id
            const canCloseRight = index < state.tabIds.length - 1
            const hasDivider =
              !active &&
              canCloseRight &&
              state.tabIds[index + 1] !== state.activeTabId
            return (
              <Fragment key={tab.id}>
                <AppContextMenu
                  actions={[
                    ...(tab.kind === 'file-preview' && tab.preview
                      ? [
                          {
                            kind: 'item' as const,
                            label: '固定预览',
                            icon: <Pin size={APP_ICON_SIZE} />,
                            onSelect: () => onPinTab(tab.id),
                          },
                        ]
                      : []),
                    {
                      kind: 'item',
                      label: '关闭',
                      onSelect: () => onCloseTab(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭其他标签',
                      disabled: state.tabIds.length <= 1,
                      onSelect: () => onCloseOtherTabs(tab.id),
                    },
                    {
                      kind: 'item',
                      label: '关闭右侧标签',
                      disabled: !canCloseRight,
                      onSelect: () => onCloseTabsToRight(tab.id),
                    },
                    { kind: 'separator' },
                    {
                      kind: 'item',
                      label: `移到${target === 'right' ? '底部' : '右侧'}面板`,
                      icon:
                        target === 'right' ? (
                          <MoveDown size={APP_ICON_SIZE} />
                        ) : (
                          <MoveRight size={APP_ICON_SIZE} />
                        ),
                      onSelect: () =>
                        onMoveTab(
                          target,
                          target === 'right' ? 'bottom' : 'right',
                          tab.id,
                        ),
                    },
                  ]}
                  trigger={
                    <div
                      className={`right-dock-tab-wrap${active ? ' active' : ''}${hasDivider ? ' has-divider' : ''}`}
                      data-panel-tab={tab.id}
                      draggable
                      onDragEnd={event =>
                        event.currentTarget.classList.remove('dragging')
                      }
                      onDragOver={event => event.preventDefault()}
                      onDragStart={event => {
                        event.currentTarget.classList.add('dragging')
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(
                          'application/x-codepilotx-workbench-tab',
                          JSON.stringify({ source: target, tabId: tab.id }),
                        )
                      }}
                      onDrop={event => {
                        event.preventDefault()
                        const payload = readTabDragPayload(event)
                        if (!payload) return
                        if (payload.source === target) {
                          onReorderTab(target, payload.tabId, index)
                        } else {
                          onMoveTab(payload.source, target, payload.tabId, index)
                        }
                      }}
                    >
                      <button
                        ref={element => {
                          if (element) tabRefs.current.set(tab.id, element)
                          else tabRefs.current.delete(tab.id)
                        }}
                        aria-controls={`workbench-panel-${target}-${domId(tab.id)}`}
                        aria-selected={active}
                        className={`right-dock-tab${active ? ' active' : ''}${tab.kind === 'file-preview' && tab.preview ? ' preview' : ''}`}
                        id={`workbench-tab-${target}-${domId(tab.id)}`}
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        title={definition.getTitle(tab)}
                        type="button"
                        onClick={() => onSelectTab(tab.id)}
                        onDoubleClick={() => {
                          if (tab.kind === 'file-preview' && tab.preview) {
                            onPinTab(tab.id)
                          }
                        }}
                        onKeyDown={event =>
                          handleTabKeyDown(event, index, tab.id)
                        }
                        onMouseDown={event => {
                          if (event.button !== 1) return
                          event.preventDefault()
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <span className="right-dock-tab-icon">{tabIcon}</span>
                        <span className="right-dock-tab-title">
                          {definition.getTitle(tab)}
                        </span>
                      </button>
                      <IconButton
                        aria-label={`关闭 ${definition.getTitle(tab)}`}
                        className="right-dock-tab-close"
                        title={`关闭 ${definition.getTitle(tab)}`}
                        variant="plain"
                        onMouseDown={event => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                          event.stopPropagation()
                          onCloseTab(tab.id)
                        }}
                      >
                        <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      </IconButton>
                    </div>
                  }
                  width="auto"
                />
              </Fragment>
            )
          })}
          <span
            aria-hidden="true"
            className="right-dock-tab-empty"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault()
              const payload = readTabDragPayload(event)
              if (payload && payload.source !== target) {
                onMoveTab(payload.source, target, payload.tabId)
              }
            }}
          />
        </div>
      </div>
      <PopoverMenu
        align="end"
        avoidCollisions={false}
        className="popover-right-dock-add"
        collisionPadding={44}
        open={menuOpen}
        side="bottom"
        sideOffset={12}
        width={220}
        trigger={
          <button
            aria-label="添加标签"
            className="right-dock-add-button"
            title="添加标签"
            type="button"
          >
            <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </button>
        }
        onOpenChange={setMenuOpen}
      >
        {launchers.map(definition => {
          const candidate = createLauncherTab(definition.kind)
          if (!candidate) return null
          const opened = state.tabIds.includes(candidate.id)
          return (
            <PopoverItem
              key={definition.kind}
              active={state.activeTabId === candidate.id}
              icon={definition.icon}
              selected={opened}
              shortcut={definition.shortcut}
              onClick={() => {
                if (opened) onSelectTab(candidate.id)
                else onOpenTab(candidate)
                setMenuOpen(false)
              }}
            >
              {definition.label}
            </PopoverItem>
          )
        })}
      </PopoverMenu>
    </div>
  )
}

function WorkbenchLauncher({
  flags,
  onOpenTab,
}: {
  flags: { debugMode: boolean }
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
}): React.ReactNode {
  return (
    <div
      aria-label="可用面板标签"
      className="right-panel-tabs-empty-state"
    >
      <div className="right-panel-tabs-empty-state__actions">
        {getWorkbenchLauncherDefinitions(flags).map(definition => {
          const tab = createLauncherTab(definition.kind)
          if (!tab) return null
          return (
            <button
              key={definition.kind}
              className="right-panel-tabs-empty-state__item"
              type="button"
              onClick={() => onOpenTab(tab)}
            >
              <span className="right-panel-tabs-empty-state__icon">
                {definition.icon}
              </span>
              <strong>{definition.label}</strong>
              {definition.shortcut ? <kbd>{definition.shortcut}</kbd> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type TabErrorBoundaryProps = {
  tabId: WorkbenchTabId
  children: React.ReactNode
}

type TabErrorBoundaryState = {
  error: Error | null
  retryKey: number
}

class TabErrorBoundary extends Component<
  TabErrorBoundaryProps,
  TabErrorBoundaryState
> {
  state: TabErrorBoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<TabErrorBoundaryState> {
    return { error }
  }

  componentDidUpdate(previous: TabErrorBoundaryProps): void {
    if (previous.tabId !== this.props.tabId && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return (
        <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
      )
    }
    return (
      <div className="right-dock-error-card" role="alert">
        <strong>此标签无法显示</strong>
        <span>{this.state.error.message}</span>
        <button
          type="button"
          onClick={() =>
            this.setState(state => ({
              error: null,
              retryKey: state.retryKey + 1,
            }))
          }
        >
          <RotateCcw size={APP_ICON_SIZE} />
          重试
        </button>
      </div>
    )
  }
}

function readTabDragPayload(
  event: React.DragEvent,
): {
  source: WorkbenchPanelTarget
  tabId: WorkbenchTabId
} | null {
  const raw = event.dataTransfer.getData(
    'application/x-codepilotx-workbench-tab',
  )
  try {
    const value = JSON.parse(raw) as {
      source?: unknown
      tabId?: unknown
    }
    if (
      (value.source === 'right' || value.source === 'bottom') &&
      typeof value.tabId === 'string'
    ) {
      return {
        source: value.source,
        tabId: value.tabId as WorkbenchTabId,
      }
    }
  } catch {
    /* Ignore unrelated drag payloads. */
  }
  return null
}

function domId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

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
    <div
      className="workspace-shell-controls"
    >
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
