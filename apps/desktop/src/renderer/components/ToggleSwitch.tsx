import React from 'react'

type Props = {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function ToggleSwitch({ title, description, checked, onChange }: Props) {
  return (
    <div className="settings-toggle-item">
      <div className="settings-toggle-info">
        <h4 className="settings-toggle-title">{title}</h4>
        <p className="settings-toggle-desc">{description}</p>
      </div>
      <button 
        type="button"
        className={`toggle-switch ${checked ? 'on' : ''}`} 
        onClick={() => onChange(!checked)}
      >
        <div className="toggle-knob" />
      </button>
    </div>
  )
}
