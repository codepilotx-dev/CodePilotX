import type React from 'react'
import { Dropdown } from './Dropdown.js'
import type { PopoverSizingProps } from './popoverSizing.js'

type Props = {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
  avoidCollisions?: boolean
  trigger: React.ReactNode
  disableOutsideDismiss?: boolean
  textMode?: 'nowrap' | 'wrap'
  onOpenChange: (open: boolean) => void
} & PopoverSizingProps

export function PopoverMenu({
  children,
  align,
  className = '',
  open,
  side,
  sideOffset,
  collisionPadding,
  avoidCollisions,
  trigger,
  disableOutsideDismiss,
  textMode = 'nowrap',
  width,
  maxWidth,
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
      className={className}
      disableOutsideDismiss={disableOutsideDismiss}
      open={open}
      side={dropdownSide}
      sideOffset={dropdownSideOffset}
      collisionPadding={collisionPadding}
      avoidCollisions={avoidCollisions}
      textMode={textMode}
      trigger={trigger}
      width={width}
      maxWidth={maxWidth}
      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
