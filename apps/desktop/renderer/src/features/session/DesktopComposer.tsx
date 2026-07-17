import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopModelMetadata,
  DesktopPermissionMode,
  DesktopQueuePauseReason,
  DesktopQueuedFollowUp,
  DesktopSlashCommandSuggestion,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopThreadGoal,
  DesktopUserMessageInput,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
} from '../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../shared/desktopUserMessage.js'
import { desktopClient } from '../../services/desktopClient.js'
import {
  getVisiblePermissionModeOptions,
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
  planModeActive: boolean
  localRouterMode: LocalRouterMode
  enableParetoCodeRouter: boolean
  enableFusionRouter: boolean
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  planExecutionModel?: string
  thinkingMode: DesktopThinkingMode
  selectedProviderID?: ModelProviderID
  selectedModelPreset: string
  modelConfigured: boolean
  modelCatalogLoading?: boolean
  modelConfigurationMessage?: string
  selectedModelMetadata?: DesktopModelMetadata
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  debugMode?: boolean
  showContextUsage: boolean
  contextUsage: DesktopContextUsage | null
  modelPresets: ModelPreset[]
  providerOptions: ProviderModelOption[]
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
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
  onPlanModeChange: (active: boolean) => void
  onLocalRouterModeChange: (mode: LocalRouterMode) => void
  onThinkingChange: (value: DesktopThinkingMode) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
  ) => Promise<void>
  queuedFollowUps?: DesktopQueuedFollowUp[]
  queuePauseReason?: DesktopQueuePauseReason | null
  onFollowUpEdit?: (followUpId: string, input: DesktopUserMessageInput) => void
  onFollowUpRemove?: (followUpId: string) => void
  onFollowUpSendNow?: (followUpId: string) => void
  onFollowUpReorder?: (followUpIds: string[]) => void
  onFollowUpResume?: () => void
  threadGoal?: DesktopThreadGoal | null
  onGoalPause?: () => void
  onGoalResume?: () => void
  onGoalComplete?: () => void
  onGoalClear?: () => void
  subagentMode?: boolean
}

