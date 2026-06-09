import React from 'react'
import { ChevronDown } from 'lucide-react'

type Option = {
  value: string
  label: string
  icon?: React.ReactNode
}

type Props = {
  label?: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function SettingsDropdown({ label, value, options, onChange }: Props) {
  const selectedOption = options.find(o => o.value === value) || options[0]

  return (
    <div className="settings-dropdown-container">
      {label && <label className="settings-dropdown-label">{label}</label>}
      {/* For simplicity using a styled div that looks like a dropdown button. 
          A real select is hidden or just simple list.
          Since we have a specific screenshot style, let's use a native select overlaid, or just an element */}
      <div style={{ position: 'relative' }}>
        <select 
          value={value} 
          onChange={e => onChange(e.target.value)}
          style={{
            position: 'absolute',
            opacity: 0,
            width: '100%',
            height: '100%',
            cursor: 'pointer'
          }}
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
    </div>
  )
}
