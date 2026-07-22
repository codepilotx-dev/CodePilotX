import type React from 'react'
import { useState } from 'react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { ModelCenterWorkbench } from './ModelCenterWorkbench.js'

export function ModelCenterView(): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  return (
    <div className="model-center-page">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      <ModelCenterWorkbench onError={setErrorMessage} />
    </div>
  )
}