export function DesktopComposer({
  input,
  messages,
  isQuickChatPage,
  routedSessionId,
  sessionStatus,
  permissionMode,
  planModeActive,
  localRouterMode,
  enableParetoCodeRouter,
  enableFusionRouter,
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
  planExecutionModel,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  modelConfigured,
  modelCatalogLoading = false,
  modelConfigurationMessage,
  selectedModelMetadata,
  showThinkingOptions,
  deepSeekThinkingControls,
  debugMode = false,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  recentWorkspaces,
  workspace,
  attachments,
  onAttachmentsChange,
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
  onPlanModeChange,
  onLocalRouterModeChange,
  onThinkingChange,
  createSessionForWorkspace,
  submitToSession,
  queuedFollowUps,
  queuePauseReason,
  onFollowUpEdit,
  onFollowUpRemove,
  onFollowUpSendNow,
  onFollowUpReorder,
  onFollowUpResume,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  subagentMode = false,
}: Props): React.ReactNode {
  const navigate = useNavigate()
  const [goalModeEnabled, setGoalModeEnabled] = useState(false)
  const [slashCommands, setSlashCommands] = useState<
    DesktopSlashCommandSuggestion[]
  >([])
  const [selectedSkillToken, setSelectedSkillToken] = useState<
    (DesktopSlashCommandSuggestion & { skillPath: string }) | null
  >(null)
  const hasAttachmentErrors = hasBlockingComposerAttachmentErrors(attachments)
  const unsupportedAttachmentReason = getUnsupportedAttachmentReason(
    attachments,
    selectedModelMetadata,
  )
  const canSubmit =
    (Boolean(input.trim()) || attachments.length > 0 || selectedSkillToken !== null) &&
    !hasAttachmentErrors &&
    !unsupportedAttachmentReason &&
    modelConfigured &&
    (isQuickChatPage || Boolean(routedSessionId))
  const attachmentIds = useMemo(
    () => new Set(attachments.map(attachment => attachment.id)),
    [attachments],
  )
  const branchName = getDesktopComposerBranchName(workspace)
  const permissionOptions = useMemo(
    () =>
      getVisiblePermissionModeOptions({
        enableAutoReviewPermissionMode,
        enableFullAccessPermissionMode,
      }),
    [enableAutoReviewPermissionMode, enableFullAccessPermissionMode],
  )
  const permissionModeVisible = permissionOptions.some(
    option => option.value === permissionMode,
  )
  const effectivePermissionMode = permissionModeVisible
    ? permissionMode
    : 'default'
  const hasConversationMessages = messages.some(
    message => message.role !== 'system',
  )

  useEffect(() => {
    if (permissionModeVisible) return
    onPermissionChange('default')
  }, [onPermissionChange, permissionModeVisible])

  useEffect(() => {
    if (subagentMode) {
      setSlashCommands([])
      setSelectedSkillToken(null)
      return
    }
    let cancelled = false
    loadCachedSlashCommands(workspace?.path)
      .then(commands => {
        if (!cancelled) setSlashCommands(commands)
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [subagentMode, workspace?.path])

	  function handleSubmit(): void {
	    void (async () => {
	      if (!modelConfigured) return

	      // Goal mode: use setSessionGoal instead of sending a user message
	      if (goalModeEnabled && routedSessionId) {
	        const goalText = input.trim()
	        setSelectedSkillToken(null)
	        setGoalModeEnabled(false)
	        onInputChange('')
	        onAttachmentsChange([])
	        // Switch to plan execution model if configured before setting goal
	        if (planExecutionModel) {
	          const slashIdx = planExecutionModel.indexOf('/')
	          if (slashIdx > 0 && slashIdx < planExecutionModel.length - 1) {
	            const providerID = planExecutionModel.slice(0, slashIdx) as ModelProviderID
	            const modelPresetID = planExecutionModel.slice(slashIdx + 1)
	            onProviderModelChange(providerID, modelPresetID)
	          }
	        }
	        try {
	          await desktopClient.setSessionGoal(routedSessionId, {
	            objective: goalText,
	            status: 'active',
	          })
	        } catch (error) {
	          console.error('Failed to set session goal:', error)
	        }
	        return
	      }
	
	      const skillPrefix = selectedSkillToken
	        ? `[${selectedSkillToken.name}](${selectedSkillToken.skillPath})`
	        : ''
	      const submittedInput = skillPrefix
	        ? `${skillPrefix} ${input}`
	        : input
	
	      const submittedAttachments = attachments
	      const messageInput = {
	        text: submittedInput,
	        attachments: submittedAttachments,
	      }
	      setSelectedSkillToken(null)
	      setGoalModeEnabled(false)
	      if (isQuickChatPage) {
	        onInputChange('')
	        onAttachmentsChange([])
	        const sessionName = selectedSkillToken
	          ? `$${selectedSkillToken.name} ${input}`
	          : undefined
	        const nextSessionId = workspace
	          ? await createSessionForWorkspace(workspace, sessionName)
	          : await createSessionForWorkspace(null, sessionName)
        if (!nextSessionId) return
        navigate(sessionPath(nextSessionId))
        await submitToSession(nextSessionId, messageInput)
        return
      }
      if (routedSessionId) {
        onAttachmentsChange([])
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
    // Grant authorization so the main process knows these paths came from a
    // trusted OS event (drag-and-drop / paste) rather than arbitrary IPC.
    await desktopClient.authorizeComposerFilePaths(filePaths)
    const selected = await desktopClient.readComposerFiles(filePaths)
    appendAttachments(selected)
  }

  function appendAttachments(nextAttachments: DesktopComposerAttachment[]): void {
    if (nextAttachments.length === 0) return
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments.filter(attachment => !attachmentIds.has(attachment.id)),
    ])
  }

  function handleRemoveAttachment(attachmentId: string): void {
    onAttachmentsChange(
      attachments.filter(attachment => attachment.id !== attachmentId),
    )
  }

  function handleSkillSelect(
    skill: DesktopSlashCommandSuggestion & { skillPath: string },
  ): void {
    setSelectedSkillToken(skill)
  }

  function handleSkillDeselect(): void {
    setSelectedSkillToken(null)
  }

  return (
    <ComposerCard
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={effectivePermissionMode}
      planModeActive={planModeActive}
      subagentMode={subagentMode}
      goalModeEnabled={goalModeEnabled}
      onGoalModeChange={setGoalModeEnabled}
      localRouterMode={localRouterMode}
      enableParetoCodeRouter={enableParetoCodeRouter}
      enableFusionRouter={enableFusionRouter}
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID ?? 'anthropic'}
      selectedModelPreset={selectedModelPreset}
      modelConfigured={modelConfigured}
      modelCatalogLoading={modelCatalogLoading}
      modelConfigurationMessage={modelConfigurationMessage}
      submitDisabledReason={unsupportedAttachmentReason ?? undefined}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      debugMode={debugMode}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={modelPresets}
      providerOptions={providerOptions}
      permissionOptions={permissionOptions}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      branches={workspace?.branches ?? []}
      recentWorkspaces={recentWorkspaces}
      workspace={workspace}
      attachments={attachments}
      slashCommands={slashCommands}
      selectedSkillToken={selectedSkillToken ?? undefined}
      placeholder={
        modelCatalogLoading
          ? '加载模型列表中……'
          : modelConfigured
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
      onPlanModeChange={onPlanModeChange}
      onLocalRouterModeChange={onLocalRouterModeChange}
      onSubmit={handleSubmit}
      onThinkingChange={onThinkingChange}
      onSkillSelect={handleSkillSelect}
      onSkillDeselect={handleSkillDeselect}
      routedSessionId={routedSessionId}
      contextDropdownSide={isQuickChatPage ? 'bottom' : 'top'}
      queuedFollowUps={queuedFollowUps}
      queuePauseReason={queuePauseReason}
      onFollowUpEdit={onFollowUpEdit}
      onFollowUpRemove={onFollowUpRemove}
      onFollowUpSendNow={onFollowUpSendNow}
      onFollowUpReorder={onFollowUpReorder}
      onFollowUpResume={onFollowUpResume}
      threadGoal={threadGoal}
      onGoalPause={onGoalPause}
      onGoalResume={onGoalResume}
      onGoalComplete={onGoalComplete}
      onGoalClear={onGoalClear}
      showBottomBar={isQuickChatPage}
    />
  )
}

const slashCommandCache = new Map<string, DesktopSlashCommandSuggestion[]>()
const slashCommandRequests = new Map<string, Promise<DesktopSlashCommandSuggestion[]>>()

export function loadCachedSlashCommands(
  workspacePath?: string,
  loader: (workspacePath?: string) => Promise<DesktopSlashCommandSuggestion[]> =
    path => desktopClient.listSlashCommands(path),
): Promise<DesktopSlashCommandSuggestion[]> {
  const key = workspacePath?.trim() || '__no_workspace__'
  const cached = slashCommandCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = slashCommandRequests.get(key)
  if (pending) return pending
  const request = loader(workspacePath)
    .then(commands => {
      slashCommandCache.set(key, commands)
      slashCommandRequests.delete(key)
      return commands
    })
    .catch(error => {
      slashCommandRequests.delete(key)
      throw error
    })
  slashCommandRequests.set(key, request)
  return request
}

function getUnsupportedAttachmentReason(
  attachments: DesktopComposerAttachment[],
  metadata: DesktopModelMetadata | undefined,
): string | null {
  if (attachments.length === 0 || !metadata?.modalities?.input) return null
  const supportedInputs = new Set(metadata.modalities.input)
  const unsupported = attachments.find(attachment => {
    if (attachment.status === 'error') return false
    return !supportedInputs.has(attachment.kind)
  })
  if (!unsupported) return null
  const modelLabel = metadata.label ?? metadata.name ?? metadata.id
  return `${modelLabel} 不支持 ${attachmentKindLabel(unsupported.kind)} 附件`
}

function attachmentKindLabel(kind: DesktopComposerAttachment['kind']): string {
  switch (kind) {
    case 'image':
      return '图片'
    case 'document':
      return '文档'
    case 'text':
      return '文本'
    case 'audio':
      return '音频'
    case 'video':
      return '视频'
    case 'binary':
      return '文件'
  }
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

// GOAL_MODE_SYSTEM_PROMPT and buildGoalModePrompt removed.
// Goal mode now uses desktopClient.setSessionGoal() instead of
// wrapping user text with system prompt instructions.
