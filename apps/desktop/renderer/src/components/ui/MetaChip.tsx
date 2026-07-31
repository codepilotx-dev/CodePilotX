import { forwardRef } from 'react'
import type React from 'react'
import { ChevronDown } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  label: string
  active?: boolean
  title: string
}

export const MetaChip = forwardRef<HTMLButtonElement, Props>(
  function MetaChip(
    { icon, label, active, title, type = 'button', ...buttonProps },
    ref,
  ): React.ReactNode {
    return (
      <button
        {...buttonProps}
        ref={ref}
        aria-expanded={active}
        className="interactive-row interactive-row--composer meta-chip"
        title={title}
        type={type}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </button>
    )
  },
)
