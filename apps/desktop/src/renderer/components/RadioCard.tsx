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
    <div className={`radio-card ${checked ? 'active' : ''}`} onClick={onClick}>
      <div className="radio-card-header">
        <div className="radio-card-icon">{icon}</div>
        <div className="radio-indicator">
          <div className="radio-indicator-inner" />
        </div>
      </div>
      <h4 className="radio-card-title">{title}</h4>
      <p className="radio-card-desc">{description}</p>
    </div>
  )
}
