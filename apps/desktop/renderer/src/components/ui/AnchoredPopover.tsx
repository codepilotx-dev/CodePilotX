import type React from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { cx } from '../../utils/cx.js'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from './popoverSizing.js'

export type AnchoredPopoverProps = PopoverSizingProps & {
  align?: 'start' | 'center' | 'end'
  arrow?: boolean
  children: React.ReactNode
  className?: string
  collisionPadding?: number
  contentLabel?: string
  contentRole?: 'dialog'
  defaultOpen?: boolean
  modal?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactElement
}

export function AnchoredPopover({
  align = 'start',
  arrow = false,
  children,
  className,
  collisionPadding = 6,
  contentLabel,
  contentRole,
  defaultOpen,
  maxWidth,
  modal = false,
  onOpenChange,
  open,
  side = 'bottom',
  sideOffset = 4,
  trigger,
  width,
}: AnchoredPopoverProps): React.ReactNode {
  return (
    <RadixPopover.Root
      defaultOpen={defaultOpen}
      modal={modal}
      open={open}
      onOpenChange={onOpenChange}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={contentLabel}
          align={align}
          className={cx(
            'popover-surface',
            'popover',
            'tw:text-app-text',
            className,
          )}
          collisionPadding={collisionPadding}
          role={contentRole}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ maxWidth, width })}
        >
          {children}
          {arrow ? <RadixPopover.Arrow className="popover-arrow" /> : null}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
