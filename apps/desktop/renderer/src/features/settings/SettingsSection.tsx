import React from 'react'

type Props = {
  title?: string
  description?: React.ReactNode
  actions?: React.ReactNode
  bare?: boolean
  children: React.ReactNode
}

type HeaderProps = {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}

type SlotProps = {
  children: React.ReactNode
}

export function SettingsSectionHeader({
  title,
  description,
  actions,
  children,
}: HeaderProps): React.ReactNode {
  if (!title && !description && !actions && !children) return null
  return (
    <header className="settings-section-header">
      <div className="settings-section-header-copy">
        {title ? <h3 className="settings-section-title">{title}</h3> : null}
        {description ? (
          <p className="settings-section-desc">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="settings-section-header-actions">{actions}</div>
      ) : null}
    </header>
  )
}

export function SettingsSectionContent({
  children,
}: SlotProps): React.ReactNode {
  return <div className="settings-section-content settings-card">{children}</div>
}

export function SettingsSectionFooter({ children }: SlotProps): React.ReactNode {
  return <footer className="settings-section-footer">{children}</footer>
}

function SettingsSectionRoot({
  title,
  description,
  actions,
  bare,
  children,
}: Props): React.ReactNode {
  const hasHeader = Boolean(title || description || actions)
  const usesSlots = React.Children.toArray(children).some(child => {
    if (!React.isValidElement(child)) return false
    return (
      child.type === SettingsSectionHeader ||
      child.type === SettingsSectionContent ||
      child.type === SettingsSectionFooter
    )
  })

  return (
    <section className="settings-section">
      {hasHeader ? (
        <SettingsSectionHeader
          actions={actions}
          description={description}
          title={title}
        />
      ) : null}
      {usesSlots || bare ? children : (
        <SettingsSectionContent>{children}</SettingsSectionContent>
      )}
    </section>
  )
}

type SettingsSectionComponent = typeof SettingsSectionRoot & {
  Header: typeof SettingsSectionHeader
  Content: typeof SettingsSectionContent
  Footer: typeof SettingsSectionFooter
}

export const SettingsSection = Object.assign(SettingsSectionRoot, {
  Header: SettingsSectionHeader,
  Content: SettingsSectionContent,
  Footer: SettingsSectionFooter,
}) as SettingsSectionComponent
