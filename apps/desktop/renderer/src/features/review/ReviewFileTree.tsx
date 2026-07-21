import React from 'react'
import { FileIcon, FolderIcon } from '@codepilotx/material-icon-theme'
import { formatReviewCount } from './reviewFormat.js'
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from 'lucide-react'
import type { DesktopReviewDiffFile } from '../../../shared/types.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import type { ReviewFileTreeNode } from './buildReviewFileTree.js'

type Props = {
  commentCountsByPath?: Readonly<Record<string, number>>
  depth?: number
  node: ReviewFileTreeNode
  collapsedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
  selectedPath: string | null
}

export function ReviewFileTreeNode({
  commentCountsByPath,
  depth = 0,
  node,
  collapsedDirs,
  onSelectFile,
  onToggleDir,
  selectedPath,
}: Props): React.ReactNode {
  const isRoot = node.dirPath === ''
  const collapsed = !isRoot && collapsedDirs.has(node.dirPath)
  const dirCommentCount = !isRoot
    ? (commentCountsByPath?.[node.dirPath] ?? 0)
    : 0

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
          <FolderIcon
            aria-hidden="true"
            expanded={!collapsed}
            path={node.dirPath}
            size={APP_ICON_SIZE}
          />
          <span className="review-file-tree-dir-label">{node.dirLabel}</span>
          {dirCommentCount > 0 ? (
            <span className="review-comment-badge">{dirCommentCount}</span>
          ) : null}
        </button>
      ) : null}

      {!collapsed && node.files.length > 0 ? (
        <div className="review-file-tree-files">
          {node.files.map(file => (
            <ReviewFileRow
              active={file.path === selectedPath}
              commentCount={commentCountsByPath?.[file.path] ?? 0}
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
              commentCountsByPath={commentCountsByPath}
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
  commentCount,
  depth,
  file,
  onSelect,
}: {
  active: boolean
  commentCount: number
  depth: number
  file: DesktopReviewDiffFile
  onSelect: (path: string) => void
}): React.ReactNode {
  const displayName = basenameOf(file.path)
  return (
    <button
      className={active ? 'review-file-tree-row active' : 'review-file-tree-row'}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      title={file.path}
      type="button"
      onClick={() => onSelect(file.path)}
    >
      <FileIcon aria-hidden="true" path={file.path} size={APP_ICON_SIZE} />
      <span className="review-file-path">{displayName}</span>
      {commentCount > 0 ? (
        <span className="review-comment-badge">
          <MessageSquare size={12} />
          {commentCount}
        </span>
      ) : null}
      <span className="review-file-counts">
        <strong>+{formatPanelNumber(file.additions)}</strong>
        <em>-{formatPanelNumber(file.deletions)}</em>
      </span>
    </button>
  )
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}
