import { useRef, useState } from 'react'
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
  const [metaPosition, setMetaPosition] = useState<'left' | 'right'>('right')
  const metaRef = useRef<HTMLSpanElement | null>(null)

  const handleMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (metaRef.current) {
      const itemRect = event.currentTarget.getBoundingClientRect()
      const metaRect = metaRef.current.getBoundingClientRect()
      if (itemRect) {
        const gap = 10
        const canShowRight =
          itemRect.right + gap + metaRect.width < window.innerWidth
        setMetaPosition(canShowRight ? 'right' : 'left')
      }
    }
    onMouseEnter?.()
  }

  const handleMouseLeave = () => {
    onMouseLeave?.()
  }

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
      onMouseEnter={meta ? handleMouseEnter : onMouseEnter}
      onMouseLeave={meta ? handleMouseLeave : onMouseLeave}
      role="menuitem"
      type="button"
    >
      {icon ? <span className="popover-item-icon">{icon}</span> : null}
      {meta ? (
        <span className="popover-item-rich">
          <span className="popover-item-label">{children}</span>
          <span
            ref={metaRef}
            className={[
              'popover-item-meta',
              `popover-item-meta-${metaPosition}`,
            ].join(' ')}
          >
            {meta}
          </span>
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
