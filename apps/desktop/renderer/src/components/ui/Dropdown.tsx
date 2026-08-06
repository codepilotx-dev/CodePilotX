import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './popoverSizing.js'

type Props = {
  children: React.ReactNode
  className?: string
  trigger: React.ReactElement
  align?: 'start' | 'center' | 'end'
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
  avoidCollisions?: boolean
  textMode?: 'nowrap' | 'wrap'
  modal?: boolean
  onOpenChange?: (open: boolean) => void
} & PopoverSizingProps

export function Dropdown({
  children,
  className = '',
  trigger,
  align = 'start',
  open,
  side = 'bottom',
  sideOffset = 4,
  collisionPadding = 6,
  avoidCollisions = true,
  textMode = 'nowrap',
  modal = false,
  width,
  maxWidth,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <DropdownMenu.Root modal={modal} open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          className={[
            'popover-surface',
            'popover',
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
