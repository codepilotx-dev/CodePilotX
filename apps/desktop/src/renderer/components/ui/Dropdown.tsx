import type React from 'react'
import { cloneElement, isValidElement } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

type Props = {
  children: React.ReactNode
  className?: string
  trigger: React.ReactNode
  align?: 'start' | 'center' | 'end'
  autoWidth?: boolean
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  textMode?: 'nowrap' | 'wrap'
  onOpenChange?: (open: boolean) => void
}

export function Dropdown({
  children,
  className = '',
  trigger,
  align = 'start',
  autoWidth = false,
  open,
  side = 'bottom',
  sideOffset = 6,
  textMode = 'nowrap',
  onOpenChange,
}: Props): React.ReactNode {
  const triggerElement = isValidElement<
    React.HTMLAttributes<HTMLElement>
  >(trigger)
    ? cloneElement(trigger, { tabIndex: -1 })
    : trigger

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{triggerElement}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          className={[
            'popover',
            className,
            autoWidth ? 'popover-auto-width' : '',
            textMode === 'wrap' ? 'popover-text-wrap' : '',
          ].join(' ')}
          side={side}
          sideOffset={sideOffset}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
