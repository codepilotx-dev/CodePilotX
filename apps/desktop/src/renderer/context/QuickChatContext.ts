import type React from 'react'
import { createContext, useContext } from 'react'
import type { Message, SessionListItem } from '../uiTypes.js'
import type { DesktopSessionStatus } from '../../../shared/types.js'

export type QuickChatContextValue = {
  workspaceName: string | null
  messages: Message[]
  errorMessage: string | null
  onDismissError: () => void
  sessionStatus: DesktopSessionStatus
  composer: React.ReactNode
}

export const QuickChatContext = createContext<QuickChatContextValue | null>(null)

export function useQuickChatContext(): QuickChatContextValue {
  const context = useContext(QuickChatContext)
  if (!context) {
    throw new Error('useQuickChatContext must be used within QuickChatContext.Provider')
  }
  return context
}
