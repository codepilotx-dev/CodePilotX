import type React from 'react'
import { cloneElement, isValidElement } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { preventOutsideDismissWhenDebug } from './debugDropdown.js'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './popoverSizing.js'
import { readDesktopBrowserDebugMode } from '../../services/desktopClient.js'

type Props = {
  children: React.ReactNode
  className?: string
  trigger: React.ReactNode
  align?: 'start' | 'center' | 'end'
  disableOutsideDismiss?: boolean
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
  avoidCollisions?: boolean
  textMode?: 'nowrap' | 'wrap'
  onOpenChange?: (open: boolean) => void
} & PopoverSizingProps

export function Dropdown({
  children,
  className = '',
  trigger,
  align = 'start',
  disableOutsideDismiss = readDesktopBrowserDebugMode(),
  open,
  side = 'bottom',
  sideOffset = 6,
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
    ? cloneElement(trigger, { tabIndex: -1 })
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
            className,
            textMode === 'wrap' ? 'popover-text-wrap' : '',
          ].join(' ')}
          collisionPadding={collisionPadding}
          avoidCollisions={avoidCollisions}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width, maxWidth })}
          onPointerDownOutside={event => {
            preventOutsideDismissWhenDebug(disableOutsideDismiss, event)
          }}
        >
          <div className="popover-scroll-content">{children}</div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
