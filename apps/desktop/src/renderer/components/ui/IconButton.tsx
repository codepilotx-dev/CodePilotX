import { forwardRef } from 'react'
import type React from 'react'

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  children: React.ReactNode
  title: string
  className?: string
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    {
      children,
      title,
      className = 'icon-button',
      type = 'button',
      ...buttonProps
    },
    ref,
  ): React.ReactNode {
    return (
      <button
        {...buttonProps}
        ref={ref}
        aria-label={title}
        className={className}
        title={title}
        type={type}
      >
        {children}
      </button>
    )
  },
)
