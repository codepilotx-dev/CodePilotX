import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'icon'
export type ButtonTone = 'default' | 'danger'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  size?: ButtonSize
  tone?: ButtonTone
  variant?: ButtonVariant
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'u-type-caption',
  md: 'u-type-control',
  icon: 'u-type-control',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    children,
    className,
    disabled,
    loading = false,
    size = 'md',
    tone = 'default',
    type = 'button',
    variant = 'secondary',
    ...buttonProps
  },
  ref,
): React.ReactNode {
  return (
    <button
      {...buttonProps}
      ref={ref}
      aria-busy={loading || undefined}
      className={cx(
        'ui-button',
        'settings-button',
        'u-inline-flex',
        'u-items-center',
        'u-justify-center',
        'u-nowrap',
        SIZE_CLASSES[size],
        className,
      )}
      data-loading={loading || undefined}
      data-size={size}
      data-tone={tone}
      data-variant={variant}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ui-button-spinner" /> : null}
      {children}
    </button>
  )
})
