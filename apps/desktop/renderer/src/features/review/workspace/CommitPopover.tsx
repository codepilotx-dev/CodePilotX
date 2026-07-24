import React from 'react'
import { formatReviewCount } from '../diff/reviewFormat.js'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
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
  disableOutsideDismiss?: boolean
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
  disableOutsideDismiss = false,
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
      if (disableOutsideDismiss) return
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
  }, [anchorRef, disableOutsideDismiss, onClose, open])

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
      className="popover-surface review-popover commit-popover"
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
      <header className="review-popover-header">
        <span className="review-popover-branch">
          {branchName}
          <ChevronDown size={APP_ICON_SIZE} />
        </span>
        <span className="review-popover-counts">
          <strong>+{formatPanelNumber(additions)}</strong>
          <em>-{formatPanelNumber(deletions)}</em>
        </span>
        <button
          aria-label="关闭"
          className="review-popover-close"
          type="button"
          onClick={onClose}
        >
          <X size={APP_ICON_SIZE} />
        </button>
      </header>

      <label className="review-popover-field">
        <span>提交信息</span>
        <textarea
          autoFocus
          placeholder="输入提交信息..."
          rows={3}
          value={message}
          onChange={event => {
            setMessage(event.target.value)
            if (event.target.value.length === 1) {
              // discard placeholder
            }
          }}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onCommit(message, includeUnstaged)
            }
          }}
        />
      </label>

      <label className="review-popover-check">
        <input
          checked={includeUnstaged}
          type="checkbox"
          onChange={event => setIncludeUnstaged(event.target.checked)}
        />
        <span>包含未暂存的更改</span>
      </label>

      <div className="review-popover-actions">
        <button
          className="review-popover-action"
          disabled={false}
          type="button"
          onClick={() => onCommit(message, includeUnstaged)}
        >
          <span className="review-popover-action-label">
            <ArrowUpToLine size={APP_ICON_SIZE} />
            提交
          </span>
          <span className="shortcut">Ctrl+Enter</span>
        </button>
        <button
          className="review-popover-action"
          type="button"
          onClick={() => onCommitAndPush(message, includeUnstaged)}
        >
          <span className="review-popover-action-label">
            <ArrowUp size={APP_ICON_SIZE} />
            提交并推送
          </span>
        </button>
        <button
          className="review-popover-action"
          type="button"
          onClick={() => onPush()}
        >
          <span className="review-popover-action-label">
            <ArrowDown size={APP_ICON_SIZE} />
            推送
          </span>
        </button>
      </div>
    </div>
  )
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}
