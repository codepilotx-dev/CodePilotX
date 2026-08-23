import type React from 'react'
import { cx } from '../../utils/cx.js'

export type SpinnerProps = {
  className?: string
  label?: string
  size?: 'small' | 'medium' | 'large'
}

export function Spinner({
  className,
  label,
  size = 'small',
}: SpinnerProps): React.ReactNode {
  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className={cx('ui-spinner', className)}
      data-size={size}
      role={label ? 'status' : undefined}
    />
  )
}
