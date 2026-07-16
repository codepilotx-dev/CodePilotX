import React from 'react'
import * as RadioGroup from '@radix-ui/react-radio-group'

type Props = {
  value: string
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onClick?: () => void
}

export function RadioCard({
  value,
  icon,
  title,
  description,
  checked,
  onClick,
}: Props) {
  return (
    <RadioGroup.Item
      className="radio-card"
      onClick={onClick}
      value={value}
    >
      <div className="radio-card-icon">{icon}</div>
      <div className="radio-card-body">
        <h4 className="radio-card-title">{title}</h4>
        <p className="radio-card-desc">{description}</p>
      </div>
      <div className="radio-indicator">
        <RadioGroup.Indicator className="radio-indicator-inner" />
      </div>
    </RadioGroup.Item>
  )
}
