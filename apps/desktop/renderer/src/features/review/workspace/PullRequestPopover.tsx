import React from 'react'
import { formatReviewCount } from '../diff/reviewFormat.js'
import {
  ArrowUpRight,
  ChevronDown,
  ExternalLink,
  GitFork,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../../components/ui/popoverSizing.js'
import { anchorPopoverToButton } from './popoverAnchor.js'

const DEFAULT_POPOVER_WIDTH = 420

type Props = {
  additions: number
  anchorRef: React.RefObject<HTMLElement>
  branchName: string | null
  defaultBranch: string | null
  deletions: number
  open: boolean
  onClose: () => void
  onCreateDraftPR: (title: string, body: string, pushFirst: boolean) => void
  onCreatePR: (title: string, body: string, pushFirst: boolean) => void
  onOpenPR: () => void
} & PopoverSizingProps

export function PullRequestPopover({
  additions,
  anchorRef,
  branchName,
  defaultBranch,
  deletions,
  open,
  width,
  maxWidth,
  onClose,
  onCreateDraftPR,
  onCreatePR,
  onOpenPR,
}: Props): React.ReactNode {
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [pushFirst, setPushFirst] = React.useState(true)
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
    if (open) {
      setTitle(branchName ?? '')
      setBody('')
      setPushFirst(true)
    }
  }, [branchName, open])

  if (!open || !position) return null

  const branchLabel = branchName ?? '当前分支'
  const targetLabel = defaultBranch ?? 'main'

  return (
    <div
      aria-label="创建拉取请求"
      className="popover-surface review-popover pr-popover"
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
          <span className="review-popover-branch-name">{branchLabel}</span>
          <ArrowUpRight size={APP_ICON_SIZE} />
          <span>{targetLabel}</span>
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
        <span>标题</span>
        <input
          type="text"
          value={title}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onCreateDraftPR(title, body, pushFirst)
            }
          }}
        />
      </label>

      <label className="review-popover-field">
        <span>描述（留空将自动生成）</span>
        <textarea
          placeholder="描述（留空将自动生成）..."
          rows={4}
          value={body}
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              onCreateDraftPR(title, body, pushFirst)
            }
          }}
        />
      </label>

      <label className="review-popover-check">
        <input
          checked={pushFirst}
          type="checkbox"
          onChange={event => setPushFirst(event.target.checked)}
        />
        <span>先推送当前分支</span>
      </label>

      <div className="review-popover-actions">
        <Button
          className="tw:w-full tw:justify-between"
          onClick={() => onCreateDraftPR(title, body, pushFirst)}
        >
          <span className="review-popover-action-label">
            <GitFork size={APP_ICON_SIZE} />
            创建草稿 PR
          </span>
          <span className="shortcut">Ctrl+Enter</span>
        </Button>
        <Button
          className="tw:w-full tw:justify-between"
          onClick={() => onCreatePR(title, body, pushFirst)}
        >
          <span className="review-popover-action-label">
            <GitFork size={APP_ICON_SIZE} />
            创建拉取请求
          </span>
        </Button>
        <Button
          className="tw:w-full tw:justify-between"
          onClick={() => onOpenPR()}
        >
          <span className="review-popover-action-label">
            <ExternalLink size={APP_ICON_SIZE} />
            在浏览器中打开 PR
          </span>
        </Button>
      </div>
    </div>
  )
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}
