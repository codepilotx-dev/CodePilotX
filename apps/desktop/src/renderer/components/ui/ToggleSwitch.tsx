import React from 'react'
import * as Switch from '@radix-ui/react-switch'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
}

export function ToggleSwitch({ checked, onChange, ariaLabel }: Props) {
  return (
    <Switch.Root
      aria-label={ariaLabel}
      className={`toggle-switch ${checked ? 'on' : ''}`}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Switch.Thumb className="toggle-knob" />
    </Switch.Root>
  )
}
