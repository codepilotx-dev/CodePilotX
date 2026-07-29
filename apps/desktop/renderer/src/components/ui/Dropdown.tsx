import type React from 'react'
import { cloneElement, isValidElement } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './popoverSizing.js'

type Props = {
  children: React.ReactNode
  className?: string
  trigger: React.ReactNode
  align?: 'start' | 'center' | 'end'
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
  avoidCollisions?: boolean
  textMode?: 'nowrap' | 'wrap'
  triggerTabIndex?: number
  onOpenChange?: (open: boolean) => void
} & PopoverSizingProps

export function Dropdown({
  children,
  className = '',
  trigger,
  align = 'start',
  open,
  side = 'bottom',
  sideOffset = 6,
  triggerTabIndex = -1,
  collisionPadding,
  avoidCollisions = true,
  textMode = 'nowrap',
  width,
  maxWidth,
  onOpenChange,
}: Props): React.ReactNode {
  const triggerElement = isValidElement<
    React.HTMLAttributes<HTMLElement>
  >(trigger)
    ? cloneElement(trigger, { tabIndex: triggerTabIndex })
    : trigger

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        {triggerElement}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          className={[
            'popover-surface',
            'popover',
            'tw:rounded-lg',
            'tw:p-1',
            'tw:text-sm',
            'tw:text-app-text',
            className,
            textMode === 'wrap' ? 'popover-text-wrap' : '',
          ].join(' ')}
          collisionPadding={collisionPadding}
          avoidCollisions={avoidCollisions}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width, maxWidth })}
        >
          <div className="popover-scroll-content tw:min-w-0 tw:overflow-y-auto">
            {children}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
