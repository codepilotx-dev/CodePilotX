import type React from 'react'
import {
  Component,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
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
  type ResizePhase,
  SIDEBAR_COLLAPSE_HOLD_MS,
  SIDEBAR_COLLAPSE_TARGET_SIZE,
  useSidebarResizeCollapseConfirm,
} from '../useSidebarResizeCollapseConfirm.js'

type Props = {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  browserState: DesktopBrowserState | null
  defaultBranch: string | null
  files: DesktopFileEntry[]
  gitStatus: DesktopGitStatus | null
  isRefreshingReview: boolean
  diffMarkerStyle: DesktopDiffMarkerStyle
  maxWidth: number
  minWidth: number
  maxHeight?: number
  minHeight?: number
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

function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  return useCallback((...args: TArgs) => handlerRef.current(...args), [])
}

function WorkbenchPanelResizeController({
  target,
  panelRef,
  contentRef,
  rightFullWidth,
  maxWidth,
  minWidth,
  maxHeight,
  minHeight,
  width,
  height,
  onClose,
  onResetWidth,
  onResetHeight,
  onSetWidth,
  onSetHeight,
}: Pick<
  Props,
  | 'target'
  | 'rightFullWidth'
  | 'maxWidth'
  | 'minWidth'
  | 'maxHeight'
  | 'minHeight'
  | 'width'
  | 'height'
  | 'onClose'
  | 'onResetWidth'
  | 'onResetHeight'
  | 'onSetWidth'
  | 'onSetHeight'
> & {
  panelRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}): React.ReactNode {
  const guideRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const resizeBoundsRef = useRef<DOMRect | null>(null)
  const resizeSkeletonTargetRef = useRef<HTMLElement | null>(null)
  const isBottom = target === 'bottom'
  const size = isBottom ? (height ?? minHeight ?? 160) : width
  const minSize = isBottom ? (minHeight ?? 160) : minWidth
  const maxSize = isBottom
    ? (maxHeight ?? minHeight ?? 160)
    : maxWidth

  const clearResizeSkeletonTarget = useCallback((): void => {
    resizeSkeletonTargetRef.current?.removeAttribute(
      'data-resize-skeleton-active',
    )
    resizeSkeletonTargetRef.current = null
  }, [])

  useEffect(() => clearResizeSkeletonTarget, [clearResizeSkeletonTarget])

  const updateResizePhase = useCallback(
    (phase: ResizePhase): void => {
      const handle = handleRef.current
      if (phase === 'idle') {
        clearResizeSkeletonTarget()
        if (handle) delete handle.dataset.resizePhase
        return
      }

      if (phase === 'dragging') {
        clearResizeSkeletonTarget()
        const activeTarget = contentRef.current?.querySelector<HTMLElement>(
          ':scope > .workbench-tab-panel:not([hidden]) ' +
            '[data-resize-skeleton-target="dock-review-diff"]',
        )
        if (activeTarget) {
          activeTarget.setAttribute('data-resize-skeleton-active', '')
          resizeSkeletonTargetRef.current = activeTarget
        }
      }
      if (handle) handle.dataset.resizePhase = phase
    },
    [clearResizeSkeletonTarget, contentRef],
  )

  const previewSize = useCallback(
    (nextSize: number | null): void => {
      const guide = guideRef.current
      if (!guide) return
      if (nextSize === null) {
        guide.hidden = true
        guide.style.transform = ''
        resizeBoundsRef.current = null
        return
      }

      const bounds =
        resizeBoundsRef.current ??
        panelRef.current?.getBoundingClientRect() ??
        null
      if (!bounds) return
      resizeBoundsRef.current = bounds
      guide.hidden = false
      const handleBounds = handleRef.current?.getBoundingClientRect()

      if (isBottom) {
        guide.style.left = `${bounds.left}px`
        guide.style.top = `${
          handleBounds
            ? handleBounds.top + handleBounds.height / 2
            : bounds.top
        }px`
        guide.style.width = `${bounds.width}px`
        guide.style.height = ''
        guide.style.transform = `translate3d(0, ${size - nextSize}px, 0)`
        return
      }

      guide.style.left = `${
        handleBounds
          ? handleBounds.left + handleBounds.width / 2
          : bounds.left
      }px`
      guide.style.top = `${bounds.top}px`
      guide.style.width = ''
      guide.style.height = `${bounds.height}px`
      guide.style.transform = `translate3d(${size - nextSize}px, 0, 0)`
    },
    [isBottom, panelRef, size],
  )

  const {
    collapseConfirmKey,
    collapseConfirmTarget,
    handleResizeKey,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: false,
    collapseEnabled: !isBottom,
    direction: isBottom ? 'bottom' : 'right',
    maxWidth: maxSize,
    minWidth: minSize,
    onCollapse: onClose,
    onResetSize: isBottom ? onResetHeight : onResetWidth,
    onResizePhaseChange: updateResizePhase,
    onResizePreview: previewSize,
    onSetWidth: isBottom ? (onSetHeight ?? onSetWidth) : onSetWidth,
    width: size,
  })

  if (!isBottom && rightFullWidth) return null

  const guide = (
    <div
      ref={guideRef}
      aria-hidden="true"
      className={`workbench-resize-guide workbench-resize-guide--${isBottom ? 'bottom' : 'right'}`}
      hidden
    />
  )

  return (
    <>
      <div
        ref={handleRef}
        aria-label={isBottom ? '调整底部面板高度' : '调整右侧面板宽度'}
        aria-orientation={isBottom ? 'horizontal' : 'vertical'}
        aria-valuemax={maxSize}
        aria-valuemin={minSize}
        aria-valuenow={size}
        className={
          isBottom
            ? 'bottom-panel-resize-handle'
            : 'right-dock-resize-handle'
        }
        role="separator"
        tabIndex={0}
        title={
          isBottom
            ? '拖拽调整高度，双击恢复默认高度'
            : '拖拽调整宽度，双击恢复默认宽度'
        }
        onDoubleClick={isBottom ? onResetHeight : onResetWidth}
        onKeyDown={handleResizeKey}
        onPointerDown={startResize}
      />
      {typeof document === 'undefined' ? null : createPortal(guide, document.body)}
      {collapseConfirmTarget && typeof document !== 'undefined'
        ? createPortal(
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
            />,
            document.body,
          )
        : null}
    </>
  )
}

