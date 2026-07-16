import type React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'

type Props = {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  delay?: number
  delayDuration?: number
  className?: string
  sideOffset?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function TooltipProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return <RadixTooltip.Provider>{children}</RadixTooltip.Provider>
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  delay,
  delayDuration,
  className = '',
  sideOffset = 6,
  open,
  defaultOpen,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <RadixTooltip.Root
      open={open}
      defaultOpen={defaultOpen}
      delayDuration={delayDuration ?? delay}
      onOpenChange={onOpenChange}
    >
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          align={align}
          className={['tooltip-content', className].filter(Boolean).join(' ')}
          side={side}
          sideOffset={sideOffset}
        >
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
