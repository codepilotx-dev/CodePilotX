import { createContext, useContext } from 'react'
import type { ModelPreset } from '../../modelPresets.js'
import type {
  DesktopGitStatus,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import type { OpenPlanInDockRequest } from './workflow/WorkflowPlanCard.js'
import type {
  MarkdownFileOpenOptions,
  MarkdownFileReference,
} from '../markdown/index.js'
import type { DesktopComposerProps } from './composer/DesktopComposer.js'
import type { NewSessionRecentTask } from './newSessionSuggestions.js'

export type ProviderModelOption = {
  providerID: string
  displayName: string
  modelPresets: ModelPreset[]
  baseURL: string | undefined
}

export type QuickChatComposerDraftBridge = {
  value: string
  replace: (value: string) => void
  focus?: () => void
}

export type QuickChatContextValue = {
  isConversationRoute: boolean
  isConversationLoading: boolean
  sidebarCollapsed: boolean
  activeSessionId: string | null
  activeSessionPinnedAt: string | null
  sessionTitle: string | null
  editableSessionTitle: string | null
  workspaceName: string | null
  workspacePath: string | null
  branchName: string | null
  branches: string[]
  diff: string
  gitStatus: DesktopGitStatus | null
  recentWorkspaces: DesktopWorkspace[]
  recentTasks: NewSessionRecentTask[]
  titleRegenerating: boolean
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  providerModelOptions: ProviderModelOption[]
  onArchiveSession: () => void
  onCreateBranch: () => void
  onOpenAutomation: () => void
  onOpenWorkspacePath: () => void
  onOpenRightDock: (tool: 'review') => void
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenFileReference: (
    reference: MarkdownFileReference,
    options: MarkdownFileOpenOptions,
  ) => void
  canCopyFileReferenceContents: (
    reference: MarkdownFileReference,
  ) => boolean
  onCopyFileReferenceContents: (
    reference: MarkdownFileReference,
  ) => void | Promise<void>
  onSubmitEditedUserMessage: (text: string) => Promise<void>
  onAppendComposerText: (text: string) => void
  onAppendSideChatText: (text: string) => void
  onOpenSubagent: (taskId: string) => void
  onAddComposerFiles: (filePaths: string[]) => void
  onRefreshDiff: () => void
  onRenameSession: (title: string) => Promise<boolean>
  onRefreshSessionTitle: () => Promise<boolean>
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
      'rememberOptionId'
    >,
  ) => void
  sessionStatus: DesktopSessionStatus
  composerProps: DesktopComposerProps | null
  composerDraft?: QuickChatComposerDraftBridge
  bottomPanelVisible: boolean
  onToggleBottomPanel: () => void
  rightDockPlanEventId: string | null
}

export const QuickChatContext = createContext<QuickChatContextValue | null>(null)

export function useQuickChatContext(): QuickChatContextValue {
  const context = useContext(QuickChatContext)
  if (!context) {
    throw new Error('useQuickChatContext must be used within QuickChatContext.Provider')
  }
  return context
}
