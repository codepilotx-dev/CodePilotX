import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
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
  const item = (
    <DropdownMenu.Item
      className={[
        'popover-item',
        meta ? 'rich' : '',
        active ? 'active' : '',
        selected ? 'selected' : '',
      ].join(' ')}
      disabled={disabled}
      onPointerEnter={onMouseEnter}
      onPointerLeave={onMouseLeave}
      onSelect={event => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onClick?.()
      }}
    >
      {icon ? <span className="popover-item-icon">{icon}</span> : null}
      {meta ? (
        <span className="popover-item-rich">
          <span className="popover-item-label">{children}</span>
        </span>
      ) : (
        <span className="popover-item-label">{children}</span>
      )}
      {selected && withCheck ? (
        <Check className="popover-item-check" size={14} strokeWidth={2.5} />
      ) : withArrow ? (
        <ChevronRight className="popover-item-arrow" size={12} />
      ) : null}
    </DropdownMenu.Item>
  )

  if (!meta) {
    return item
  }

  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{item}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            align="center"
            className="popover-item-tooltip"
            side="right"
            sideOffset={10}
          >
            {meta}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
