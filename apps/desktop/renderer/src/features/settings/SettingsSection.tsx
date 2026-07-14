import React from 'react'

type Props = {
  title?: string
  description?: React.ReactNode
  actions?: React.ReactNode
  bare?: boolean
  children: React.ReactNode
}

export function SettingsSection({ title, description, actions, bare, children }: Props) {
  const hasHeader = Boolean(title || description || actions)
  return (
    <section className="settings-section">
      {hasHeader && (
        <div className="settings-section-header">
          <div className="settings-section-header-copy">
            {title && <h3 className="settings-section-title">{title}</h3>}
            {description && <p className="settings-section-desc">{description}</p>}
          </div>
          {actions ? (
            <div className="settings-section-header-actions">{actions}</div>
          ) : null}
        </div>
      )}
      {bare ? children : <div className="settings-card">{children}</div>}
    </section>
  )
}
