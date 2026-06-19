import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopContextUsage,
  DesktopPermissionMode,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
} from '../../shared/types.js'
import {
  PERMISSION_MODE_OPTIONS,
  THINKING_MODE_OPTIONS,
} from '../features/settings/settingsStorage.js'
import type { ModelPreset } from '../modelPresets.js'
import type { Message } from '../uiTypes.js'
import { ComposerCard } from './ComposerCard.js'

type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

type Props = {
  input: string
  messages: Message[]
  isQuickChatPage: boolean
  routedSessionId: string | null
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  thinkingMode: DesktopThinkingMode
  selectedProviderID?: ModelProviderID
  selectedModelPreset: string
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  showContextUsage: boolean
  contextUsage: DesktopContextUsage | null
  modelPresets: ModelPreset[]
  providerOptions: ProviderModelOption[]
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  onChooseWorkspace: () => Promise<DesktopWorkspace | null>
  onInputChange: (value: string) => void
  onInterrupt: () => Promise<void>
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void
  onOpenWorkspace: (
    workspace: DesktopWorkspace,
  ) => Promise<DesktopWorkspace | null>
  onBranchSelect: (branch: string) => Promise<void>
  onPermissionChange: (value: DesktopPermissionMode) => void
  onThinkingChange: (value: DesktopThinkingMode) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
  ) => Promise<string | null>
  submitToSession: (targetSessionId: string, value: string) => Promise<void>
}

export function DesktopComposer({
  input,
  messages,
  isQuickChatPage,
  routedSessionId,
  sessionStatus,
  permissionMode,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  showThinkingOptions,
  deepSeekThinkingControls,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  recentWorkspaces,
  workspace,
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onProviderModelChange,
  onOpenWorkspace,
  onBranchSelect,
  onPermissionChange,
  onThinkingChange,
  createSessionForWorkspace,
  submitToSession,
}: Props): React.ReactNode {
  const navigate = useNavigate()
  const canSubmit =
    Boolean(input.trim()) &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'waiting' &&
    (isQuickChatPage || Boolean(routedSessionId))
  const branchName = getDesktopComposerBranchName(workspace)
  const hasConversationMessages = messages.some(
    message => message.role !== 'system',
  )

  function handleSubmit(): void {
    void (async () => {
      const submittedInput = input
      if (isQuickChatPage) {
        onInputChange('')
        const nextSessionId = workspace
          ? await createSessionForWorkspace(workspace)
          : await createSessionForWorkspace(null)
        if (!nextSessionId) return
        navigate(sessionPath(nextSessionId))
        await submitToSession(nextSessionId, submittedInput)
        return
      }
      if (routedSessionId) {
        await submitToSession(routedSessionId, submittedInput)
      }
    })()
  }

  return (
    <ComposerCard
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={permissionMode}
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID ?? 'anthropic'}
      selectedModelPreset={selectedModelPreset}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={modelPresets}
      providerOptions={providerOptions}
      permissionOptions={PERMISSION_MODE_OPTIONS}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      branches={workspace?.branches ?? []}
      recentWorkspaces={recentWorkspaces}
      workspace={workspace}
      placeholder={hasConversationMessages ? '要求后续变更' : '随心输入'}
      onChooseWorkspace={() => void onChooseWorkspace()}
      onInputChange={onInputChange}
      onInterrupt={() => void onInterrupt()}
      onProviderModelChange={onProviderModelChange}
      onOpenFiles={() => {}}
      onOpenWorkspace={workspaceItem => void onOpenWorkspace(workspaceItem)}
      onBranchSelect={branch => void onBranchSelect(branch)}
      onPermissionChange={onPermissionChange}
      onSubmit={handleSubmit}
      onThinkingChange={onThinkingChange}
    />
  )
}

export function getDesktopComposerBranchName(
  workspace: DesktopWorkspace | null,
): string {
  if (!workspace) return '无项目'
  if (workspace.isGitRepo === false) return '未检测到 Git 分支'
  return workspace.branchName ?? '未检测到 Git 分支'
}

function sessionPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`
}
