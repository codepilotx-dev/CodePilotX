import { forwardRef } from 'react'
import type React from 'react'

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  children: React.ReactNode
  title: string
  className?: string
  active?: boolean
  size?: 'sm' | 'md'
  variant?: 'default' | 'plain' | 'browser' | 'toolbar'
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    {
      children,
      title,
      active = false,
      className = '',
      size,
      type = 'button',
      variant = 'default',
      ...buttonProps
    },
    ref,
  ): React.ReactNode {
    return (
      <button
        {...buttonProps}
        ref={ref}
        aria-label={title}
        className={['icon-button', className].filter(Boolean).join(' ')}
        data-active={active || undefined}
        data-size={size}
        data-variant={variant}
        title={title}
        type={type}
      >
        {children}
      </button>
    )
  },
)
