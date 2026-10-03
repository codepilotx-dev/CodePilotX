import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/cx.js'
import type { InputSize } from './Input.js'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean
  size?: InputSize
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'u-type-secondary',
  md: 'u-type-control',
  compact: '',
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, readOnly = false, size = 'md', ...textareaProps },
  ref,
): React.ReactNode {
  return (
    <textarea
      {...textareaProps}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('ui-textarea', SIZE_CLASSES[size], className)}
      data-size={size}
      readOnly={readOnly}
    />
  )
})
