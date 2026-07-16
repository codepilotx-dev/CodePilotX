import { forwardRef } from 'react'
import type React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { ChevronDown } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  label: string
  active?: boolean
  asChild?: boolean
  title: string
}

export const MetaChip = forwardRef<HTMLButtonElement, Props>(
  function MetaChip(
    { icon, label, active, asChild, title, type = 'button', ...buttonProps },
    ref,
  ): React.ReactNode {
    const Comp = asChild ? Slot : 'button'
    const typedProps = asChild ? buttonProps : { ...buttonProps, type }

    return (
      <Comp
        {...typedProps}
        ref={ref}
        aria-expanded={active}
        className="meta-chip"
        title={title}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Comp>
    )
  },
)
