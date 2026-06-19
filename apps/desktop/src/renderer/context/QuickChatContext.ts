import type React from 'react'
import { createContext, useContext } from 'react'
import type { Message } from '../uiTypes.js'
import type {
  DesktopGitStatus,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../../shared/types.js'

export type QuickChatContextValue = {
  isConversationRoute: boolean
  isConversationLoading: boolean
  activeSessionId: string | null
  activeSessionPinnedAt: string | null
  sessionTitle: string | null
  workspaceName: string | null
  workspacePath: string | null
  branchName: string | null
  diff: string
  gitStatus: DesktopGitStatus | null
  onArchiveSession: () => void
  onCreateBranch: () => void
  onOpenAutomation: () => void
  onOpenWorkspacePath: () => void
  onRefreshDiff: () => void
  onToggleSessionPinned: () => void
  onCommitOrPush: () => void
  onCreatePullRequest: () => void
  events: DesktopSessionEvent[]
  messages: Message[]
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
