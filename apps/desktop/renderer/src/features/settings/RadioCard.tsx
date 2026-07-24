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
      className="radio-card tw:grid tw:w-full tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-start tw:gap-3 tw:rounded-lg tw:border tw:border-app-border tw:bg-app-panel tw:p-3 tw:text-left tw:text-app-text tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-raised tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent tw:data-[state=checked]:border-app-accent tw:data-[state=checked]:bg-app-raised"
      onClick={onClick}
      value={value}
    >
      <div className="radio-card-icon tw:flex tw:size-8 tw:items-center tw:justify-center tw:rounded-md tw:bg-app-chrome tw:text-app-text-soft">{icon}</div>
      <div className="radio-card-body tw:min-w-0">
        <h4 className="radio-card-title tw:m-0 tw:text-base tw:font-[var(--font-weight-label)] tw:text-app-text">{title}</h4>
        <p className="radio-card-desc tw:mt-1 tw:mb-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">{description}</p>
      </div>
      <div className="radio-indicator tw:mt-1 tw:flex tw:size-4 tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border tw:bg-app-canvas">
        <RadioGroup.Indicator className="radio-indicator-inner tw:size-2 tw:rounded-full tw:bg-app-accent" />
      </div>
    </RadioGroup.Item>
  )
}
