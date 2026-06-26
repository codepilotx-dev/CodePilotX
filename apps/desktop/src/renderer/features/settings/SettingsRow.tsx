import React from 'react'

type Props = {
  title: string
  description?: React.ReactNode
  control?: React.ReactNode
}

export function SettingsRow({ title, description, control }: Props) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <h4 className="settings-row-title">{title}</h4>
        {description && <p className="settings-row-desc">{description}</p>}
      </div>
      {control && <div className="settings-row-control">{control}</div>}
    </div>
  )
}
