import React from 'react'
import { formatReviewCount } from '../diff/reviewFormat.js'
import { ArrowDown, ArrowUp, ArrowUpToLine, ChevronDown, X } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'

import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../../components/ui/popoverSizing.js'
import { anchorPopoverToButton } from './popoverAnchor.js'

const DEFAULT_POPOVER_WIDTH = 360

type Props = {
  additions: number
  anchorRef: React.RefObject<HTMLElement>
  branchName: string
  deletions: number
  open: boolean
  onClose: () => void
  onCommit: (message: string, includeUnstaged: boolean) => void
  onCommitAndPush: (message: string, includeUnstaged: boolean) => void
  onPush: () => void
} & PopoverSizingProps

export function CommitPopover({
  additions,
  anchorRef,
  branchName,
  deletions,
  open,
  width,
  maxWidth,
  onClose,
  onCommit,
  onCommitAndPush,
  onPush,
}: Props): React.ReactNode {
  const [message, setMessage] = React.useState('')
  const [includeUnstaged, setIncludeUnstaged] = React.useState(true)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState<{
    left: number
    top: number
  } | null>(null)

  React.useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    function recompute(): void {
      const next = anchorPopoverToButton(
        anchorRef.current,
        typeof width === 'number' ? width : DEFAULT_POPOVER_WIDTH,
      )
      if (next) setPosition({ left: next.left, top: next.top })
    }
    recompute()
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [anchorRef, open, width])

  React.useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent): void {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchorRef, onClose, open])

  React.useEffect(() => {
    if (!open) {
      setMessage('')
      setIncludeUnstaged(true)
    }
  }, [open])

  if (!open || !position) return null

  return (
    <div
      aria-label="提交或推送"
      className="popover-surface review-popover commit-popover tw:fixed tw:z-popover tw:flex tw:min-w-[min(288px,calc(100vw-16px))] tw:max-w-[var(--popover-max-width,min(384px,calc(100vw-16px)))] tw:flex-col tw:gap-2 tw:p-2 tw:border tw:border-app-border tw:rounded-xl tw:bg-app-raised tw:font-sans tw:shadow-lg"
      ref={panelRef}
      role="dialog"
      style={{
        ...buildPopoverSizingStyle({
          width,
          maxWidth,
        }),
        left: position.left,
        top: position.top,
      }}
    >
      <header className="review-popover-header tw:flex tw:items-center tw:gap-2 tw:text-app-text tw:type-row-title">
        <span className="review-popover-branch tw:inline-flex tw:items-center tw:gap-1 tw:text-app-text">
          {branchName}
          <ChevronDown size={APP_ICON_SIZES.sm} />
        </span>
        <span className="review-popover-counts tw:ml-auto tw:inline-flex tw:items-center tw:gap-1 tw:type-weight-label tw:tabular-nums">
          <strong className="tw:text-app-success tw:type-weight-label">
            +{formatPanelNumber(additions)}
          </strong>
          <em className="tw:text-app-danger tw:not-italic tw:type-weight-label">
            -{formatPanelNumber(deletions)}
          </em>
        </span>
        <Button isIconOnly
          iconSize="sm"
          className="review-popover-close"
          color="ghostSecondary"
          size="toolbar"
          title="关闭"
          type="button"
          onClick={onClose}
        >
          <X size={APP_ICON_SIZES.sm} />
        </Button>
      </header>

      <label className="review-popover-field tw:flex tw:flex-col tw:gap-1 tw:text-app-text-soft tw:type-body-sm">
        <span className="tw:type-weight-label">提交信息</span>
        <textarea
          autoFocus
          className="tw:w-full tw:min-h-16 tw:resize-y tw:px-2 tw:py-1 tw:border tw:border-app-border-subtle tw:rounded-md tw:bg-app-canvas tw:text-app-text tw:type-control"
          placeholder="输入提交信息..."
          rows={3}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            if (event.target.value.length === 1) {
              // discard placeholder
            }
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onCommit(message, includeUnstaged)
            }
          }}
        />
      </label>

      <label className="review-popover-check tw:flex tw:items-center tw:gap-2 tw:text-app-text-soft tw:type-control">
        <input
          checked={includeUnstaged}
          type="checkbox"
          onChange={(event) => setIncludeUnstaged(event.target.checked)}
        />
        <span>包含未暂存的更改</span>
      </label>

      <div className="review-popover-actions tw:flex tw:flex-col tw:gap-1 tw:border-t tw:border-app-border tw:pt-1">
        <Button
          color="primary"
          className="tw:w-full tw:justify-between"
          disabled={false}
          onClick={() => onCommit(message, includeUnstaged)}
        >
          <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
            <ArrowUpToLine size={APP_ICON_SIZE} />
            提交
          </span>
          <span className="shortcut">Ctrl+Enter</span>
        </Button>
        <Button
          color="primary"
          className="tw:w-full tw:justify-between"
          onClick={() => onCommitAndPush(message, includeUnstaged)}
        >
          <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
            <ArrowUp size={APP_ICON_SIZE} />
            提交并推送
          </span>
        </Button>
        <Button color="primary" className="tw:w-full tw:justify-between" onClick={() => onPush()}>
          <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
            <ArrowDown size={APP_ICON_SIZE} />
            推送
          </span>
        </Button>
      </div>
    </div>
  )
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}
