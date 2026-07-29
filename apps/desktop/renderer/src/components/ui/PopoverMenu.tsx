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
  textMode?: 'nowrap' | 'wrap'
  triggerTabIndex?: number
  onOpenChange: (open: boolean) => void
} & PopoverSizingProps

export function PopoverMenu({
  children,
  align = 'start',
  className = '',
  open,
  side,
  sideOffset = 6,
  collisionPadding,
  avoidCollisions,
  trigger,
  textMode = 'nowrap',
  triggerTabIndex = -1,
  width,
  maxWidth,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <Dropdown
      align={align}
      className={className}
      open={open}
      side={side ?? 'bottom'}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      avoidCollisions={avoidCollisions}
      textMode={textMode}
      trigger={trigger}
      triggerTabIndex={triggerTabIndex}
      width={width}
      maxWidth={maxWidth}
      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
