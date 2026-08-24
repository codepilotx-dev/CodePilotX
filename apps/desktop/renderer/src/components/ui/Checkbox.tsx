import React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cx } from '../../utils/cx.js'

export type CheckboxProps = {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean | 'indeterminate') => void
  children?: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  required?: boolean
}

export function Checkbox({
  checked,
  onCheckedChange,
  children,
  ariaLabel,
  disabled = false,
  className,
  ...rootProps
}: CheckboxProps): React.ReactNode {
  const control = (
    <CheckboxPrimitive.Root
      {...rootProps}
      aria-label={ariaLabel}
      checked={checked}
      className="ui-checkbox-control"
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
        {checked === 'indeterminate'
          ? <Minus aria-hidden="true" />
          : <Check aria-hidden="true" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  return children ? (
    <label className={cx('ui-checkbox', className)} data-disabled={disabled || undefined}>
      {control}
      <span className="ui-checkbox-label">{children}</span>
    </label>
  ) : React.cloneElement(control, { className: cx('ui-checkbox-control', className) })
}
