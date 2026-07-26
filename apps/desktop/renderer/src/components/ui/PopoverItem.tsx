import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'
import { Tooltip } from './Tooltip.js'

type Props = {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  meta?: React.ReactNode
  selected?: boolean
  shortcut?: React.ReactNode
  withArrow?: boolean
  arrowDirection?: 'up' | 'down' | 'right'
  withCheck?: boolean
  keepOpen?: boolean
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
  arrowDirection = 'right',
  withCheck,
  keepOpen,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props): React.ReactNode {
  const hasRichContent = Boolean(meta) || Boolean(shortcut)
  const item = (
    <DropdownMenu.Item
      className={[
        'popover-item',
        'tw:flex',
        'tw:min-h-8',
        'tw:w-full',
        'tw:min-w-0',
        'tw:cursor-pointer',
        'tw:items-center',
        'tw:gap-2',
        'tw:rounded-md',
        'tw:px-2',
        'tw:py-1.5',
        'tw:text-left',
        'tw:text-app-text',
        'tw:outline-none',
        'tw:transition-colors',
        'tw:duration-[120ms]',
        'tw:hover:bg-app-panel',
        'tw:focus-visible:ring-2',
        'tw:focus-visible:ring-app-accent',
        'tw:data-[disabled]:cursor-default',
        'tw:data-[disabled]:opacity-50',
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
        if (keepOpen) {
          event.preventDefault()
        }
        onClick?.()
      }}
    >
      <span className="popover-item-leading">
        {icon ? <span className="popover-item-icon">{icon}</span> : null}
      </span>
      {hasRichContent ? (
        <span className="popover-item-rich">
          <span className="popover-item-label">{children}</span>
        </span>
      ) : (
        <span className="popover-item-label">{children}</span>
      )}
      <span className="popover-item-trailing">
        {shortcut ? (
          <span className="popover-item-shortcut">{shortcut}</span>
        ) : null}
        {selected && withCheck ? (
          <Check className="popover-item-check" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        ) : withArrow ? (
          arrowDirection === 'down' ? (
            <ChevronDown className="popover-item-arrow" size={APP_ICON_SIZE} />
          ) : arrowDirection === 'up' ? (
            <ChevronUp className="popover-item-arrow" size={APP_ICON_SIZE} />
          ) : (
            <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
          )
        ) : null}
      </span>
    </DropdownMenu.Item>
  )

  if (!meta) {
    return item
  }

  return (
    <Tooltip
      align="center"
      className="popover-item-tooltip"
      content={meta}
      delayDuration={350}
      side="right"
      sideOffset={10}
    >
      {item}
    </Tooltip>
  )
}
