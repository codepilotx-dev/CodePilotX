import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { FileText, Folder, FolderOpen, ListChecks, Search, SquareTerminal } from 'lucide-react'
import type {
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { ComposerSurface } from '../session/ComposerSurface.js'
import { MarkdownMessage } from '../session/MarkdownMessage.js'
import type { RightDockPlan } from './rightDockTools.js'

const FILE_TREE_PANEL_DEFAULT_WIDTH = 360
const FILE_TREE_PANEL_MIN_WIDTH = 220
const FILE_TREE_PANEL_MAX_WIDTH = 560
const FILE_TREE_PANEL_KEYBOARD_STEP = 24

type FilesPanelProps = {
  files: DesktopFileEntry[]
  selectedFile: DesktopFilePreview | null
  workspace: DesktopWorkspace | null
  onPreviewFile: (file: DesktopFileEntry) => void
  onAppendComposerText?: (text: string) => void
  onAddComposerFiles?: (filePaths: string[]) => void
}

type PlanPanelProps = {
  plan: RightDockPlan | null
}

export function RightDockPlanPanel({
  plan,
}: PlanPanelProps): React.ReactNode {
  if (!plan) {
    return (
      <ScrollArea
        aria-label="计划"
        className="right-dock-plan-scroll-area"
        contentClassName="right-dock-plan-scroll-content"
      >
        <div className="right-dock-empty-state">
          <ListChecks size={58} strokeWidth={1.8} />
          <strong>暂无计划</strong>
          <span>从主对话里的计划卡片打开计划书</span>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea
      aria-label="计划"
      className="right-dock-plan-scroll-area"
      contentClassName="right-dock-plan-scroll-content"
    >
      <article className="right-dock-plan-document">
        <MarkdownMessage text={plan.content} />
      </article>
    </ScrollArea>
  )
}

export function RightDockFilesPanel({
  files,
  selectedFile,
  workspace,
  onPreviewFile,
  onAppendComposerText,
  onAddComposerFiles,
}: FilesPanelProps): React.ReactNode {
  const [query, setQuery] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const [selectedText, setSelectedText] = useState('')
  const [fileTreePanelWidth, setFileTreePanelWidth] = useState(
    FILE_TREE_PANEL_DEFAULT_WIDTH,
  )
  const [fileTreePanelResizing, setFileTreePanelResizing] = useState(false)
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

  function handlePreviewContextMenu(): void {
    setSelectedText(window.getSelection()?.toString() ?? '')
  }

  function sendSelectedTextToComposer(): void {
    if (!selectedFile || !shouldShowSelectionSendAction(selectedText)) return
    onAppendComposerText?.(
      buildFileSelectionPrompt({
        path: selectedFile.path,
        selectedText,
      }),
    )
    setSelectedText('')
  }

  function setClampedFileTreePanelWidth(width: number): void {
    setFileTreePanelWidth(
      Math.min(
        FILE_TREE_PANEL_MAX_WIDTH,
        Math.max(FILE_TREE_PANEL_MIN_WIDTH, Math.round(width)),
      ),
    )
  }

  function startFileTreePanelResize(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = fileTreePanelWidth
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture(pointerId)
    setFileTreePanelResizing(true)

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      setClampedFileTreePanelWidth(startWidth - (moveEvent.clientX - startX))
    }

    const stopResize = (): void => {
      setFileTreePanelResizing(false)
      target.releasePointerCapture(pointerId)
      target.removeEventListener('pointermove', handlePointerMove)
      target.removeEventListener('pointerup', stopResize)
      target.removeEventListener('pointercancel', stopResize)
    }

    target.addEventListener('pointermove', handlePointerMove)
    target.addEventListener('pointerup', stopResize)
    target.addEventListener('pointercancel', stopResize)
  }

  function handleFileTreePanelResizeKey(
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setClampedFileTreePanelWidth(
        fileTreePanelWidth + FILE_TREE_PANEL_KEYBOARD_STEP,
      )
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setClampedFileTreePanelWidth(
        fileTreePanelWidth - FILE_TREE_PANEL_KEYBOARD_STEP,
      )
    } else if (event.key === 'Home') {
      event.preventDefault()
      setClampedFileTreePanelWidth(FILE_TREE_PANEL_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setClampedFileTreePanelWidth(FILE_TREE_PANEL_MAX_WIDTH)
    }
  }

  return (
    <section
      className={
        fileTreePanelResizing
          ? 'right-dock-files resizing-file-tree'
          : 'right-dock-files'
      }
      aria-label="打开文件"
      style={
        {
          '--right-dock-file-tree-w': `${fileTreePanelWidth}px`,
        } as React.CSSProperties
      }
    >
      <div className="right-dock-file-preview">
        {selectedFile ? (
          <article className="right-dock-file-document">
            <header>
              <FileText size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span title={selectedFile.path}>{selectedFile.path}</span>
            </header>
            <ContextMenu.Root>
              <ContextMenu.Trigger asChild>
                <div
                  className="right-dock-file-selection-target"
                  onContextMenu={handlePreviewContextMenu}
                >
                  <ScrollArea
                    className="right-dock-file-preview-scroll-area"
                    contentClassName="right-dock-file-preview-scroll-content"
                    direction="y"
                  >
                    <div className="right-dock-file-preview-x-scroll">
                      <pre>{selectedFile.content}</pre>
                    </div>
                  </ScrollArea>
                </div>
              </ContextMenu.Trigger>
              {shouldShowSelectionSendAction(selectedText) ? (
                <ContextMenu.Portal>
                  <ContextMenu.Content className="sidebar-context-menu-content">
                    <ContextMenu.Item
                      className="sidebar-context-menu-item"
                      onSelect={sendSelectedTextToComposer}
                    >
                      发送到对话框
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              ) : null}
            </ContextMenu.Root>
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
      <div
        aria-label="调整文件目录树宽度"
        aria-orientation="vertical"
        aria-valuemax={FILE_TREE_PANEL_MAX_WIDTH}
        aria-valuemin={FILE_TREE_PANEL_MIN_WIDTH}
        aria-valuenow={fileTreePanelWidth}
        className="right-dock-file-tree-resize-handle"
        role="separator"
        tabIndex={0}
        title="拖拽调整目录树宽度，双击恢复默认宽度"
        onDoubleClick={() =>
          setClampedFileTreePanelWidth(FILE_TREE_PANEL_DEFAULT_WIDTH)
        }
        onKeyDown={handleFileTreePanelResizeKey}
        onPointerDown={startFileTreePanelResize}
      />
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
        <ScrollArea
          className="right-dock-tree-scroll-area"
          contentClassName="right-dock-tree-scroll-content"
          role="tree"
        >
          {visibleFiles.length > 0 ? (
            visibleFiles.map(file => {
              const sendablePath = getSendableFilePath({
                workspacePath: workspace?.path ?? null,
                file,
              })
              const row = (
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
              )
              if (!sendablePath) return row
              return (
                <ContextMenu.Root key={file.path}>
                  <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="sidebar-context-menu-content">
                      <ContextMenu.Item
                        className="sidebar-context-menu-item"
                        onSelect={() => onAddComposerFiles?.([sendablePath])}
                      >
                        发送到对话框
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )
            })
          ) : (
            <div className="right-dock-tree-empty">
              {workspace ? '没有匹配的文件。' : '未打开工作区。'}
            </div>
          )}
        </ScrollArea>
      </div>
    </section>
  )
}

export function RightDockSideChatPanel({
  composer,
  focusVersion,
}: {
  composer: React.ReactNode
  focusVersion: number
}): React.ReactNode {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (focusVersion > 0) {
      const textarea = surfaceRef.current?.querySelector('textarea')
      textarea?.focus()
    }
  }, [focusVersion])

  return (
    <section className="right-dock-side-chat" aria-label="侧边聊天">
      <ComposerSurface ref={surfaceRef}>
        {composer}
      </ComposerSurface>
    </section>
  )
}

export function RightDockTerminalPanel(): React.ReactNode {
  return (
    <section className="right-dock-terminal" aria-label="终端">
      <div className="right-dock-terminal-empty">
        <SquareTerminal size={48} strokeWidth={1.6} />
        <strong>终端</strong>
        <span>终端复制发送到对话框将在后续版本接入</span>
      </div>
      <div className="right-dock-terminal-composer">
        <input
          aria-label="终端输入"
          disabled
          placeholder="$ 终端占位，暂不接入"
        />
      </div>
    </section>
  )
}

export function buildFileSelectionPrompt({
  path,
  selectedText,
}: {
  path: string
  selectedText: string
}): string {
  const extension = path.split(/[\\/]/).pop()?.split('.').pop()
  const fence = extension && extension !== path ? extension : ''
  return [
    '文件选区：',
    `- 文件：${path}`,
    '',
    `\`\`\`${fence}`,
    selectedText.trim(),
    '```',
  ].join('\n')
}

export function shouldShowSelectionSendAction(selectedText: string): boolean {
  return selectedText.trim().length > 0
}

/**
 * Appends `text` to the end of `prev`, trimming `text` first.
 * Adds a `\n\n` separator if `prev` already contains non-whitespace content.
 * Returns `prev` unchanged if trimmed `text` is empty.
 */
export function buildAppendText(prev: string, text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return prev
  const existing = prev.trim()
  if (!existing) return trimmed
  return `${prev}\n\n${trimmed}`
}

export function getSendableFilePath({
  workspacePath,
  file,
}: {
  workspacePath: string | null
  file: DesktopFileEntry
}): string | null {
  if (!workspacePath || file.type !== 'file') return null
  return `${workspacePath.replace(/[\\/]$/, '')}/${file.path.replace(/^[\\/]/, '')}`
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
