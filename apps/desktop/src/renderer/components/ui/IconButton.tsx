import type React from 'react'

type Props = {
  children: React.ReactNode
  title: string
  className?: string
  disabled?: boolean
  onClick?: () => void
}

export function IconButton({
  children,
  title,
  className = 'icon-button',
  disabled,
  onClick,
}: Props): React.ReactNode {
  return (
    <button
      aria-label={title}
      className={className}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}
