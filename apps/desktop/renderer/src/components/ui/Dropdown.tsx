import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useFloatingFocusModality } from '../../utils/floatingFocus.js'
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
  const focusModality = useFloatingFocusModality()
  return (
    <DropdownMenu.Root modal={modal} open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild {...focusModality.triggerInteractionProps}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-theme-component="dropdown-surface"
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
          onCloseAutoFocus={focusModality.suppressFocusRingOnClose}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ width, maxWidth })}
        >
          <div className="popover-scroll-content tw:flex tw:min-w-0 tw:max-w-full tw:flex-col tw:gap-0.5 tw:p-1 tw:overflow-x-hidden tw:overflow-y-auto">
            {children}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
