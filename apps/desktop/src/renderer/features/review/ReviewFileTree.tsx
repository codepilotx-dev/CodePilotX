import React from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  Folder,
  FolderOpen,
} from 'lucide-react'
import type { DesktopReviewDiffFile } from '../../../shared/types.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import type { ReviewFileTreeNode } from './buildReviewFileTree.js'

type Props = {
  depth?: number
  node: ReviewFileTreeNode
  collapsedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
  selectedPath: string | null
}

export function ReviewFileTreeNode({
  depth = 0,
  node,
  collapsedDirs,
  onSelectFile,
  onToggleDir,
  selectedPath,
}: Props): React.ReactNode {
  const isRoot = node.dirPath === ''
  const collapsed = !isRoot && collapsedDirs.has(node.dirPath)

  return (
    <React.Fragment>
      {!isRoot ? (
        <button
          aria-expanded={!collapsed}
          className="review-file-tree-dir"
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          type="button"
          onClick={() => onToggleDir(node.dirPath)}
        >
          {collapsed ? (
            <ChevronRight size={APP_ICON_SIZE} />
          ) : (
            <ChevronDown size={APP_ICON_SIZE} />
          )}
          {collapsed ? (
            <Folder size={APP_ICON_SIZE} />
          ) : (
            <FolderOpen size={APP_ICON_SIZE} />
          )}
          <span>{node.dirLabel}</span>
        </button>
      ) : null}

      {!collapsed && node.files.length > 0 ? (
        <div className="review-file-tree-files">
          {node.files.map(file => (
            <ReviewFileRow
              active={file.path === selectedPath}
              depth={isRoot ? depth : depth + 1}
              file={file}
              key={file.path}
              onSelect={onSelectFile}
            />
          ))}
        </div>
      ) : null}

      {!collapsed && node.children.length > 0
        ? node.children.map(child => (
            <ReviewFileTreeNode
              collapsedDirs={collapsedDirs}
              depth={isRoot ? depth : depth + 1}
              key={child.dirPath}
              node={child}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              selectedPath={selectedPath}
            />
          ))
        : null}
    </React.Fragment>
  )
}

function ReviewFileRow({
  active,
  depth,
  file,
  onSelect,
}: {
  active: boolean
  depth: number
  file: DesktopReviewDiffFile
  onSelect: (path: string) => void
}): React.ReactNode {
  return (
    <button
      className={active ? 'review-file-tree-row active' : 'review-file-tree-row'}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      title={file.path}
      type="button"
      onClick={() => onSelect(file.path)}
    >
      <span className="review-file-badge">{fileBadge(file.path)}</span>
      <span className="review-file-path">{file.path}</span>
      <span className="review-file-counts">
        <strong>+{formatPanelNumber(file.additions)}</strong>
        <em>-{formatPanelNumber(file.deletions)}</em>
      </span>
    </button>
  )
}

function fileBadge(path: string): React.ReactNode {
  const ext = path.split('.').pop()?.slice(0, 4).toUpperCase()
  return ext || <FileDiff size={APP_ICON_SIZE} />
}

function formatPanelNumber(value: number): string {
  if (value > 999) return '999+'
  return String(value)
}