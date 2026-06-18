import type React from 'react'
import { Dropdown } from './Dropdown.js'

type Props = {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  trigger: React.ReactNode
  autoWidth?: boolean
  textMode?: 'nowrap' | 'wrap'
  onOpenChange: (open: boolean) => void
}

export function PopoverMenu({
  children,
  align,
  className = '',
  open,
  side,
  trigger,
  autoWidth = false,
  textMode = 'nowrap',
  onOpenChange,
}: Props): React.ReactNode {
  const dropdownSide =
    side ?? (className.includes('popover-menu-') ? 'bottom' : 'top')
  const dropdownAlign = align ?? (
    className.includes('popover-model') || className.includes('popover-branch')
      ? 'end'
      : 'start'
  )

  return (
    <Dropdown
      align={dropdownAlign}
      autoWidth={autoWidth}
      className={className}
      open={open}
      side={dropdownSide}
      sideOffset={className.includes('popover-menu-') ? 4 : 6}
      textMode={textMode}
      trigger={trigger}
      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
