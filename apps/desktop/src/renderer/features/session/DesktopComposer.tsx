import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopFollowUpBehavior,
  DesktopModelMetadata,
  DesktopPermissionMode,
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
import {
  desktopUserMessageInputToPreviewText,
  hasBlockingComposerAttachmentErrors,
} from '../../../shared/desktopUserMessage.js'
import { desktopClient } from '../../services/desktopClient.js'
import {
  getVisiblePermissionModeOptions,
  THINKING_MODE_OPTIONS,
} from '../settings/settingsStorage.js'
import type { ModelPreset } from '../../modelPresets.js'
import type { Message } from '../../uiTypes.js'
import { ComposerCard } from './ComposerCard.js'
import type { SubmitSessionOptions } from './sessionActions.js'

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
    options?: SubmitSessionOptions,
  ) => Promise<void>
  followUpBehavior?: DesktopFollowUpBehavior
  queuedFollowUps?: DesktopQueuedFollowUp[]
  onFollowUpEdit?: (followUpId: string) => void
  onFollowUpRemove?: (followUpId: string) => void
  onFollowUpSendNow?: (followUpId: string) => void
  threadGoal?: DesktopThreadGoal | null
  onGoalPause?: () => void
  onGoalResume?: () => void
  onGoalComplete?: () => void
  onGoalClear?: () => void
  onError: (message: string) => void
  onGoalCreated: (sessionId: string) => Promise<void>
}

type DesktopComposerCanSubmitInput = {
  hasContent: boolean
  hasAttachmentErrors: boolean
  unsupportedAttachmentReason: string | null
  modelConfigured: boolean
  isQuickChatPage: boolean
  routedSessionId: string | null
  sessionStatus?: DesktopSessionStatus
}

export function getDesktopComposerCanSubmit(
  input: DesktopComposerCanSubmitInput,
): boolean {
  return (
    input.hasContent &&
    !input.hasAttachmentErrors &&
    !input.unsupportedAttachmentReason &&
    input.modelConfigured &&
    (input.isQuickChatPage || Boolean(input.routedSessionId))
  )
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
  followUpBehavior = "steer",
  queuedFollowUps,
  onFollowUpEdit,
  onFollowUpRemove,
  onFollowUpSendNow,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  onError,
  onGoalCreated,
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
  const hasContent =
    Boolean(input.trim()) ||
    attachments.length > 0 ||
    selectedSkillToken !== null
  const canSubmitGoal =
    !goalModeEnabled || Boolean(input.trim())
  const canSubmit = getDesktopComposerCanSubmit({
    hasContent,
    hasAttachmentErrors,
    unsupportedAttachmentReason,
    modelConfigured,
    isQuickChatPage,
    routedSessionId,
    sessionStatus,
  }) && canSubmitGoal
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

  function handleSubmit(override?: DesktopFollowUpBehavior): void {
    void (async () => {
      if (!modelConfigured) return

      if (goalModeEnabled && routedSessionId) {
        const created = await submitDesktopComposerGoal({
          routedSessionId,
          input,
          attachments,
          selectedSkillToken,
          setSessionGoal: desktopClient.setSessionGoal,
          onInputChange,
          onAttachmentsChange,
          onSelectedSkillTokenChange: setSelectedSkillToken,
          onGoalModeChange: setGoalModeEnabled,
          onError,
          onGoalCreated,
        })
        if (created && planExecutionModel) {
          const slashIdx = planExecutionModel.indexOf('/')
          if (slashIdx > 0 && slashIdx < planExecutionModel.length - 1) {
            const providerID = planExecutionModel.slice(0, slashIdx) as ModelProviderID
            const modelPresetID = planExecutionModel.slice(slashIdx + 1)
            onProviderModelChange(providerID, modelPresetID)
          }
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
	      const onRestoreInput = (restoredInput: DesktopUserMessageInput): void => {
	        onInputChange(desktopUserMessageInputToPreviewText(restoredInput))
	        onAttachmentsChange(restoredInput.attachments ?? [])
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
        await submitToSession(nextSessionId, messageInput, { onRestoreInput })
        return
      }
      if (routedSessionId) {
        onAttachmentsChange([])
        const overrideOpts: SubmitSessionOptions = {
          followUpOverride: override,
          onRestoreInput,
        }
        await submitToSession(routedSessionId, messageInput, overrideOpts)
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
      followUpBehavior={followUpBehavior}
      onThinkingChange={onThinkingChange}
      onSkillSelect={handleSkillSelect}
      onSkillDeselect={handleSkillDeselect}
      routedSessionId={routedSessionId}
      contextDropdownSide={isQuickChatPage ? 'bottom' : 'top'}
      queuedFollowUps={queuedFollowUps}
      onFollowUpEdit={onFollowUpEdit}
      onFollowUpRemove={onFollowUpRemove}
      onFollowUpSendNow={onFollowUpSendNow}
      threadGoal={threadGoal}
      onGoalPause={onGoalPause}
      onGoalResume={onGoalResume}
      onGoalComplete={onGoalComplete}
      onGoalClear={onGoalClear}
    />
  )
}

type DesktopComposerSkillToken = DesktopSlashCommandSuggestion & {
  skillPath: string
}

type DesktopComposerGoalSubmission = {
  routedSessionId: string
  input: string
  attachments: DesktopComposerAttachment[]
  selectedSkillToken: DesktopComposerSkillToken | null
  setSessionGoal: (
    sessionId: string,
    input: { objective: string; status: 'active' },
  ) => Promise<unknown>
  onInputChange: (value: string) => void
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onSelectedSkillTokenChange: (
    token: DesktopComposerSkillToken | null,
  ) => void
  onGoalModeChange: (enabled: boolean) => void
  onError: (message: string) => void
  onGoalCreated: (sessionId: string) => Promise<void>
}

export async function submitDesktopComposerGoal(
  submission: DesktopComposerGoalSubmission,
): Promise<boolean> {
  const pendingGoal = {
    text: submission.input,
    attachments: submission.attachments,
    selectedSkillToken: submission.selectedSkillToken,
  }
  try {
    await submission.setSessionGoal(submission.routedSessionId, {
      objective: submission.input.trim(),
      status: 'active',
    })
    submission.onSelectedSkillTokenChange(null)
    submission.onGoalModeChange(false)
    submission.onInputChange('')
    submission.onAttachmentsChange([])
    await submission.onGoalCreated(submission.routedSessionId)
    return true
  } catch (error) {
    submission.onInputChange(pendingGoal.text)
    submission.onAttachmentsChange(pendingGoal.attachments)
    submission.onSelectedSkillTokenChange(pendingGoal.selectedSkillToken)
    submission.onError(errorMessageOf(error))
    return false
  }
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

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// GOAL_MODE_SYSTEM_PROMPT and buildGoalModePrompt removed.
// Goal mode now uses desktopClient.setSessionGoal() instead of
// wrapping user text with system prompt instructions.
