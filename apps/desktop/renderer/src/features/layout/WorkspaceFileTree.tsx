import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type React from 'react'
import { FolderIcon } from '@codepilotx/material-icon-theme'
import { LoaderCircle, RotateCcw, Search } from 'lucide-react'
import { VList, type VListHandle } from 'virtua'
import type {
  DesktopFileEntry,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { createWorkspaceFileTabId } from './tabs/workspaceFileTabId.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { AppContextMenu } from '../../components/ui/AppContextMenu.js'
import { desktopClient } from '../../services/desktop-client/index.js'
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
  revealToken?: number
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

type FileTreeRow =
  | { kind: 'entry'; file: DesktopFileEntry }
  | {
      kind: 'loading' | 'error'
      directoryPath: string
      depth: number
    }

const FILE_TREE_ROW_HEIGHT = 28

export function WorkspaceFileTree({
  activePath,
  autoFocusSearch = false,
  className,
  files,
  revealToken,
  rootPath = null,
  searchable = true,
  workspace,
  onAddComposerFiles,
  onEscape,
  onOpenFile,
}: WorkspaceFileTreeProps): React.ReactNode {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<DesktopFileEntry[]>(() =>
    rootPath ? [] : normalizeRootEntries(files),
  )
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  )
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(
    () => new Set(),
  )
  const [directoryErrors, setDirectoryErrors] = useState<Set<string>>(
    () => new Set(),
  )
  const entriesRef = useRef(entries)
  const loadedDirectoriesRef = useRef(new Set<string>())
  const loadingPromisesRef = useRef(new Map<string, Promise<void>>())
  const generationRef = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const listRef = useRef<VListHandle | null>(null)
  const previewTimerRef = useRef<number | null>(null)

  const replaceEntries = useCallback((next: DesktopFileEntry[]): void => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  const loadDirectory = useCallback(
    (
      directoryPath: string,
      parentDepth: number,
      options: { replaceRoot?: boolean } = {},
    ): Promise<void> => {
      const workspacePath = workspace?.path
      if (!workspacePath) return Promise.reject(new Error('未打开工作区。'))
      const key = normalizePath(directoryPath)
      if (loadedDirectoriesRef.current.has(key)) return Promise.resolve()
      const existing = loadingPromisesRef.current.get(key)
      if (existing) return existing

      const generation = generationRef.current
      setLoadingDirectories(current => addSetValue(current, key))
      setDirectoryErrors(current => removeSetValue(current, key))
      const request = desktopClient
        .listWorkspaceFiles(workspacePath, directoryPath)
        .then(children => {
          if (generationRef.current !== generation) return
          const normalizedChildren = children.map(child => ({
            ...child,
            depth: options.replaceRoot ? 0 : parentDepth + 1,
          }))
          const next = options.replaceRoot
            ? dedupeEntries(normalizedChildren)
            : insertDirectoryChildren(
                entriesRef.current,
                directoryPath,
                normalizedChildren,
              )
          replaceEntries(next)
          loadedDirectoriesRef.current.add(key)
        })
        .catch(error => {
          if (generationRef.current === generation) {
            setDirectoryErrors(current => addSetValue(current, key))
          }
          throw error
        })
        .finally(() => {
          loadingPromisesRef.current.delete(key)
          if (generationRef.current === generation) {
            setLoadingDirectories(current => removeSetValue(current, key))
          }
        })
      loadingPromisesRef.current.set(key, request)
      return request
    },
    [replaceEntries, workspace?.path],
  )

  useEffect(() => {
    generationRef.current += 1
    loadingPromisesRef.current.clear()
    loadedDirectoriesRef.current.clear()
    setExpandedDirectories(new Set())
    setLoadingDirectories(new Set())
    setDirectoryErrors(new Set())
    setQuery('')
    if (rootPath && workspace) {
      replaceEntries([])
      void loadDirectory(rootPath, -1, { replaceRoot: true }).catch(
        () => undefined,
      )
    } else {
      replaceEntries(normalizeRootEntries(files))
    }
  }, [files, loadDirectory, replaceEntries, rootPath, workspace?.path])

  useEffect(() => {
    if (!activePath || !workspace) return
    let cancelled = false
    const revealActivePath = async (): Promise<void> => {
      const ancestors = ancestorDirectoryPaths(activePath).filter(path =>
        isWithinRoot(path, rootPath),
      )
      if (rootPath) {
        await loadDirectory(rootPath, -1, { replaceRoot: true })
      }
      for (const directoryPath of ancestors) {
        if (cancelled) return
        const directory = entriesRef.current.find(
          entry =>
            entry.type === 'directory' &&
            normalizePath(entry.path) === normalizePath(directoryPath),
        )
        if (!directory) return
        setExpandedDirectories(current =>
          addSetValue(current, normalizePath(directory.path)),
        )
        await loadDirectory(directory.path, directory.depth)
      }
      if (cancelled) return
      // If activePath itself is a directory, expand and load it too
      const targetEntry = entriesRef.current.find(
        entry =>
          entry.type === 'directory' &&
          normalizePath(entry.path) === normalizePath(activePath),
      )
      if (targetEntry) {
        setExpandedDirectories(current =>
          addSetValue(current, normalizePath(targetEntry.path)),
        )
        await loadDirectory(targetEntry.path, targetEntry.depth)
      }
    }
    void revealActivePath().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activePath, loadDirectory, revealToken, rootPath, workspace?.path])

  const visibleRows = useMemo(
    () =>
      buildVisibleRows(
        entries,
        query,
        expandedDirectories,
        loadingDirectories,
        directoryErrors,
      ),
    [
      directoryErrors,
      entries,
      expandedDirectories,
      loadingDirectories,
      query,
    ],
  )

  useEffect(() => {
    if (!activePath) return
    const index = visibleRows.findIndex(
      row =>
        row.kind === 'entry' &&
        normalizePath(row.file.path) === normalizePath(activePath),
    )
    if (index < 0) return
    listRef.current?.scrollToIndex(index, { align: 'nearest' })
    requestAnimationFrame(() => {
      rowRefs.current.get(normalizePath(activePath))?.scrollIntoView({
        block: 'nearest',
      })
    })
  }, [activePath, revealToken, visibleRows])

  useEffect(
    () => () => {
      generationRef.current += 1
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

  function toggleDirectory(file: DesktopFileEntry): void {
    const key = normalizePath(file.path)
    if (loadingDirectories.has(key)) return
    if (directoryErrors.has(key)) {
      void loadDirectory(file.path, file.depth).catch(() => undefined)
      return
    }
    if (expandedDirectories.has(key)) {
      setExpandedDirectories(current => removeSetValue(current, key))
      return
    }
    setExpandedDirectories(current => addSetValue(current, key))
    void loadDirectory(file.path, file.depth).catch(() => undefined)
  }

  function focusVisibleEntry(
    startIndex: number,
    direction: 1 | -1,
  ): void {
    let index = startIndex
    while (index >= 0 && index < visibleRows.length) {
      const row = visibleRows[index]
      if (row?.kind === 'entry') {
        listRef.current?.scrollToIndex(index, { align: 'nearest' })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            rowRefs.current
              .get(normalizePath(row.file.path))
              ?.focus({ preventScroll: true })
          })
        })
        return
      }
      index += direction
    }
  }

  const renderRow = (row: FileTreeRow): React.ReactElement => {
    if (row.kind !== 'entry') {
      const loading = row.kind === 'loading'
      return (
        <button
          aria-disabled={loading}
          className={cx('right-dock-tree-row', 'is-status', row.kind)}
          disabled={loading}
          role="treeitem"
          style={{ paddingLeft: `${6 + row.depth * 18}px` }}
          type="button"
          onClick={() => {
            const directory = entriesRef.current.find(
              entry =>
                entry.type === 'directory' &&
                normalizePath(entry.path) ===
                  normalizePath(row.directoryPath),
            )
            if (directory) toggleDirectory(directory)
          }}
        >
          {loading ? (
            <LoaderCircle
              aria-hidden="true"
              className="is-spinning"
              size={APP_ICON_SIZE}
            />
          ) : (
            <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
          )}
          <span>{loading ? '正在加载…' : '加载失败，点击重试'}</span>
        </button>
      )
    }

    const file = row.file
    const key = normalizePath(file.path)
    const sendablePath = getSendableFilePath({
      workspacePath: workspace?.path ?? null,
      file,
    })
    const treeItem = (
      <button
        ref={element => {
          if (element) rowRefs.current.set(key, element)
          else rowRefs.current.delete(key)
        }}
        aria-expanded={
          file.type === 'directory'
            ? expandedDirectories.has(key)
            : undefined
        }
        className={cx(
          'right-dock-tree-row',
          activePath != null &&
            normalizePath(activePath) === key &&
            'active',
        )}
        role="treeitem"
        style={{ paddingLeft: `${6 + file.depth * 18}px` }}
        title={file.path}
        type="button"
        onClick={event => {
          if (file.type === 'directory') {
            if (event.detail <= 1) toggleDirectory(file)
            return
          }
          if (event.detail <= 1) openPreviewSoon(file)
        }}
        onDoubleClick={() => {
          if (file.type === 'file') openPinned(file)
        }}
        onKeyDown={event => {
          const rowIndex = visibleRows.findIndex(
            candidate =>
              candidate.kind === 'entry' &&
              normalizePath(candidate.file.path) === key,
          )
          if (event.key === 'Escape') {
            event.preventDefault()
            onEscape?.()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusVisibleEntry(rowIndex + 1, 1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusVisibleEntry(rowIndex - 1, -1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            focusVisibleEntry(0, 1)
          } else if (event.key === 'End') {
            event.preventDefault()
            focusVisibleEntry(visibleRows.length - 1, -1)
          } else if (
            event.key === 'ArrowRight' &&
            file.type === 'directory'
          ) {
            event.preventDefault()
            if (!expandedDirectories.has(key)) toggleDirectory(file)
            else focusVisibleEntry(rowIndex + 1, 1)
          } else if (
            event.key === 'ArrowLeft' &&
            file.type === 'directory' &&
            expandedDirectories.has(key)
          ) {
            event.preventDefault()
            setExpandedDirectories(current => removeSetValue(current, key))
          } else if (event.key === 'ArrowLeft') {
            const parentPath = parentDirectoryPath(file.path)
            if (!parentPath) return
            const parentIndex = visibleRows.findIndex(
              candidate =>
                candidate.kind === 'entry' &&
                normalizePath(candidate.file.path) ===
                  normalizePath(parentPath),
            )
            if (parentIndex < 0) return
            event.preventDefault()
            focusVisibleEntry(parentIndex, -1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (file.type === 'directory') toggleDirectory(file)
            else onOpenFile(file, { preview: true })
          }
        }}
      >
        {file.type === 'directory' ? (
          <FolderIcon
            aria-hidden="true"
            expanded={expandedDirectories.has(key)}
            path={file.path}
            size={APP_ICON_SIZE}
          />
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
    if (!sendablePath) return treeItem
    return (
      <AppContextMenu
        actions={[
          {
            kind: 'item',
            label: '发送到对话框',
            onSelect: () => onAddComposerFiles?.([sendablePath]),
          },
        ]}
        trigger={treeItem}
        width={220}
      />
    )
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
      {visibleRows.length > 0 ? (
        <VList
          ref={listRef}
          className="right-dock-tree-scroll-area right-dock-tree-vlist"
          data={visibleRows}
          data-file-tree-virtualized-scroll="true"
          itemSize={FILE_TREE_ROW_HEIGHT}
          role="tree"
        >
          {row => <Fragment key={fileTreeRowKey(row)}>{renderRow(row)}</Fragment>}
        </VList>
      ) : (
        <div className="right-dock-tree-empty">
          {workspace && rootPath && directoryErrors.has(normalizePath(rootPath)) ? (
            <button
              className="right-dock-tree-retry"
              type="button"
              onClick={() => {
                void loadDirectory(rootPath, -1, { replaceRoot: true }).catch(
                  () => undefined,
                )
              }}
            >
              <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} />
              目录加载失败，点击重试
            </button>
          ) : workspace ? (
            query ? (
              '没有匹配的文件。'
            ) : (
              '此目录为空。'
            )
          ) : (
            '未打开工作区。'
          )}
        </div>
      )}
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

export { createWorkspaceFileTabId }

function normalizeRootEntries(files: DesktopFileEntry[]): DesktopFileEntry[] {
  return dedupeEntries(files.map(file => ({ ...file, depth: 0 })))
}

function dedupeEntries(entries: DesktopFileEntry[]): DesktopFileEntry[] {
  const seen = new Set<string>()
  return entries.filter(entry => {
    const key = normalizePath(entry.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function insertDirectoryChildren(
  entries: DesktopFileEntry[],
  directoryPath: string,
  children: DesktopFileEntry[],
): DesktopFileEntry[] {
  const parentIndex = entries.findIndex(
    entry => normalizePath(entry.path) === normalizePath(directoryPath),
  )
  if (parentIndex < 0) return entries
  const existing = new Set(entries.map(entry => normalizePath(entry.path)))
  const uniqueChildren = children.filter(
    child => !existing.has(normalizePath(child.path)),
  )
  if (uniqueChildren.length === 0) return entries
  return [
    ...entries.slice(0, parentIndex + 1),
    ...uniqueChildren,
    ...entries.slice(parentIndex + 1),
  ]
}

function buildVisibleRows(
  entries: DesktopFileEntry[],
  query: string,
  expandedDirectories: Set<string>,
  loadingDirectories: Set<string>,
  directoryErrors: Set<string>,
): FileTreeRow[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery) {
    return entries
      .filter(entry => entry.path.toLowerCase().includes(normalizedQuery))
      .map(file => ({ kind: 'entry' as const, file }))
  }

  const rows: FileTreeRow[] = []
  const hiddenDirectories: string[] = []
  for (const file of entries) {
    while (
      hiddenDirectories.length > 0 &&
      !isDescendantOf(file.path, hiddenDirectories.at(-1) ?? '')
    ) {
      hiddenDirectories.pop()
    }
    if (hiddenDirectories.length > 0) continue
    rows.push({ kind: 'entry', file })
    if (file.type !== 'directory') continue
    const key = normalizePath(file.path)
    if (!expandedDirectories.has(key)) {
      hiddenDirectories.push(file.path)
      continue
    }
    if (loadingDirectories.has(key)) {
      rows.push({
        kind: 'loading',
        directoryPath: file.path,
        depth: file.depth + 1,
      })
    } else if (directoryErrors.has(key)) {
      rows.push({
        kind: 'error',
        directoryPath: file.path,
        depth: file.depth + 1,
      })
    }
  }
  return rows
}

function ancestorDirectoryPaths(path: string): string[] {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) =>
    segments.slice(0, index + 1).join('/'),
  )
}

function parentDirectoryPath(path: string): string | null {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.length > 1 ? segments.slice(0, -1).join('/') : null
}

function isWithinRoot(path: string, rootPath: string | null): boolean {
  if (!rootPath) return true
  const key = normalizePath(path)
  const rootKey = normalizePath(rootPath)
  return key !== rootKey && key.startsWith(`${rootKey}/`)
}

function fileTreeRowKey(row: FileTreeRow): string {
  return row.kind === 'entry'
    ? `entry:${normalizePath(row.file.path)}`
    : `${row.kind}:${normalizePath(row.directoryPath)}`
}

function addSetValue(current: Set<string>, value: string): Set<string> {
  if (current.has(value)) return current
  const next = new Set(current)
  next.add(value)
  return next
}

function removeSetValue(current: Set<string>, value: string): Set<string> {
  if (!current.has(value)) return current
  const next = new Set(current)
  next.delete(value)
  return next
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

function isDescendantOf(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedDirectory = normalizePath(directoryPath)
  return normalizedPath.startsWith(`${normalizedDirectory}/`)
}
