import React from 'react'
import { useLocale } from '../i18n/LocaleProvider.js'
import { cx } from '../../utils/cx.js'

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
    <div
      className={cx(
        'settings-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:bg-transparent',
        size === 'compact' ? 'tw:py-2' : 'tw:py-3',
      )}
      data-size={size}
      id={id}
    >
      <div className="settings-row-info tw:min-w-0">
        <h4 className="settings-row-title tw:m-0 tw:text-app-text tw:type-row-title">{t(title)}</h4>
        {description ? (
          <p className="settings-row-desc tw:mt-1 tw:mr-0 tw:mb-0 tw:ml-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            {typeof description === 'string' ? t(description) : description}
          </p>
        ) : null}
      </div>
      {control && (
        <div className="settings-row-control tw:relative tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:justify-end tw:gap-2">
          {control}
        </div>
      )}
    </div>
  )
}
