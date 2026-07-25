import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Folder, FolderOpen, ListChecks } from 'lucide-react'
import type {
  DesktopFileEntry,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { ComposerFrame } from '../../session/composer/ComposerSurface.js'
import { MarkdownMessage } from '../../session/MarkdownMessage.js'
import { resolveLanguageFromPath } from '../../syntax/index.js'
import { cx } from '../../../utils/cx.js'
import { ConflictMergeEditor, FileEditor } from '../../editor/index.js'
import {
  prefetchFileDocument,
  resolveFileDocumentConflict,
  saveFileDocument,
  startFileDocumentExternalChecks,
  updateFileDocument,
  useFileDocument,
} from '../../workspace/fileDocumentStore.js'
import { FileBreadcrumbToolbar } from '../panels/FileBreadcrumbToolbar.js'
import type { MarkdownFileViewMode } from './rightDockState.js'
import {
  getSendableFilePath,
  WorkspaceFileTree,
  type WorkspaceFileOpenOptions,
} from '../WorkspaceFileTree.js'
import { createWorkspaceFileTabId } from '../tabs/workspaceFileTabId.js'

const FILE_TREE_DEFAULT_WIDTH = 280
const FILE_TREE_MIN_WIDTH = 200
const FILE_TREE_LAYOUT_MIN_WIDTH = 528
const OPEN_FILE_MAIN_MIN_WIDTH = 200
const OPEN_FILE_TREE_LAYOUT_MIN_WIDTH =
  OPEN_FILE_MAIN_MIN_WIDTH + FILE_TREE_MIN_WIDTH + 8

export type FileDocumentLoadErrorPhase = 'initial' | 'external-sync'

type FilesPanelProps = {
  files: DesktopFileEntry[]
  activePath?: string | null
  workspace: DesktopWorkspace | null
  revealToken?: number
  onOpenFile: (
    file: DesktopFileEntry,
    options: WorkspaceFileOpenOptions,
  ) => void
  onAddComposerFiles?: (filePaths: string[]) => void
}

type PlanPanelProps = {
  content: string | null
}

export function RightDockPlanPanel({
  content,
}: PlanPanelProps): React.ReactNode {
  if (!content) {
    return (
      <ScrollArea
        aria-label="计划"
        className="right-dock-plan-scroll-area tw:min-h-0 tw:flex-1 tw:bg-app-canvas"
        contentClassName="right-dock-plan-scroll-content tw:min-w-0 tw:p-4"
      >
        <div className="right-dock-empty-state tw:grid tw:h-full tw:w-full tw:place-content-center tw:justify-items-center tw:gap-2 tw:p-6 tw:text-center tw:text-app-text-soft">
          <ListChecks size={58} strokeWidth={1.8} />
          <strong className="tw:text-base tw:font-[var(--font-weight-label)] tw:text-app-text">暂无计划</strong>
          <span className="tw:max-w-full tw:text-sm tw:text-app-text-soft">从主对话里的计划卡片打开计划书</span>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea
      aria-label="计划"
      className="right-dock-plan-scroll-area tw:min-h-0 tw:flex-1 tw:bg-app-canvas"
      contentClassName="right-dock-plan-scroll-content tw:min-w-0 tw:p-4"
    >
      <article className="right-dock-plan-document tw:mx-auto tw:w-full tw:max-w-[48rem] tw:text-app-text">
        <MarkdownMessage text={content} />
      </article>
    </ScrollArea>
  )
}

export function RightDockFilesPanel({
  files,
  activePath,
  workspace,
  revealToken,
  onOpenFile,
  onAddComposerFiles,
}: FilesPanelProps): React.ReactNode {
  const workspacePath = workspace?.path ?? ''
  const initialTreeState = useRef(
    readFileTreeViewState(workspacePath, true),
  )
  const [treeVisible, setTreeVisible] = useState(
    initialTreeState.current.visible,
  )
  const [treeAvailable, setTreeAvailable] = useState(true)
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const next = readFileTreeViewState(workspacePath, true)
    setTreeVisible(next.visible)
    setTreeWidth(next.width)
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) return
    writeFileTreeViewState(workspacePath, {
      visible: treeVisible,
      width: treeWidth,
    })
  }, [treeVisible, treeWidth, workspacePath])

  useEffect(() => {
    if (!layoutRef.current) return
    const layout = layoutRef.current
    const clampToLayout = (): void => {
      const layoutWidth = layout.getBoundingClientRect().width
      const available = layoutWidth >= OPEN_FILE_TREE_LAYOUT_MIN_WIDTH
      setTreeAvailable(available)
      if (!available) {
        setTreeVisible(false)
        return
      }
      if (!treeVisible) return
      setTreeWidth(current =>
        Math.min(
          Math.max(
            FILE_TREE_MIN_WIDTH,
            Math.min(
              layoutWidth * 0.6,
              layoutWidth - OPEN_FILE_MAIN_MIN_WIDTH - 8,
            ),
          ),
          Math.max(FILE_TREE_MIN_WIDTH, Math.round(current)),
        ),
      )
    }
    clampToLayout()
    const observer = new ResizeObserver(clampToLayout)
    observer.observe(layout)
    return () => observer.disconnect()
  }, [treeVisible])

  function clampTreeWidth(width: number): number {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? 0
    const maximum =
      layoutWidth > 0
        ? Math.max(
            FILE_TREE_MIN_WIDTH,
            Math.min(
              layoutWidth * 0.6,
              layoutWidth - OPEN_FILE_MAIN_MIN_WIDTH - 8,
            ),
          )
        : 480
    return Math.min(
      maximum,
      Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)),
    )
  }

  function startTreeResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = treeWidth
    const onPointerMove = (moveEvent: PointerEvent): void => {
      setTreeWidth(clampTreeWidth(startWidth + startX - moveEvent.clientX))
    }
    const onPointerUp = (): void => {
      window.document.body.classList.remove('file-tree-is-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.document.body.classList.add('file-tree-is-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  return (
    <section className="right-dock-file-browser" aria-label="打开文件">
      <header className="file-breadcrumb-toolbar file-breadcrumb-toolbar--empty">
        <div
          aria-label="文件路径：工作区根目录"
          className="file-breadcrumb-toolbar__path"
        >
          <strong className="file-breadcrumb-toolbar__root">/</strong>
        </div>
        <div className="file-breadcrumb-toolbar__actions">
          <button
            aria-label={treeVisible ? '隐藏文件树' : '显示文件树'}
            aria-pressed={treeVisible}
            className="file-breadcrumb-toolbar__action"
            disabled={!treeAvailable}
            title={
              treeAvailable
                ? treeVisible
                  ? '隐藏文件树'
                  : '显示文件树'
                : '面板过窄，无法显示文件树'
            }
            type="button"
            onClick={() => setTreeVisible(current => !current)}
          >
            <FolderOpen
              aria-hidden="true"
              size={16}
              strokeWidth={1.8}
            />
          </button>
        </div>
      </header>
      <div
        ref={layoutRef}
        className={cx(
          'right-dock-file-editor-layout',
          'right-dock-open-file-layout',
          treeVisible && 'has-file-tree',
        )}
        style={
          {
            '--right-dock-editor-tree-width': `${treeWidth}px`,
          } as React.CSSProperties
        }
      >
        <div className="right-dock-open-file-empty">
          <Folder aria-hidden="true" size={48} strokeWidth={1.5} />
          <strong>打开文件</strong>
          <span>
            {workspace
              ? '从工作区目录树中选择文件'
              : '先打开一个工作区以浏览文件'}
          </span>
        </div>
        {treeVisible ? (
          <>
            <div
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              aria-valuemax={Math.round(
                Math.max(
                  FILE_TREE_MIN_WIDTH,
                  Math.min(
                    (layoutRef.current?.getBoundingClientRect().width ?? 800) *
                      0.6,
                    (layoutRef.current?.getBoundingClientRect().width ?? 800) -
                      OPEN_FILE_MAIN_MIN_WIDTH -
                      8,
                  ),
                ),
              )}
              aria-valuemin={FILE_TREE_MIN_WIDTH}
              aria-valuenow={treeWidth}
              className="right-dock-editor-tree-resize-handle"
              role="separator"
              tabIndex={0}
              title="拖拽调整文件树宽度，双击恢复默认宽度"
              onDoubleClick={() => setTreeWidth(FILE_TREE_DEFAULT_WIDTH)}
              onKeyDown={event => {
                const step = event.shiftKey ? 40 : 10
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setTreeWidth(current => clampTreeWidth(current + step))
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  setTreeWidth(current => clampTreeWidth(current - step))
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  setTreeWidth(FILE_TREE_DEFAULT_WIDTH)
                }
              }}
              onPointerDown={startTreeResize}
            />
            <aside
              aria-label="工作区文件树"
              className="right-dock-editor-file-tree"
            >
              <WorkspaceFileTree
                key={workspacePath}
                activePath={activePath}
                autoFocusSearch
                files={files}
                revealToken={revealToken}
                workspace={workspace}
                onAddComposerFiles={onAddComposerFiles}
                onEscape={() => setTreeVisible(false)}
                onOpenFile={onOpenFile}
              />
            </aside>
          </>
        ) : null}
      </div>
    </section>
  )
}

