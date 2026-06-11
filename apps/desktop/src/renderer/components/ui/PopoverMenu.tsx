import type React from 'react'
import { Dropdown } from './Dropdown.js'

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
    <Dropdown
      align={align}
      autoWidth={autoWidth}
      className={className}
      open={open}
      side={side}
      sideOffset={className.includes('popover-menu-') ? 4 : 6}
      textMode={textMode}
      trigger={trigger}
      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
