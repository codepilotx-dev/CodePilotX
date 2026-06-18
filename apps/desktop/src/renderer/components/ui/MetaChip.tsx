import { forwardRef } from 'react'
import type React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { ChevronDown } from 'lucide-react'

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
        className={active ? 'meta-chip active' : 'meta-chip'}
        title={title}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} strokeWidth={2.4} />
      </Comp>
    )
  },
)
