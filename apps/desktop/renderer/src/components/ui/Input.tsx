import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'

export type InputSize = 'sm' | 'md' | 'compact'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean
  size?: InputSize
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'u-type-secondary',
  md: 'u-type-control',
  compact: '',
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    className,
    invalid = false,
    readOnly = false,
    size = 'md',
    ...inputProps
  },
  ref,
): React.ReactNode {
  return (
    <input
      {...inputProps}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('ui-input', SIZE_CLASSES[size], className)}
      data-size={size}
      readOnly={readOnly}
    />
  )
})
