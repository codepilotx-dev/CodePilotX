import type React from 'react'
import { ChevronDown } from 'lucide-react'

type Props = {
  children: React.ReactNode
  active?: boolean
  className?: string
  showChevron?: boolean
  showDot?: boolean
  title: string
  onClick?: () => void
}

export function ChipButton({
  children,
  active,
  className = '',
  showChevron = true,
  showDot,
  title,
  onClick,
}: Props): React.ReactNode {
  return (
    <button
      aria-expanded={active}
      className={[
        'chip-button',
        active ? 'active' : '',
        className,
      ].join(' ')}
      onClick={onClick}
      title={title}
      type="button"
    >
      {showDot ? <span className="chip-dot" /> : null}
      {children}
      {showChevron ? <ChevronDown size={12} strokeWidth={2.4} /> : null}
    </button>
  )
}
