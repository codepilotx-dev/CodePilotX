import type React from 'react'
import { Check, ChevronRight } from 'lucide-react'

type Props = {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  meta?: React.ReactNode
  selected?: boolean
  withArrow?: boolean
  withCheck?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function PopoverItem({
  children,
  active,
  disabled,
  icon,
  meta,
  selected,
  withArrow,
  withCheck,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props): React.ReactNode {
  return (
    <button
      className={[
        'popover-item',
        meta ? 'rich' : '',
        active ? 'active' : '',
        selected ? 'selected' : '',
      ].join(' ')}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="menuitem"
      type="button"
    >
      {icon ? <span className="popover-item-icon">{icon}</span> : null}
      {meta ? (
        <span className="popover-item-rich">
          <span className="popover-item-label">{children}</span>
          <span className="popover-item-meta">{meta}</span>
        </span>
      ) : (
        <span className="popover-item-label">{children}</span>
      )}
      {selected && withCheck ? (
        <Check className="popover-item-check" size={14} strokeWidth={2.5} />
      ) : withArrow ? (
        <ChevronRight className="popover-item-arrow" size={12} />
      ) : null}
    </button>
  )
}
