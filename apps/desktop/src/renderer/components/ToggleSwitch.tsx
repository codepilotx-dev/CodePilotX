import React from 'react'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
}

export function ToggleSwitch({ checked, onChange, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`toggle-switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <div className="toggle-knob" />
    </button>
  )
}
