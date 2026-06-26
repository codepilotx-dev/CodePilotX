import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopPermissionMode,
  DesktopSlashCommandSuggestion,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../shared/desktopUserMessage.js'
import { desktopClient } from '../../services/desktopClient.js'
import {
  PERMISSION_MODE_OPTIONS,
  THINKING_MODE_OPTIONS,
} from '../settings/settingsStorage.js'
import type { ModelPreset } from '../../modelPresets.js'
import type { Message } from '../../uiTypes.js'
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
  modelConfigured: boolean
  modelConfigurationMessage?: string
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
  onCloneGithub: () => void
  onClearWorkspace: () => void
  onOpenBrowser?: () => void
  onBranchSelect: (branch: string) => Promise<void>
  onCreateBranch: () => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onPlanModeToggle?: (
    enabled: boolean,
    previousMode: DesktopPermissionMode,
  ) => void
  onThinkingChange: (value: DesktopThinkingMode) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
  ) => Promise<void>
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
  modelConfigured,
  modelConfigurationMessage,
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
  onCloneGithub,
  onClearWorkspace,
  onOpenBrowser,
  onBranchSelect,
  onCreateBranch,
  onPermissionChange,
  onPlanModeToggle,
  onThinkingChange,
  createSessionForWorkspace,
  submitToSession,
}: Props): React.ReactNode {
  const navigate = useNavigate()
  const [attachments, setAttachments] = useState<DesktopComposerAttachment[]>([])
  const [slashCommands, setSlashCommands] = useState<
    DesktopSlashCommandSuggestion[]
  >([])
  const hasAttachmentErrors = hasBlockingComposerAttachmentErrors(attachments)
  const canSubmit =
    (Boolean(input.trim()) || attachments.length > 0) &&
    !hasAttachmentErrors &&
    modelConfigured &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'waiting' &&
    (isQuickChatPage || Boolean(routedSessionId))
  const attachmentIds = useMemo(
    () => new Set(attachments.map(attachment => attachment.id)),
    [attachments],
  )
  const branchName = getDesktopComposerBranchName(workspace)
  const hasConversationMessages = messages.some(
    message => message.role !== 'system',
  )
  useEffect(() => {
    let cancelled = false
    desktopClient
      .listSlashCommands(workspace?.path)
      .then(commands => {
        if (!cancelled) setSlashCommands(commands)
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [workspace?.path])

  useEffect(() => {
    if (!input.trimStart().startsWith('/')) return
    let cancelled = false
    desktopClient
      .listSlashCommands(workspace?.path)
      .then(commands => {
        if (!cancelled) setSlashCommands(commands)
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [input, workspace?.path])

  function handleSubmit(): void {
    void (async () => {
      if (!modelConfigured) return
      const submittedInput = input
      const submittedAttachments = attachments
      const messageInput = {
        text: submittedInput,
        attachments: submittedAttachments,
      }
      if (isQuickChatPage) {
        onInputChange('')
        setAttachments([])
        const nextSessionId = workspace
          ? await createSessionForWorkspace(workspace)
          : await createSessionForWorkspace(null)
        if (!nextSessionId) return
        navigate(sessionPath(nextSessionId))
        await submitToSession(nextSessionId, messageInput)
        return
      }
      if (routedSessionId) {
        setAttachments([])
        await submitToSession(routedSessionId, messageInput)
      }
    })()
  }

  async function handleOpenFiles(): Promise<void> {
    const selected = await desktopClient.chooseComposerFiles()
    appendAttachments(selected)
  }

  async function handleAddFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    const selected = await desktopClient.readComposerFiles(filePaths)
    appendAttachments(selected)
  }

  function appendAttachments(nextAttachments: DesktopComposerAttachment[]): void {
    if (nextAttachments.length === 0) return
    setAttachments(current => [
      ...current,
      ...nextAttachments.filter(attachment => !attachmentIds.has(attachment.id)),
    ])
  }

  function handleRemoveAttachment(attachmentId: string): void {
    setAttachments(current =>
      current.filter(attachment => attachment.id !== attachmentId),
    )
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
      modelConfigured={modelConfigured}
      modelConfigurationMessage={modelConfigurationMessage}
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
      attachments={attachments}
      slashCommands={slashCommands}
      placeholder={
        modelConfigured
          ? hasConversationMessages
            ? '要求后续变更'
            : '随心输入'
          : '未配置模型，请先在设置中配置模型'
      }
      onChooseWorkspace={() => void onChooseWorkspace()}
      onInputChange={onInputChange}
      onInterrupt={() => void onInterrupt()}
      onProviderModelChange={onProviderModelChange}
      onAddFiles={filePaths => void handleAddFilePaths(filePaths)}
      onOpenFiles={() => void handleOpenFiles()}
      onRemoveAttachment={handleRemoveAttachment}
      onOpenWorkspace={workspaceItem => void onOpenWorkspace(workspaceItem)}
      onCloneGithub={onCloneGithub}
      onClearWorkspace={onClearWorkspace}
      onOpenBrowser={onOpenBrowser}
      onBranchSelect={branch => void onBranchSelect(branch)}
      onCreateBranch={onCreateBranch}
      onPermissionChange={onPermissionChange}
      onPlanModeToggle={onPlanModeToggle}
      onSubmit={handleSubmit}
      onThinkingChange={onThinkingChange}
      contextDropdownSide={isQuickChatPage ? 'bottom' : 'top'}
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
