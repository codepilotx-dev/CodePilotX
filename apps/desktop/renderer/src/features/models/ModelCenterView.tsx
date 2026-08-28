import type React from 'react'
import '../../styles/lazy/model-center.scss'

import { ModelCenterWorkbench } from './ModelCenterWorkbench.js'

export function ProviderSettings({
  onError,
  onNotice,
}: {
  onError: (message: string) => void
  onNotice: (message: string) => void
}): React.ReactNode {
  return (
    <div className="model-center-page">
      <ModelCenterWorkbench
        onError={onError}
        onNotice={onNotice}
      />
    </div>
  )
}
