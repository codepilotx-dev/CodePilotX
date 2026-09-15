import React from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function useQuestionSkipCapability(requestId: string, enabled: boolean): boolean {
  const [available, setAvailable] = React.useState(false)
  React.useEffect(() => {
    let active = true
    setAvailable(false)
    if (enabled) void desktopClient.getRuntimeCapabilities().then(capabilities => {
      if (active) setAvailable(capabilities.includes('interaction.questionSkip.v1'))
    }).catch(() => { if (active) setAvailable(false) })
    return () => { active = false }
  }, [requestId, enabled])
  return available
}
