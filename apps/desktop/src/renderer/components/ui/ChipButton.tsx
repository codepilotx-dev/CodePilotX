import { forwardRef } from 'react'
import type React from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { ChevronDown } from 'lucide-react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode
  active?: boolean
  asChild?: boolean
  className?: string
  showChevron?: boolean
  showDot?: boolean
  title: string
}

export const ChipButton = forwardRef<HTMLButtonElement, Props>(
  function ChipButton(
    {
      children,
      active,
      asChild,
      className = '',
      showChevron = true,
      showDot,
      title,
      type = 'button',
      ...buttonProps
    },
    ref,
  ): React.ReactNode {
    const Comp = asChild ? Slot : 'button'
    const typedProps = asChild ? buttonProps : { ...buttonProps, type }

    return (
      <Comp
        {...typedProps}
        ref={ref}
        aria-expanded={active}
        className={[
          'chip-button',
          active ? 'active' : '',
          className,
        ].join(' ')}
        title={title}
      >
        {showDot ? <span className="chip-dot" /> : null}
        <Slottable>{children}</Slottable>
        {showChevron ? <ChevronDown size={12} strokeWidth={2.4} /> : null}
      </Comp>
    )
  },
)
