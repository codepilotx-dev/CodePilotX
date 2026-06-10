import type React from 'react'
import { ChevronDown } from 'lucide-react'

type Props = {
  icon: React.ReactNode
  label: string
  active?: boolean
  title: string
  onClick?: () => void
}

export function MetaChip({
  icon,
  label,
  active,
  title,
  onClick,
}: Props): React.ReactNode {
  return (
    <button
      aria-expanded={active}
      className={active ? 'meta-chip active' : 'meta-chip'}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon}
      <span>{label}</span>
      <ChevronDown size={12} strokeWidth={2.4} />
    </button>
  )
}
