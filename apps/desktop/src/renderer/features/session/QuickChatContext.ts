import type React from 'react'
import { createContext, useContext } from 'react'
import type { Message } from '../../uiTypes.js'
import type { ModelPreset } from '../../modelPresets.js'
import type {
  DesktopGitStatus,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
  DesktopWorkspace,
} from '../../../shared/types.js'
import type { RightDockToolId } from '../layout/rightDockState.js'
import type { RightDockPlan } from '../layout/rightDockTools.js'

export type ProviderModelOption = {
  providerID: string
  displayName: string
  modelPresets: ModelPreset[]
  baseURL: string | undefined
}

export type QuickChatContextValue = {
  isConversationRoute: boolean
  isConversationLoading: boolean
  sidebarCollapsed: boolean
  activeSessionId: string | null
  activeSessionPinnedAt: string | null
  sessionTitle: string | null
  persistenceStatus?: 'saved' | 'unsaved'
  workspaceName: string | null
  workspacePath: string | null
  branchName: string | null
  branches: string[]
  diff: string
  gitStatus: DesktopGitStatus | null
  recentWorkspaces: DesktopWorkspace[]
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  providerModelOptions: ProviderModelOption[]
  onArchiveSession: () => void
  onCreateBranch: () => void
  onOpenAutomation: () => void
  onOpenWorkspacePath: () => void
  onOpenRightDock: (tool: RightDockToolId) => void
  onOpenPlanInRightDock: (plan: RightDockPlan) => void
  onSubmitEditedUserMessage: (text: string) => Promise<void>
  onAppendComposerText: (text: string) => void
  onAppendSideChatText: (text: string) => void
  onAddComposerFiles: (filePaths: string[]) => void
  onRefreshDiff: () => void
  onToggleSidebar: () => void
  onToggleSessionPinned: () => void
  onCommitOrPush: () => void
  onCreatePullRequest: () => void
  onChooseWorkspace: () => Promise<DesktopWorkspace | null>
  onCloneGithub: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => Promise<DesktopWorkspace | null>
  onBranchSelect: (branch: string) => Promise<void>
  onClearWorkspace: () => void
  onDecidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<
      DesktopPermissionDecision,
      'rememberOptionId' | 'planExecutionModel' | 'planExecutionProviderID' | 'planExecutionProviderBaseURL' | 'savePlanExecutionModel'
    >,
  ) => void
  onAcceptExitPlanMode: (
    request: DesktopPermissionRequest,
    options?: {
      note?: string
      planExecutionModel?: string
      planExecutionProviderID?: string
      planExecutionProviderBaseURL?: string
      savePlanExecutionModel?: boolean
    },
  ) => void
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  messages: Message[]
  pendingPermissions: DesktopPermissionRequest[]
  sessionStatus: DesktopSessionStatus
  composer: React.ReactNode
  bottomPanelVisible: boolean
  onToggleBottomPanel: () => void
  rightDockOpen: boolean
  rightDockTool: RightDockToolId | null
  rightDockPlanContent: string | null
  rightDockNode: React.ReactNode | null
  rightDockWidth: number
  debugMode: boolean
}

export const QuickChatContext = createContext<QuickChatContextValue | null>(null)

export function useQuickChatContext(): QuickChatContextValue {
  const context = useContext(QuickChatContext)
  if (!context) {
    throw new Error('useQuickChatContext must be used within QuickChatContext.Provider')
  }
  return context
}
