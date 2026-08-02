import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { Folder, FolderOpen, ListChecks } from 'lucide-react'
import { motion, useMotionValue, useTransform } from 'motion/react'
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
const FILE_TREE_FALLBACK_MAX_WIDTH = 480
const FILE_TREE_MAX_WIDTH_RATIO = 0.6

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
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const treeResize = useEditorFileTreeResize({
    committedWidth: treeWidth,
    layoutRef,
    onCommitWidth: setTreeWidth,
  })

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
            title={treeVisible ? '隐藏文件树' : '显示文件树'}
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
      <motion.div
        ref={layoutRef}
        className={cx(
          'right-dock-file-editor-layout',
          'right-dock-open-file-layout',
          treeVisible && 'has-file-tree',
        )}
        style={treeResize.layoutStyle}
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
              aria-valuemax={treeResize.maximumWidth}
              aria-valuemin={FILE_TREE_MIN_WIDTH}
              aria-valuenow={treeWidth}
              className="right-dock-editor-tree-resize-handle"
              role="separator"
              tabIndex={0}
              title="拖拽调整文件树宽度，双击恢复默认宽度"
              onDoubleClick={treeResize.resetWidth}
              onKeyDown={treeResize.handleKeyDown}
              onPointerDown={treeResize.startResize}
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
      </motion.div>
    </section>
  )
}

