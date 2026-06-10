import React from 'react'

type Props = {
  title?: string
  description?: React.ReactNode
  children: React.ReactNode
}

export function SettingsSection({ title, description, children }: Props) {
  return (
    <section className="settings-section">
      {(title || description) && (
        <div className="settings-section-header">
          {title && <h3 className="settings-section-title">{title}</h3>}
          {description && <p className="settings-section-desc">{description}</p>}
        </div>
      )}
      <div className="settings-card">{children}</div>
    </section>
  )
}
