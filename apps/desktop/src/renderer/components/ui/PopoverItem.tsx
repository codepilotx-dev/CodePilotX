import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronRight } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'

type Props = {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  meta?: React.ReactNode
  selected?: boolean
  shortcut?: React.ReactNode
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
  shortcut,
  withArrow,
  withCheck,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props): React.ReactNode {
  const hasRichContent = Boolean(meta) || Boolean(shortcut)
  const item = (
    <DropdownMenu.Item
      className={[
        'popover-item',
        hasRichContent ? 'rich' : '',
        active ? 'active' : '',
        selected ? 'selected' : '',
      ].join(' ')}
      disabled={disabled}
      tabIndex={-1}
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
      {hasRichContent ? (
        <span className="popover-item-rich">
          <span className="popover-item-label">{children}</span>
        </span>
      ) : (
        <span className="popover-item-label">{children}</span>
      )}
      {shortcut ? (
        <span className="popover-item-shortcut">{shortcut}</span>
      ) : null}
      {selected && withCheck ? (
        <Check className="popover-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      ) : withArrow ? (
        <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
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
