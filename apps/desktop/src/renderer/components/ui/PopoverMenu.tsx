import type React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

type Props = {
  children: React.ReactNode
  className?: string
  open: boolean
  trigger: React.ReactNode
  autoWidth?: boolean
  textMode?: 'nowrap' | 'wrap'
  onOpenChange: (open: boolean) => void
}

export function PopoverMenu({
  children,
  className = '',
  open,
  trigger,
  autoWidth = false,
  textMode = 'nowrap',
  onOpenChange,
}: Props): React.ReactNode {
  const side = className.includes('popover-menu-') ? 'bottom' : 'top'
  const align =
    className.includes('popover-model') || className.includes('popover-branch')
      ? 'end'
      : 'start'

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
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
          sideOffset={className.includes('popover-menu-') ? 4 : 6}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
