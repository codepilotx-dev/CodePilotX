import type React from 'react'
import { useState } from 'react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { ModelCenterWorkbench } from './ModelCenterWorkbench.js'

export function ModelCenterView(): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)

  return (
    <div className="model-center-page">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <ModelCenterWorkbench
        onError={setErrorMessage}
        onNotice={setNoticeMessage}
      />
    </div>
  )
}
