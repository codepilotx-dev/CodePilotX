import React from 'react'

type Props = {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onClick: () => void
}

export function RadioCard({ icon, title, description, checked, onClick }: Props) {
  return (
    <div
      className={`radio-card ${checked ? 'active' : ''}`}
      onClick={onClick}
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="radio-card-icon">{icon}</div>
      <div className="radio-card-body">
        <h4 className="radio-card-title">{title}</h4>
        <p className="radio-card-desc">{description}</p>
      </div>
      <div className="radio-indicator">
        <div className="radio-indicator-inner" />
      </div>
    </div>
  )
}