export function RightDockFilePreviewPanel({
  workspacePath,
  projectId,
  folderId,
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
  projectId?: string
  folderId?: string
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
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const [switchingMarkdownMode, setSwitchingMarkdownMode] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const treeResize = useEditorFileTreeResize({
    committedWidth: treeWidth,
    layoutRef,
    onCommitWidth: setTreeWidth,
  })
  const initialLoadKeyRef = useRef<string | null>(null)
  const onLoadErrorRef = useRef(onLoadError)
  const documentScope = { projectId, folderId }
  const document = useFileDocument(workspacePath, expectedPath, documentScope)
  const language = resolveLanguageFromPath(expectedPath)
  const isMarkdown = isMarkdownFilePath(expectedPath)
  const resolvedMarkdownViewMode = isMarkdown
    ? (markdownViewMode ?? 'rich')
    : undefined

  useEffect(() => {
    onLoadErrorRef.current = onLoadError
  }, [onLoadError])

  useEffect(() => {
    const loadKey = `${projectId ?? ''}\u0000${folderId ?? ''}\u0000${workspacePath}\u0000${expectedPath}`
    if (initialLoadKeyRef.current === loadKey) return
    initialLoadKeyRef.current = loadKey
    void prefetchFileDocument(
      workspacePath,
      expectedPath,
      documentScope,
    ).catch(error => {
      if (initialLoadKeyRef.current !== loadKey) return
      onLoadErrorRef.current?.(
        error instanceof Error ? error : new Error(String(error)),
        'initial',
      )
    })
  }, [expectedPath, folderId, projectId, workspacePath])

  useEffect(() => {
    if (document.status !== 'ready') return
    return startFileDocumentExternalChecks(
      workspacePath,
      expectedPath,
      {
        onLoadError: error =>
          onLoadErrorRef.current?.(error, 'external-sync'),
      },
      documentScope,
    )
  }, [document.status, expectedPath, folderId, projectId, workspacePath])

  useEffect(() => {
    writeFileTreeViewState(workspacePath, {
      visible: treeVisible,
      width: treeWidth,
    })
  }, [treeVisible, treeWidth, workspacePath])

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

  async function toggleMarkdownViewMode(): Promise<void> {
    if (!resolvedMarkdownViewMode || switchingMarkdownMode || document.conflict) {
      return
    }
    setSwitchingMarkdownMode(true)
    try {
      if (
        document.dirty &&
        !(await saveFileDocument(workspacePath, expectedPath, documentScope))
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
          treeAvailable
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
        <motion.div
          ref={layoutRef}
          className={cx(
            'right-dock-file-editor-layout',
            treeVisible && 'has-file-tree',
          )}
          style={treeResize.layoutStyle}
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
            layout="flex"
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
                      updateFileDocument(
                        workspacePath,
                        expectedPath,
                        value,
                        documentScope,
                      )
                    }
                    onKeepLocal={() =>
                      resolveFileDocumentConflict(
                        workspacePath,
                        expectedPath,
                        'local',
                        undefined,
                        documentScope,
                      )
                    }
                    onUseDisk={() =>
                      resolveFileDocumentConflict(
                        workspacePath,
                        expectedPath,
                        'disk',
                        undefined,
                        documentScope,
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
                      updateFileDocument(
                        workspacePath,
                        expectedPath,
                        value,
                        documentScope,
                      )
                    }}
                    onSave={async () => {
                      await saveFileDocument(
                        workspacePath,
                        expectedPath,
                        documentScope,
                      )
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
                aria-valuemax={treeResize.maximumWidth}
                aria-valuemin={FILE_TREE_MIN_WIDTH}
                aria-valuenow={treeWidth}
                className="right-dock-editor-tree-resize-handle"
                role="separator"
                tabIndex={0}
                title="拖拽调整文件树宽度，双击恢复默认宽度"
                onDoubleClick={treeResize.resetWidth}
                onKeyDown={treeResize.handleKeyDown}
                onPointerDown={treeResize.startResize}
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
        </motion.div>
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

type ActiveFileTreeResize = {
  finish: (outcome: 'commit' | 'restore') => void
}

function resolveFileTreeMaximumWidth(
  layout: HTMLDivElement | null,
): number {
  const layoutWidth = layout?.getBoundingClientRect().width ?? 0
  return Math.round(
    layoutWidth > 0
      ? Math.max(
          FILE_TREE_MIN_WIDTH,
          layoutWidth * FILE_TREE_MAX_WIDTH_RATIO,
        )
      : FILE_TREE_FALLBACK_MAX_WIDTH,
  )
}

function clampFileTreeWidth(
  width: number,
  layout: HTMLDivElement | null,
): number {
  return Math.min(
    resolveFileTreeMaximumWidth(layout),
    Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)),
  )
}

function useEditorFileTreeResize({
  committedWidth,
  layoutRef,
  onCommitWidth,
}: {
  committedWidth: number
  layoutRef: React.RefObject<HTMLDivElement | null>
  onCommitWidth: React.Dispatch<React.SetStateAction<number>>
}): {
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  layoutStyle: React.CSSProperties
  maximumWidth: number
  resetWidth: () => void
  startResize: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const liveWidth = useMotionValue(committedWidth)
  const liveWidthPixels = useTransform(
    liveWidth,
    width => `${Math.round(width)}px`,
  )
  const committedWidthRef = useRef(committedWidth)
  const activeResizeRef = useRef<ActiveFileTreeResize | null>(null)

  useLayoutEffect(() => {
    committedWidthRef.current = committedWidth
    if (!activeResizeRef.current) {
      liveWidth.set(committedWidth)
    }
  }, [committedWidth, liveWidth])

  useEffect(
    () => () => {
      activeResizeRef.current?.finish('restore')
    },
    [],
  )

  function commitWidth(width: number): void {
    const nextWidth = clampFileTreeWidth(width, layoutRef.current)
    committedWidthRef.current = nextWidth
    liveWidth.set(nextWidth)
    onCommitWidth(nextWidth)
  }

  function startResize(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0) return
    event.preventDefault()
    activeResizeRef.current?.finish('restore')

    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = committedWidthRef.current
    let pendingWidth = startWidth
    let frameId: number | null = null
    let finished = false

    const flushPreview = (): void => {
      frameId = null
      liveWidth.set(pendingWidth)
    }
    const queuePreview = (width: number): void => {
      pendingWidth = clampFileTreeWidth(width, layoutRef.current)
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(flushPreview)
    }
    const removeListeners = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onWindowBlur)
      handle.removeEventListener('lostpointercapture', onLostPointerCapture)
    }
    const finish = (outcome: 'commit' | 'restore'): void => {
      if (finished) return
      finished = true
      removeListeners()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }
      window.document.body.classList.remove('file-tree-is-resizing')
      activeResizeRef.current = null
      if (outcome === 'commit') {
        committedWidthRef.current = pendingWidth
        liveWidth.set(pendingWidth)
        onCommitWidth(pendingWidth)
      } else {
        liveWidth.set(committedWidthRef.current)
      }
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
    }
    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      queuePreview(startWidth + startX - moveEvent.clientX)
    }
    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      pendingWidth = clampFileTreeWidth(
        startWidth + startX - upEvent.clientX,
        layoutRef.current,
      )
      finish('commit')
    }
    const onPointerCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId !== pointerId) return
      finish('restore')
    }
    const onWindowBlur = (): void => finish('restore')
    const onLostPointerCapture = (): void => finish('restore')

    activeResizeRef.current = { finish }
    window.document.body.classList.add('file-tree-is-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onWindowBlur)
    handle.addEventListener('lostpointercapture', onLostPointerCapture)
    handle.setPointerCapture(pointerId)
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void {
    const step = event.shiftKey ? 40 : 10
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitWidth(committedWidthRef.current + step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitWidth(committedWidthRef.current - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commitWidth(FILE_TREE_DEFAULT_WIDTH)
    }
  }

  return {
    handleKeyDown,
    layoutStyle: {
      '--right-dock-editor-tree-width': liveWidthPixels,
    } as React.CSSProperties,
    maximumWidth: resolveFileTreeMaximumWidth(layoutRef.current),
    resetWidth: () => commitWidth(FILE_TREE_DEFAULT_WIDTH),
    startResize,
  }
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
