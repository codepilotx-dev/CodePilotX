import type React from 'react'
import { useEffect, useState } from 'react'
import '../../styles/features/settings.scss'
import { useSearchParams } from 'react-router-dom'
import { SettingsPage } from './SettingsPage.js'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { useDesktopTheme } from '../theme/themeContext.js'
import {
  createSettingsSaveShortcutHandler,
  useDesktopSettings,
} from './useDesktopSettings.js'

export function SettingsLayout(): React.ReactNode {
  const [searchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'general'
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const settings = useDesktopSettings()
  const theme = useDesktopTheme()

  useEffect(() => {
    const saveSettings = async (): Promise<void> => {
      await Promise.all([
        settings.draft.dirty
          ? settings.draft.save()
          : Promise.resolve(settings.draft.values),
        theme.draft.dirty
          ? theme.draft.save()
          : Promise.resolve(theme.draft.settings),
      ])
      setNoticeMessage('设置已保存')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      void createSettingsSaveShortcutHandler(saveSettings)(event).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        setErrorMessage(message)
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settings.draft, theme.draft])

  return (
    <div className="settings-page">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <SettingsPage
        activeTab={activeTab}
        onError={setErrorMessage}
        onNotice={setNoticeMessage}
      />
    </div>
  )
}