export function RightDockFilePreviewPanel({
  workspacePath,
  expectedPath,
  revealLine,
  previewTab,
  markdownViewMode,
  files,
  workspace,
  onPinTab,
  onSetMarkdownViewMode,
  onAppendComposerText,
  onAddComposerFiles,
  onOpenFile,
  onLoadError,
}: {
  workspacePath: string
  expectedPath: string
  revealLine?: number
  previewTab: boolean
  markdownViewMode?: MarkdownFileViewMode
  files: DesktopFileEntry[]
  workspace: DesktopWorkspace | null
  onPinTab: () => void
  onSetMarkdownViewMode: (mode: MarkdownFileViewMode) => void
  onAppendComposerText?: (text: string) => void
  onAddComposerFiles?: (filePaths: string[]) => void
  onOpenFile: (
    file: DesktopFileEntry,
    options: WorkspaceFileOpenOptions,
  ) => void
  onLoadError?: (
    error: Error,
    phase: FileDocumentLoadErrorPhase,
  ) => void
}): React.ReactNode {
  const [selectedText, setSelectedText] = useState('')
  const initialTreeState = useRef(readFileTreeViewState(workspacePath))
  const [treeVisible, setTreeVisible] = useState(
    initialTreeState.current.visible,
  )
  const [treeAvailable, setTreeAvailable] = useState(true)
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const [switchingMarkdownMode, setSwitchingMarkdownMode] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const initialLoadKeyRef = useRef<string | null>(null)
  const onLoadErrorRef = useRef(onLoadError)
  const document = useFileDocument(workspacePath, expectedPath)
  const language = resolveLanguageFromPath(expectedPath)
  const isMarkdown = isMarkdownFilePath(expectedPath)
  const resolvedMarkdownViewMode = isMarkdown
    ? (markdownViewMode ?? 'rich')
    : undefined

  useEffect(() => {
    onLoadErrorRef.current = onLoadError
  }, [onLoadError])

  useEffect(() => {
    const loadKey = `${workspacePath}\u0000${expectedPath}`
    if (initialLoadKeyRef.current === loadKey) return
    initialLoadKeyRef.current = loadKey
    void prefetchFileDocument(workspacePath, expectedPath).catch(error => {
      if (initialLoadKeyRef.current !== loadKey) return
      onLoadErrorRef.current?.(
        error instanceof Error ? error : new Error(String(error)),
        'initial',
      )
    })
  }, [expectedPath, workspacePath])

  useEffect(() => {
    if (document.status !== 'ready') return
    return startFileDocumentExternalChecks(workspacePath, expectedPath, {
      onLoadError: error =>
        onLoadErrorRef.current?.(error, 'external-sync'),
    })
  }, [document.status, expectedPath, workspacePath])

  useEffect(() => {
    writeFileTreeViewState(workspacePath, {
      visible: treeVisible,
      width: treeWidth,
    })
  }, [treeVisible, treeWidth, workspacePath])

  useEffect(() => {
    if (!layoutRef.current) return
    const layout = layoutRef.current
    const clampToLayout = (): void => {
      const layoutWidth = layout.getBoundingClientRect().width
      const available = layoutWidth >= FILE_TREE_LAYOUT_MIN_WIDTH
      setTreeAvailable(available)
      if (!available) {
        setTreeVisible(false)
        return
      }
      if (!treeVisible) return
      const maximum = Math.max(
        FILE_TREE_MIN_WIDTH,
        layoutWidth * 0.6,
      )
      setTreeWidth(current =>
        Math.min(
          maximum,
          Math.max(FILE_TREE_MIN_WIDTH, Math.round(current)),
        ),
      )
    }
    clampToLayout()
    const observer = new ResizeObserver(clampToLayout)
    observer.observe(layout)
    return () => observer.disconnect()
  }, [treeVisible])

  function sendSelectedTextToComposer(): void {
    if (!shouldShowSelectionSendAction(selectedText)) return
    onAppendComposerText?.(
      buildFileSelectionPrompt({
        path: expectedPath,
        selectedText,
      }),
    )
    setSelectedText('')
  }

  function clampTreeWidth(width: number): number {
    const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? 0
    const maximum =
      layoutWidth > 0
        ? Math.max(FILE_TREE_MIN_WIDTH, layoutWidth * 0.6)
        : 480
    return Math.min(
      maximum,
      Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)),
    )
  }

  function startTreeResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = treeWidth
    const onPointerMove = (moveEvent: PointerEvent): void => {
      setTreeWidth(clampTreeWidth(startWidth + startX - moveEvent.clientX))
    }
    const onPointerUp = (): void => {
      window.document.body.classList.remove('file-tree-is-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.document.body.classList.add('file-tree-is-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  async function toggleMarkdownViewMode(): Promise<void> {
    if (!resolvedMarkdownViewMode || switchingMarkdownMode || document.conflict) {
      return
    }
    setSwitchingMarkdownMode(true)
    try {
      if (
        document.dirty &&
        !(await saveFileDocument(workspacePath, expectedPath))
      ) {
        return
      }
      onSetMarkdownViewMode(
        resolvedMarkdownViewMode === 'rich' ? 'source' : 'rich',
      )
    } finally {
      setSwitchingMarkdownMode(false)
    }
  }

  if (document.status === 'error') {
    return (
      <div className="right-dock-file-load-error" role="alert">
        无法打开文件
      </div>
    )
  }

  if (document.status !== 'ready') {
    return (
      <div className="right-dock-empty-state">
        <Folder size={58} strokeWidth={1.8} />
        <strong>正在读取文件</strong>
        <span>{expectedPath}</span>
      </div>
    )
  }

  return (
    <section className="right-dock-file-preview" aria-label={expectedPath}>
      <article
        className={cx(
          'right-dock-file-document',
          'u-flex',
          'u-flex-col',
          'u-min-w-0',
          'u-w-full',
          'u-min-h-0',
        )}
      >
        <FileBreadcrumbToolbar
          path={expectedPath}
          readonly={document.readonly}
          treeAvailable={treeAvailable}
          treeVisible={treeVisible}
          markdownViewMode={
            document.conflict ? undefined : resolvedMarkdownViewMode
          }
          switching={switchingMarkdownMode}
          workspace={workspace}
          workspacePath={workspacePath}
          onToggleTree={() => setTreeVisible(current => !current)}
          onToggleMarkdownViewMode={() => {
            void toggleMarkdownViewMode()
          }}
        />
        <div
          ref={layoutRef}
          className={cx(
            'right-dock-file-editor-layout',
            treeVisible && 'has-file-tree',
          )}
          style={
            {
              '--right-dock-editor-tree-width': `${treeWidth}px`,
            } as React.CSSProperties
          }
        >
          <AppContextMenu
            actions={
              shouldShowSelectionSendAction(selectedText)
                ? [
                    {
                      kind: 'item',
                      label: '发送到对话框',
                      onSelect: sendSelectedTextToComposer,
                    },
                  ]
                : []
            }
            trigger={
              <div
                className="right-dock-file-selection-target"
                onContextMenu={() =>
                  setSelectedText(window.getSelection()?.toString() ?? '')
                }
              >
                {document.conflict ? (
                  <ConflictMergeEditor
                    diskValue={document.conflict.diskContent}
                    error={document.saveError}
                    language={language}
                    localValue={document.draftContent}
                    path={expectedPath}
                    saving={document.saving}
                    onChangeLocal={value =>
                      updateFileDocument(workspacePath, expectedPath, value)
                    }
                    onKeepLocal={() =>
                      resolveFileDocumentConflict(
                        workspacePath,
                        expectedPath,
                        'local',
                      )
                    }
                    onUseDisk={() =>
                      resolveFileDocumentConflict(
                        workspacePath,
                        expectedPath,
                        'disk',
                      )
                    }
                  />
                ) : (
                  <FileEditor
                    ariaLabel={`${expectedPath} 文件编辑器`}
                    className="right-dock-file-code"
                    error={document.saveError}
                    language={language}
                    path={expectedPath}
                    presentation={
                      resolvedMarkdownViewMode === 'rich'
                        ? 'markdown-rich'
                        : 'source'
                    }
                    readonly={document.readonly}
                    revealLine={revealLine}
                    saving={document.saving}
                    value={document.draftContent}
                    onChange={value => {
                      if (previewTab) onPinTab()
                      updateFileDocument(workspacePath, expectedPath, value)
                    }}
                    onSave={async () => {
                      await saveFileDocument(workspacePath, expectedPath)
                    }}
                  />
                )}
              </div>
            }
            width={220}
          />
          {treeVisible ? (
            <>
              <div
                aria-label="调整文件树宽度"
                aria-orientation="vertical"
                aria-valuemax={Math.round(
                  Math.max(
                    FILE_TREE_MIN_WIDTH,
                    (layoutRef.current?.getBoundingClientRect().width ?? 800) *
                      0.6,
                  ),
                )}
                aria-valuemin={FILE_TREE_MIN_WIDTH}
                aria-valuenow={treeWidth}
                className="right-dock-editor-tree-resize-handle"
                role="separator"
                tabIndex={0}
                title="拖拽调整文件树宽度，双击恢复默认宽度"
                onDoubleClick={() => setTreeWidth(FILE_TREE_DEFAULT_WIDTH)}
                onKeyDown={event => {
                  const step = event.shiftKey ? 40 : 10
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    setTreeWidth(current => clampTreeWidth(current + step))
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    setTreeWidth(current => clampTreeWidth(current - step))
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    setTreeWidth(FILE_TREE_DEFAULT_WIDTH)
                  }
                }}
                onPointerDown={startTreeResize}
              />
              <aside
                aria-label="当前文件的工作区文件树"
                className="right-dock-editor-file-tree"
              >
                <WorkspaceFileTree
                  activePath={expectedPath}
                  files={files}
                  workspace={workspace}
                  onAddComposerFiles={onAddComposerFiles}
                  onEscape={() => setTreeVisible(false)}
                  onOpenFile={onOpenFile}
                />
              </aside>
            </>
          ) : null}
        </div>
      </article>
    </section>
  )
}

