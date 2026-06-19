import type React from 'react'
import { Dropdown } from './Dropdown.js'

type Props = {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
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
  sideOffset,
  trigger,
  autoWidth = false,
  textMode = 'nowrap',
  onOpenChange,
}: Props): React.ReactNode {
  const dropdownSide = side ?? 'bottom'
  const dropdownAlign = align ?? (
    className.includes('popover-model') || className.includes('popover-branch')
      ? 'end'
      : 'start'
  )
  const dropdownSideOffset =
    sideOffset ??
    (className.includes('popover-menu-') ? 4 : 6)

  return (
    <Dropdown
      align={dropdownAlign}
      autoWidth={autoWidth}
      className={className}
      open={open}
      side={dropdownSide}
      sideOffset={dropdownSideOffset}
      textMode={textMode}
      trigger={trigger}
      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
