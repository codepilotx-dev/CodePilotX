import type React from 'react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText,
  Folder,
  FolderOpen,
  GitPullRequest,
  Globe2,
  MessageSquarePlus,
  Minus,
  PanelRight,
  Plus,
  Search,
  SquareTerminal,
} from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../shared/types.js'
import { desktopClient } from '../services/desktopClient.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './ui/iconTokens.js'
import { IconButton } from './ui/IconButton.js'
import { PopoverItem } from './ui/PopoverItem.js'
import { PopoverMenu } from './ui/PopoverMenu.js'
import { DesktopBrowserPanel } from './DesktopBrowserPanel.js'
import { WorkspaceReviewSidebar } from './review/WorkspaceReviewSidebar.js'
import type { RightDockState, RightDockTool } from './rightDockState.js'

type Props = {
  state: RightDockState
  browserState: DesktopBrowserState | null
  files: DesktopFileEntry[]
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
  onOpenTool: (tool: RightDockTool) => void
  onOpenWorkspacePath: () => void
  onPreviewFile: (file: DesktopFileEntry) => void
  onRefreshReview: () => void
  onResetWidth: () => void
  onSetWidth: (width: number) => void
}

const TAB_ITEMS: Array<{
  icon: React.ReactNode
  label: string
  tool: RightDockTool
}> = [
  { tool: 'review', label: '审查', icon: <GitPullRequest /> },
  { tool: 'browser', label: '浏览器', icon: <Globe2 /> },
  { tool: 'files', label: '打开文件', icon: <FileText /> },
  { tool: 'sideChat', label: '侧边聊天', icon: <MessageSquarePlus /> },
]

