import React from 'react'
import { useLocale } from '../i18n/LocaleProvider.js'

type Props = {
  title: string
  description?: React.ReactNode
  control?: React.ReactNode
  autoSave?: boolean
  id?: string
  size?: 'default' | 'compact'
}

export function SettingsRow({ title, description, control, id, size = 'default' }: Props) {
  const { t } = useLocale()
  return (
    <div className="settings-row" data-size={size} id={id}>
      <div className="settings-row-info">
        <h4 className="settings-row-title">{t(title)}</h4>
        {description ? (
          <p className="settings-row-desc">
            {typeof description === 'string' ? t(description) : description}
          </p>
        ) : null}
      </div>
      {control && <div className="settings-row-control">{control}</div>}
    </div>
  )
}
