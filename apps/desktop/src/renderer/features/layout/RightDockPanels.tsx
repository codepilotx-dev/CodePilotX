import type React from 'react'
import { useMemo, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { FileText, Folder, FolderOpen, ListChecks, Search, SquareTerminal } from 'lucide-react'
import type {
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { MarkdownMessage } from '../session/MarkdownMessage.js'
import type { RightDockPlan } from './rightDockTools.js'

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

  return (
    <section className="right-dock-files" aria-label="打开文件">
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

export function RightDockSideChatPanel(): React.ReactNode {
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
