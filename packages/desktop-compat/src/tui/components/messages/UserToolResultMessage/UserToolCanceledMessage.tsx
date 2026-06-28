import * as React from 'react'
import { InterruptedByUser } from '@codepilotx/tui/components/InterruptedByUser.js'
import { MessageResponse } from '@codepilotx/tui/components/MessageResponse.js'

export function UserToolCanceledMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <InterruptedByUser />
    </MessageResponse>
  )
}