function isMarkdownFilePath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mdx|mkd)$/i.test(path)
}

export function RightDockSideChatPanel({
  composer,
  focusVersion,
  content,
}: {
  composer: React.ReactNode
  focusVersion: number
  content?: React.ReactNode
}): React.ReactNode {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const textarea = surfaceRef.current?.querySelector('textarea')
    textarea?.focus()
  }, [focusVersion])

  return (
    <section className="right-dock-side-chat tw:relative tw:min-h-0 tw:min-w-0 tw:flex-1 tw:bg-app-canvas" aria-label="侧边聊天">
      {content ?? (
        <ComposerFrame
          ref={surfaceRef}
          className="right-dock-side-chat__composer tw:mx-auto tw:px-4 tw:pb-4"
        >
          {composer}
        </ComposerFrame>
      )}
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

export { getSendableFilePath }
export { createWorkspaceFileTabId }

type FileTreeViewState = {
  visible: boolean
  width: number
}

function fileTreeViewStorageKey(workspacePath: string): string {
  return `codepilotx.desktop.fileTreeView:${workspacePath
    .replace(/\\/g, '/')
    .toLowerCase()}`
}

function readFileTreeViewState(
  workspacePath: string,
  defaultVisible = false,
): FileTreeViewState {
  const fallback = {
    visible: defaultVisible,
    width: FILE_TREE_DEFAULT_WIDTH,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(fileTreeViewStorageKey(workspacePath))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as {
      visible?: unknown
      width?: unknown
    }
    return {
      visible:
        typeof parsed.visible === 'boolean' ? parsed.visible : fallback.visible,
      width:
        typeof parsed.width === 'number' && Number.isFinite(parsed.width)
          ? Math.max(FILE_TREE_MIN_WIDTH, Math.round(parsed.width))
          : fallback.width,
    }
  } catch {
    return fallback
  }
}

function writeFileTreeViewState(
  workspacePath: string,
  state: FileTreeViewState,
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      fileTreeViewStorageKey(workspacePath),
      JSON.stringify(state),
    )
  } catch {
    // File tree view persistence is best-effort.
  }
}