export function RightDock({
  state,
  browserState,
  files,
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
  onOpenTool,
  onOpenWorkspacePath,
  onPreviewFile,
  onRefreshReview,
  onResetWidth,
  onSetWidth,
}: Props): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const resizeStartRef = useRef<{
    startWidth: number
    startX: number
  } | null>(null)
  const [resizing, setResizing] = useState(false)

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
          {TAB_ITEMS.map((item, index) => (
            <Fragment key={item.tool}>
              {index > 0 ? <span className="right-dock-tab-divider" /> : null}
              <button
                aria-selected={state.activeTool === item.tool}
                className={
                  state.activeTool === item.tool
                    ? 'right-dock-tab active'
                    : 'right-dock-tab'
                }
                role="tab"
                type="button"
                onClick={() => onOpenTool(item.tool)}
              >
                <span className="right-dock-tab-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
          <PopoverMenu
            align="start"
            className="popover-right-dock-add"
            open={menuOpen}
            sideOffset={6}
            trigger={
              <button className="right-dock-add-button" type="button">
                <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </button>
            }
            onOpenChange={setMenuOpen}
          >
            <PopoverItem
              icon={<SquareTerminal size={APP_ICON_SIZE} />}
              disabled
              shortcut="Ctrl+`"
            >
              终端
            </PopoverItem>
            <PopoverItem
              icon={<Globe2 size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Shift+B"
              onClick={() => {
                onOpenTool('browser')
                setMenuOpen(false)
              }}
            >
              浏览器
            </PopoverItem>
            <PopoverItem
              icon={<FileText size={APP_ICON_SIZE} />}
              shortcut="Ctrl+P"
              onClick={() => {
                onOpenTool('files')
                setMenuOpen(false)
              }}
            >
              文件
            </PopoverItem>
            <PopoverItem
              icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+S"
              onClick={() => {
                onOpenTool('sideChat')
                setMenuOpen(false)
              }}
            >
              侧边聊天
            </PopoverItem>
          </PopoverMenu>
        </div>
        <div className="right-dock-controls">
          <IconButton className="right-dock-control" title="最小化面板" onClick={onClose}>
            <Minus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <IconButton className="right-dock-control active" title="关闭右侧面板" onClick={onClose}>
            <PanelRight size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
        </div>
      </header>

      <div className="right-dock-content">
        {state.activeTool === 'review' ? (
          <WorkspaceReviewSidebar
            activeSessionId={sessionId}
            isRefreshing={isRefreshingReview}
            reviewView={reviewView}
            sessionStatus={sessionStatus}
            workspacePath={workspace?.path ?? null}
            onClose={onClose}
            onOpenWorkspacePath={onOpenWorkspacePath}
            onRefreshDiff={onRefreshReview}
          />
        ) : null}
        {state.activeTool === 'browser' && browserState ? (
          <DesktopBrowserPanel
            state={browserState}
            onAppendAnnotation={onAppendBrowserAnnotation}
            onStateChange={onBrowserStateChange}
          />
        ) : null}
        {state.activeTool === 'files' ? (
          <RightDockFilesPanel
            files={files}
            selectedFile={selectedFile}
            workspace={workspace}
            onPreviewFile={onPreviewFile}
          />
        ) : null}
        {state.activeTool === 'sideChat' ? <RightDockSideChatPanel /> : null}
      </div>
    </aside>
  )
}

function RightDockFilesPanel({
  files,
  selectedFile,
  workspace,
  onPreviewFile,
}: {
  files: DesktopFileEntry[]
  selectedFile: DesktopFilePreview | null
  workspace: DesktopWorkspace | null
  onPreviewFile: (file: DesktopFileEntry) => void
}): React.ReactNode {
  const [query, setQuery] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const visibleFiles = useMemo(
    () => filterVisibleFiles(files, query, collapsedDirs),
    [collapsedDirs, files, query],
  )

  function toggleDirectory(path: string): void {
    setCollapsedDirs(current => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <section className="right-dock-files" aria-label="打开文件">
      <div className="right-dock-file-preview">
        {selectedFile ? (
          <article className="right-dock-file-document">
            <header>
              <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span title={selectedFile.path}>{selectedFile.path}</span>
            </header>
            <pre>{selectedFile.content}</pre>
            {selectedFile.truncated ? (
              <p>文件较大，已截断预览。</p>
            ) : null}
          </article>
        ) : (
          <div className="right-dock-empty-state">
            <Folder size={58} strokeWidth={1.8} />
            <strong>打开文件</strong>
            <span>
              {workspace
                ? '从工作区目录树中选择文件'
                : '先打开一个工作区以浏览文件'}
            </span>
          </div>
        )}
      </div>
      <div className="right-dock-file-tree">
        <label className="right-dock-search">
          <Search size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <input
            aria-label="筛选文件"
            placeholder="筛选文件..."
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <div className="right-dock-tree-list" role="tree">
          {visibleFiles.length > 0 ? (
            visibleFiles.map(file => (
              <button
                className={
                  selectedFile?.path === file.path
                    ? 'right-dock-tree-row active'
                    : 'right-dock-tree-row'
                }
                key={file.path}
                style={{ paddingLeft: `${12 + file.depth * 18}px` }}
                title={file.path}
                type="button"
                onClick={() => {
                  if (file.type === 'directory') {
                    toggleDirectory(file.path)
                    return
                  }
                  onPreviewFile(file)
                }}
              >
                {file.type === 'directory' ? (
                  collapsedDirs.has(file.path) ? (
                    <Folder size={APP_ICON_SIZE} />
                  ) : (
                    <FolderOpen size={APP_ICON_SIZE} />
                  )
                ) : (
                  <FileText size={APP_ICON_SIZE} />
                )}
                <span>{file.name}</span>
              </button>
            ))
          ) : (
            <div className="right-dock-tree-empty">
              {workspace ? '没有匹配的文件。' : '未打开工作区。'}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function RightDockSideChatPanel(): React.ReactNode {
  return (
    <section className="right-dock-side-chat" aria-label="侧边聊天">
      <div className="right-dock-side-chat-empty" />
      <div className="right-dock-side-chat-composer">
        <textarea
          aria-label="侧边聊天输入"
          disabled
          placeholder="侧边聊天将在后续版本接入"
          rows={3}
        />
        <div className="right-dock-side-chat-actions">
          <button disabled type="button">+</button>
          <button disabled type="button">发送</button>
        </div>
      </div>
    </section>
  )
}

function filterVisibleFiles(
  files: DesktopFileEntry[],
  query: string,
  collapsedDirs: Set<string>,
): DesktopFileEntry[] {
  const trimmedQuery = query.trim().toLowerCase()
  const hiddenPrefixes: string[] = []
  return files.filter(file => {
    while (
      hiddenPrefixes.length > 0 &&
      !isDescendantOf(file.path, hiddenPrefixes[hiddenPrefixes.length - 1] ?? '')
    ) {
      hiddenPrefixes.pop()
    }
    if (hiddenPrefixes.some(prefix => isDescendantOf(file.path, prefix))) {
      return false
    }
    if (file.type === 'directory' && collapsedDirs.has(file.path)) {
      hiddenPrefixes.push(file.path)
    }
    if (!trimmedQuery) return true
    return file.path.toLowerCase().includes(trimmedQuery)
  })
}

function isDescendantOf(path: string, directoryPath: string): boolean {
  return path.startsWith(`${directoryPath}/`) || path.startsWith(`${directoryPath}\\`)
}
