import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Folder, FolderOpen, Search } from 'lucide-react'
import type {
  DesktopFileEntry,
  DesktopWorkspace,
} from '../../../shared/types.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { buildPopoverSizingStyle } from '../../components/ui/popoverSizing.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { cx } from '../../utils/cx.js'
import { FileTypeIcon } from './FileTypeIcon.js'

export type WorkspaceFileOpenOptions = {
  preview: boolean
}

export type WorkspaceFileTreeProps = {
  activePath?: string | null
  autoFocusSearch?: boolean
  className?: string
  files: DesktopFileEntry[]
  rootPath?: string | null
  searchable?: boolean
  workspace: DesktopWorkspace | null
  onAddComposerFiles?: (filePaths: string[]) => void
  onEscape?: () => void
  onOpenFile: (
    file: DesktopFileEntry,
    options: WorkspaceFileOpenOptions,
  ) => void
}

export function WorkspaceFileTree({
  activePath,
  autoFocusSearch = false,
  className,
  files,
  rootPath = null,
  searchable = true,
  workspace,
  onAddComposerFiles,
  onEscape,
  onOpenFile,
}: WorkspaceFileTreeProps): React.ReactNode {
  const [query, setQuery] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(
    () => new Set(),
  )
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const previewTimerRef = useRef<number | null>(null)
  const scopedFiles = useMemo(
    () => scopeWorkspaceFiles(files, rootPath),
    [files, rootPath],
  )
  const visibleFiles = useMemo(
    () => filterVisibleFiles(scopedFiles, query, collapsedDirs),
    [collapsedDirs, query, scopedFiles],
  )

  useEffect(() => {
    if (!activePath) return
    setCollapsedDirs(current => {
      const next = new Set(
        [...current].filter(directory => !isDescendantOf(activePath, directory)),
      )
      return next.size === current.size ? current : next
    })
    requestAnimationFrame(() => {
      rowRefs.current.get(normalizePath(activePath))?.scrollIntoView({
        block: 'nearest',
      })
    })
  }, [activePath])

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current)
      }
    },
    [],
  )

  function openPreviewSoon(file: DesktopFileEntry): void {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
    }
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      onOpenFile(file, { preview: true })
    }, 250)
  }

  function openPinned(file: DesktopFileEntry): void {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    onOpenFile(file, { preview: false })
  }

  function toggleDirectory(path: string): void {
    setCollapsedDirs(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div
      className={cx(
        'workspace-file-tree',
        'right-dock-file-tree',
        className,
      )}
    >
      {searchable ? (
        <label className="right-dock-search">
          <Search
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <input
            aria-label="筛选文件"
            autoFocus={autoFocusSearch}
            placeholder="筛选文件..."
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (query) setQuery('')
              else onEscape?.()
            }}
          />
        </label>
      ) : null}
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
                ref={element => {
                  const key = normalizePath(file.path)
                  if (element) rowRefs.current.set(key, element)
                  else rowRefs.current.delete(key)
                }}
                aria-expanded={
                  file.type === 'directory'
                    ? !collapsedDirs.has(file.path)
                    : undefined
                }
                className={cx(
                  'right-dock-tree-row',
                  activePath === file.path && 'active',
                )}
                key={file.path}
                role="treeitem"
                style={{ paddingLeft: `${6 + file.depth * 18}px` }}
                title={file.path}
                type="button"
                onClick={event => {
                  if (file.type === 'directory') {
                    if (event.detail > 1) return
                    toggleDirectory(file.path)
                    return
                  }
                  if (event.detail <= 1) openPreviewSoon(file)
                }}
                onDoubleClick={() => {
                  if (file.type === 'file') openPinned(file)
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onEscape?.()
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    if (file.type === 'directory') toggleDirectory(file.path)
                    else onOpenFile(file, { preview: true })
                  }
                }}
              >
                {file.type === 'directory' ? (
                  collapsedDirs.has(file.path) ? (
                    <Folder
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  ) : (
                    <FolderOpen
                      aria-hidden="true"
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  )
                ) : (
                  <FileTypeIcon
                    aria-hidden="true"
                    path={file.path}
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                )}
                <span>{file.name}</span>
              </button>
            )
            if (!sendablePath) return row
            return (
              <ContextMenu.Root key={file.path}>
                <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    className="sidebar-context-menu-content"
                    style={buildPopoverSizingStyle({ width: 220 })}
                  >
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
  )
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

export function createWorkspaceFileTabId(
  workspacePath: string,
  relativePath: string,
): `file:${string}` {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').toLowerCase()
  const normalizedFile = relativePath.replace(/\\/g, '/').toLowerCase()
  return `file:${encodeURIComponent(`${normalizedWorkspace}\u0000${normalizedFile}`)}`
}

function scopeWorkspaceFiles(
  files: DesktopFileEntry[],
  rootPath: string | null,
): DesktopFileEntry[] {
  const normalizedRoot = rootPath?.replace(/\\/g, '/').replace(/\/+$/u, '')
  if (!normalizedRoot) return files
  const rootDepth =
    files.find(
      file => normalizePath(file.path) === normalizePath(normalizedRoot),
    )?.depth ?? Math.max(0, normalizedRoot.split('/').length - 1)
  return files
    .filter(file => isDescendantOf(file.path, normalizedRoot))
    .map(file => ({ ...file, depth: Math.max(0, file.depth - rootDepth - 1) }))
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
      !isDescendantOf(
        file.path,
        hiddenPrefixes[hiddenPrefixes.length - 1] ?? '',
      )
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

function isDescendantOf(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedDirectory = normalizePath(directoryPath)
  return normalizedPath.startsWith(`${normalizedDirectory}/`)
}
