import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopModelMetadata,
  DesktopPermissionMode,
  DesktopSlashCommandSuggestion,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../shared/desktopUserMessage.js'
import { desktopClient } from '../../services/desktopClient.js'
import { getVisiblePermissionModeOptions } from '../settings/settingsStorage.js'
import type { Message } from '../../uiTypes.js'

type ControllerOptions = {
  input: string
  messages: Message[]
  isQuickChatPage: boolean
  routedSessionId: string | null
  permissionMode: DesktopPermissionMode
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  planExecutionModel?: string
  modelConfigured: boolean
  selectedModelMetadata?: DesktopModelMetadata
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  subagentMode: boolean
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onInputChange: (value: string) => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
  ) => Promise<void>
}

export function useDesktopComposerController({
  input,
  messages,
  isQuickChatPage,
  routedSessionId,
  permissionMode,
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
  planExecutionModel,
  modelConfigured,
  selectedModelMetadata,
  workspace,
  attachments,
  subagentMode,
  onAttachmentsChange,
  onInputChange,
  onPermissionChange,
  onProviderModelChange,
  createSessionForWorkspace,
  submitToSession,
}: ControllerOptions) {
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
    (Boolean(input.trim()) ||
      attachments.length > 0 ||
      selectedSkillToken !== null) &&
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

      if (goalModeEnabled && routedSessionId) {
        const goalText = input.trim()
        setSelectedSkillToken(null)
        setGoalModeEnabled(false)
        onInputChange('')
        onAttachmentsChange([])
        if (planExecutionModel) {
          const slashIdx = planExecutionModel.indexOf('/')
          if (slashIdx > 0 && slashIdx < planExecutionModel.length - 1) {
            const providerID = planExecutionModel.slice(
              0,
              slashIdx,
            ) as ModelProviderID
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
      const submittedInput = skillPrefix ? `${skillPrefix} ${input}` : input
      const messageInput = {
        text: submittedInput,
        attachments,
      }
      const sessionName = selectedSkillToken
        ? `$${selectedSkillToken.name} ${input}`
        : undefined
      setSelectedSkillToken(null)
      setGoalModeEnabled(false)

      if (isQuickChatPage) {
        onInputChange('')
        onAttachmentsChange([])
        const nextSessionId = await createSessionForWorkspace(
          workspace,
          sessionName,
        )
        if (!nextSessionId) return
        // Keep navigation before submission so the routed page owns all
        // streaming state from the first response event onward.
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
    await desktopClient.authorizeComposerFilePaths(filePaths)
    const selected = await desktopClient.readComposerFiles(filePaths)
    appendAttachments(selected)
  }

  function appendAttachments(
    nextAttachments: DesktopComposerAttachment[],
  ): void {
    if (nextAttachments.length === 0) return
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments.filter(
        attachment => !attachmentIds.has(attachment.id),
      ),
    ])
  }

  function handleRemoveAttachment(attachmentId: string): void {
    onAttachmentsChange(
      attachments.filter(attachment => attachment.id !== attachmentId),
    )
  }

  return {
    branchName,
    canSubmit,
    effectivePermissionMode,
    goalModeEnabled,
    handleAddFilePaths,
    handleOpenFiles,
    handleRemoveAttachment,
    handleSkillDeselect: () => setSelectedSkillToken(null),
    handleSkillSelect: (
      skill: DesktopSlashCommandSuggestion & { skillPath: string },
    ) => setSelectedSkillToken(skill),
    handleSubmit,
    hasConversationMessages,
    permissionOptions,
    selectedSkillToken,
    setGoalModeEnabled,
    slashCommands,
    unsupportedAttachmentReason,
  }
}

const slashCommandCache = new Map<string, DesktopSlashCommandSuggestion[]>()
const slashCommandRequests = new Map<
  string,
  Promise<DesktopSlashCommandSuggestion[]>
>()

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

function attachmentKindLabel(
  kind: DesktopComposerAttachment['kind'],
): string {
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
