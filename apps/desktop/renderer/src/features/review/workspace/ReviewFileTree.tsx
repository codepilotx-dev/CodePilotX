import React from 'react'
import { FileIcon, FolderIcon } from '@codepilotx/material-icon-theme'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  MessageSquare,
  SquareArrowRight,
  SquareDashed,
  SquareDot,
  SquareMinus,
  SquarePlus,
  type LucideIcon,
} from 'lucide-react'
import type { DesktopReviewDiffFile } from '../../../../shared/types.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { ReviewFileTreeRow as ReviewFileTreeRowModel } from './buildReviewFileTree.js'
import {
  normalizeReviewFileStatus,
  reviewFileStatusLabel,
  type ReviewFileStatusKind,
} from './reviewFileStatus.js'

type Props = {
  commentCountsByPath?: Readonly<Record<string, number>>
  row: ReviewFileTreeRowModel
  collapsedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
  selectedPath: string | null
}

export function ReviewFileTreeRow({
  commentCountsByPath,
  row,
  collapsedDirs,
  onSelectFile,
  onToggleDir,
  selectedPath,
}: Props): React.ReactNode {
  if (row.kind === 'file') {
    return (
      <ReviewFileRow
        active={row.file.path === selectedPath}
        commentCount={commentCountsByPath?.[row.file.path] ?? 0}
        depth={row.depth}
        file={row.file}
        onSelect={onSelectFile}
      />
    )
  }

  const { node } = row
  const collapsed = collapsedDirs.has(node.dirPath)
  const dirCommentCount = commentCountsByPath?.[node.dirPath] ?? 0
  return (
    <button
      aria-expanded={!collapsed}
      aria-level={row.depth + 1}
      className="review-file-tree-dir"
      role="treeitem"
      style={{ paddingLeft: `${12 + row.depth * 14}px` }}
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
      <span className="review-file-tree-trailing">
        {dirCommentCount > 0 ? (
          <span className="review-comment-badge">{dirCommentCount}</span>
        ) : null}
        <span
          aria-hidden="true"
          className="review-file-tree-directory-status"
        />
      </span>
    </button>
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
  const status = normalizeReviewFileStatus(file)
  const statusLabel = reviewFileStatusLabel(status)
  return (
    <button
      aria-level={depth + 1}
      aria-selected={active}
      className={active ? 'review-file-tree-row active' : 'review-file-tree-row'}
      role="treeitem"
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      title={`${file.path} · ${statusLabel}`}
      type="button"
      onClick={() => onSelect(file.path)}
    >
      <FileIcon
        aria-hidden="true"
        associationMode="extension-only"
        path={file.path}
        size={APP_ICON_SIZE}
      />
      <span className="review-file-path">{displayName}</span>
      <span className="review-file-tree-trailing">
        {commentCount > 0 ? (
          <span className="review-comment-badge">
            <MessageSquare size={12} />
            {commentCount}
          </span>
        ) : null}
        <ReviewFileStatusIcon status={status} />
      </span>
    </button>
  )
}

const REVIEW_FILE_STATUS_ICONS: Record<ReviewFileStatusKind, LucideIcon> = {
  added: SquarePlus,
  deleted: SquareMinus,
  modified: SquareDot,
  renamed: SquareArrowRight,
  copied: Copy,
  unknown: SquareDashed,
}

function ReviewFileStatusIcon({
  status,
}: {
  status: ReviewFileStatusKind
}): React.ReactNode {
  const Icon = REVIEW_FILE_STATUS_ICONS[status]
  const label = reviewFileStatusLabel(status)
  return (
    <span
      aria-label={`Git 状态：${label}`}
      className="review-file-tree-status"
      data-git-status={status}
      title={label}
    >
      <Icon aria-hidden="true" size={APP_ICON_SIZE} />
    </span>
  )
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}
