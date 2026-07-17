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
    <section className="settings-section tw:mb-6">
      {hasHeader && (
        <div className="settings-section-header tw:mb-3 tw:flex tw:items-start tw:justify-between tw:gap-4">
          <div className="settings-section-header-copy tw:min-w-0 tw:flex-1">
            {title && <h3 className="settings-section-title tw:m-0 tw:text-base tw:font-[var(--font-weight-label)] tw:text-app-text">{title}</h3>}
            {description && <p className="settings-section-desc tw:mt-1 tw:mb-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">{description}</p>}
          </div>
          {actions ? (
            <div className="settings-section-header-actions tw:flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-3">{actions}</div>
          ) : null}
        </div>
      )}
      {bare ? children : (
        <div className="settings-card tw:overflow-hidden tw:rounded-xl tw:border tw:border-app-border tw:bg-app-panel tw:shadow-sm tw:transition-colors tw:duration-[var(--motion-standard)]">
          {children}
        </div>
      )}
    </section>
  )
}
