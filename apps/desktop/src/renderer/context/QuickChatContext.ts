import type React from 'react'
import { createContext, useContext } from 'react'
import type { Message, ToolLogEntry } from '../uiTypes.js'
import type {
  DesktopSessionStatus,
  DesktopStreamState,
} from '../../shared/types.js'

export type QuickChatContextValue = {
  isConversationRoute: boolean
  isConversationLoading: boolean
  sessionTitle: string | null
  workspaceName: string | null
  messages: Message[]
  toolLog: ToolLogEntry[]
  streamState: DesktopStreamState
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
