import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'

export type ButtonTone = 'default' | 'danger'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  tone?: ButtonTone
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    children,
    className,
    disabled,
    loading = false,
    tone = 'default',
    type = 'button',
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
        'u-inline-flex',
        'u-items-center',
        'u-justify-center',
        'u-nowrap',
        'u-type-control',
        className,
      )}
      data-loading={loading || undefined}
      data-tone={tone}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ui-button-spinner" /> : null}
      {children}
    </button>
  )
})
