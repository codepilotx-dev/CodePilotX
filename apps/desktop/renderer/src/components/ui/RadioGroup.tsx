import React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cx } from '../../utils/cx.js'

export type RadioGroupProps = {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
  className?: string
  name?: string
  orientation?: 'horizontal' | 'vertical'
}

export function RadioGroup({
  value,
  onValueChange,
  children,
  ariaLabel,
  disabled = false,
  className,
  orientation = 'vertical',
  name,
}: RadioGroupProps): React.ReactNode {
  return (
    <RadioGroupPrimitive.Root
      aria-label={ariaLabel}
      className={cx('ui-radio-group', className)}
      disabled={disabled}
      name={name}
      orientation={orientation}
      value={value}
      onValueChange={onValueChange}
    >
      {children}
    </RadioGroupPrimitive.Root>
  )
}

export type RadioItemProps = {
  value: string
  label?: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
  variant?: 'default' | 'card'
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function RadioItem({
  value,
  label,
  detail,
  icon,
  children,
  variant = 'default',
  disabled = false,
  className,
  ariaLabel,
}: RadioItemProps): React.ReactNode {
  return (
    <label className={cx('ui-radio-item', className)} data-disabled={disabled || undefined} data-variant={variant}>
      <RadioGroupPrimitive.Item
        aria-label={ariaLabel}
        className="ui-radio-control"
        disabled={disabled}
        value={value}
      >
        <RadioGroupPrimitive.Indicator className="ui-radio-indicator" />
      </RadioGroupPrimitive.Item>
      {icon ? <span aria-hidden="true" className="ui-radio-icon">{icon}</span> : null}
      <span className="ui-radio-copy">
        <span className="ui-radio-label">{label ?? children}</span>
        {detail ? <span className="ui-radio-detail">{detail}</span> : null}
      </span>
    </label>
  )
}
