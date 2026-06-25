import type React from 'react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SettingsPage } from './SettingsPage.js'
import { GlobalErrorModal } from './GlobalErrorModal.js'

export function SettingsLayout(): React.ReactNode {
  const [searchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'general'
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)

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
