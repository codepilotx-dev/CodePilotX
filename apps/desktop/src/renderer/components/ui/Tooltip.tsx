import * as RadixTooltip from '@radix-ui/react-tooltip'
import type React from 'react'

type Props = {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  delay?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function TooltipProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={120}>
      {children}
    </RadixTooltip.Provider>
  )
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  delay,
  open,
  defaultOpen,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <RadixTooltip.Root
      defaultOpen={defaultOpen}
      delayDuration={delay}
      onOpenChange={onOpenChange}
      open={open}
    >
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          align={align}
          className="tooltip-content"
          side={side}
          sideOffset={6}
        >
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