export function WorkbenchPanel({
  target,
  state,
  tabsById,
  browserState,
  defaultBranch,
  files,
  gitStatus,
  isRefreshingReview,
  diffMarkerStyle,
  maxWidth,
  minWidth,
  maxHeight,
  minHeight,
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
  const panelRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stableOnAppendBrowserAnnotation = useStableEvent(
    onAppendBrowserAnnotation,
  )
  const stableOnBrowserStateChange = useStableEvent(onBrowserStateChange)
  const stableOnClose = useStableEvent(onClose)
  const stableOnCreateBranch = useStableEvent(onCreateBranch)
  const stableOnFileLoadError = useStableEvent(onFileLoadError)
  const stableOnOpenWorkspacePath = useStableEvent(onOpenWorkspacePath)
  const stableOnOpenFileFromBrowser = useStableEvent(onOpenFileFromBrowser)
  const stableOnPreviewFile = useStableEvent(onPreviewFile)
  const stableOnAppendComposerText = useStableEvent(onAppendComposerText)
  const stableOnAddComposerFiles = useStableEvent(onAddComposerFiles)
  const stableOnRefreshReview = useStableEvent(onRefreshReview)
  const stableOnReviewTabStateChange = useStableEvent(
    onReviewTabStateChange,
  )
  const stableOnOpenTab = useStableEvent(onOpenTab)
  const stableOnPinTab = useStableEvent(onPinTab)
  const stableOnSetFileMarkdownViewMode = useStableEvent(
    onSetFileMarkdownViewMode,
  )
  const stableOnToggleReviewView = useStableEvent(onToggleReviewView)

  const panelContext = useMemo<WorkbenchTabRenderContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch,
        gitStatus,
        isRefreshing: isRefreshingReview,
        projectId: workspace?.projectId ?? null,
        diffMarkerStyle,
        reviewView,
        reviewTabState,
        sessionStatus,
        workspacePath: workspace?.path ?? null,
        onAppendComposerText: stableOnAppendComposerText,
        onClose: stableOnClose,
        onCreateBranch: stableOnCreateBranch,
        onOpenWorkspacePath: stableOnOpenWorkspacePath,
        onRefreshDiff: stableOnRefreshReview,
        onReviewTabStateChange: stableOnReviewTabStateChange,
        onToggleReviewView: stableOnToggleReviewView,
      },
      browser: {
        state: browserState,
        onAppendAnnotation: stableOnAppendBrowserAnnotation,
        onAppendComposerText: stableOnAppendComposerText,
        onStateChange: stableOnBrowserStateChange,
      },
      files: {
        files,
        selectedFile,
        workspace,
        onOpenFileFromBrowser: stableOnOpenFileFromBrowser,
        onPreviewFile: stableOnPreviewFile,
        onAppendComposerText: stableOnAppendComposerText,
        onAddComposerFiles: stableOnAddComposerFiles,
        onPinFileTab: stableOnPinTab,
        onSetFileMarkdownViewMode: stableOnSetFileMarkdownViewMode,
        onLoadError: (tab, error, phase) =>
          stableOnFileLoadError({ error, phase, tab, target }),
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
    }),
    [
      browserState,
      defaultBranch,
      diffMarkerStyle,
      files,
      gitStatus,
      isRefreshingReview,
      planContentByEventId,
      reviewView,
      selectedFile,
      sessionId,
      sessionStatus,
      sideChatComposer,
      sideChatFocusVersion,
      activeSideTaskId,
      sideTaskContent,
      stableOnAddComposerFiles,
      stableOnAppendBrowserAnnotation,
      stableOnAppendComposerText,
      stableOnBrowserStateChange,
      stableOnClose,
      stableOnCreateBranch,
      stableOnFileLoadError,
      stableOnOpenFileFromBrowser,
      stableOnOpenWorkspacePath,
      stableOnPinTab,
      stableOnPreviewFile,
      stableOnRefreshReview,
      stableOnReviewTabStateChange,
      stableOnSetFileMarkdownViewMode,
      stableOnToggleReviewView,
      target,
      workspace,
    ],
  )

  return (
    <aside
      ref={panelRef}
      aria-label={target === 'right' ? '右侧面板' : '底部面板'}
      className={`${target === 'right' ? 'right-dock' : 'bottom-panel'} workbench-panel`}
      data-workbench-panel-target={target}
    >
      <WorkbenchPanelResizeController
        target={target}
        panelRef={panelRef}
        contentRef={contentRef}
        rightFullWidth={rightFullWidth}
        maxWidth={maxWidth}
        minWidth={minWidth}
        maxHeight={maxHeight}
        minHeight={minHeight}
        width={width}
        height={height}
        onClose={stableOnClose}
        onResetWidth={onResetWidth}
        onResetHeight={onResetHeight}
        onSetWidth={onSetWidth}
        onSetHeight={onSetHeight}
      />
        <div className={`${target === 'right' ? 'right-dock-header' : 'bottom-panel-header'} workbench-panel-header`}>
          <WorkbenchTabsHeader
            state={state}
            tabsById={tabsById}
            target={target}
            onCloseOtherTabs={onCloseOtherTabs}
            onCloseTab={onCloseTab}
            onCloseTabsToRight={onCloseTabsToRight}
            onMoveTab={onMoveTab}
            onOpenTab={stableOnOpenTab}
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
      <MemoizedWorkbenchPanelContent
        contentRef={contentRef}
        panelContext={panelContext}
        state={state}
        tabsById={tabsById}
        target={target}
        onOpenTab={stableOnOpenTab}
      />
    </aside>
  )
}

const MemoizedWorkbenchPanelContent = memo(function WorkbenchPanelContent({
  contentRef,
  panelContext,
  state,
  tabsById,
  target,
  onOpenTab,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>
  panelContext: WorkbenchTabRenderContext
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  target: WorkbenchPanelTarget
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
}): React.ReactNode {
  return (
    <div
      ref={contentRef}
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
        <WorkbenchLauncher onOpenTab={onOpenTab} />
      )}
    </div>
  )
})

function WorkbenchTabsHeader({
  target,
  state,
  tabsById,
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
  const launchers = useMemo(() => getWorkbenchLauncherDefinitions(), [])

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
                  layout="grid"
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
        className="popover-right-dock-add popover-menu--grid"
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
  onOpenTab,
}: {
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
}): React.ReactNode {
  return (
    <div
      aria-label="可用面板标签"
      className="right-panel-tabs-empty-state"
    >
      <div className="right-panel-tabs-empty-state__actions">
        {getWorkbenchLauncherDefinitions().map(definition => {
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
