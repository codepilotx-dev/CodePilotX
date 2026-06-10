import React from 'react'
import { ChevronDown } from 'lucide-react'

type Option = {
  value: string
  label: string
  icon?: React.ReactNode
}

type Props = {
  value: string
  options: Option[]
  onChange: (value: string) => void
  ariaLabel?: string
}

export function SettingsDropdown({ value, options, onChange, ariaLabel }: Props) {
  const selectedOption = options.find(o => o.value === value) || options[0]

  return (
    <div className="settings-dropdown-wrap">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="settings-dropdown-native"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="settings-dropdown">
        <div className="settings-dropdown-value">
          {selectedOption?.icon}
          <span>{selectedOption?.label}</span>
        </div>
        <ChevronDown className="settings-dropdown-icon" />
      </div>
    </div>
  )
}
