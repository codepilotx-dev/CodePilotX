import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopComposerAttachment,
  DesktopInstalledSkill,
  DesktopModelMetadata,
  DesktopPermissionMode,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../../shared/types.js'
import { hasBlockingComposerAttachmentErrors } from '../../../../shared/desktopUserMessage.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { getVisiblePermissionModeOptions } from '../../settings/settingsStorage.js'
import type { Message } from '../../../uiTypes.js'
import type {
  ComposerDraft,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
  ComposerDeliveryIntent,
  ComposerPlacement,
  ComposerSubmitOutcome,
} from './composerTypes.js'
import { createComposerDocument } from './composerTypes.js'
import { executeComposerSubmitTransaction } from './composerSubmitTransaction.js'
import { composerDraftStore } from './composerDraftStore.js'
import {
  skillToComposerCommand,
  type ComposerSkillCommand,
} from './composerSlashCommands.js'

type ControllerOptions = {
  input: string
  messages: Message[]
  hasConversationMessages?: boolean
  placement: ComposerPlacement
  draftKey: ComposerDraftKey
  routedSessionId: string | null
  permissionMode: DesktopPermissionMode
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  planExecutionModel?: string
  planModeActive: boolean
  modelConfigured: boolean
  selectedModelMetadata?: DesktopModelMetadata
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  subagentMode: boolean
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onAppendAttachmentsForDraft?: (
    draftKey: ComposerDraftKey,
    attachments: DesktopComposerAttachment[],
  ) => void
  onRemoveAttachmentForDraft?: (
    draftKey: ComposerDraftKey,
    attachmentId: string,
  ) => void
  onDraftAccepted?: (
    draftKey: ComposerDraftKey,
    snapshot: ComposerDraftContentSnapshot,
  ) => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void
  createSessionForWorkspace: (
    target?: DesktopWorkspace | null,
    initialSessionName?: string,
    projectlessPrompt?: string,
  ) => Promise<string | null>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
    options?: {
      delivery?: ComposerDeliveryIntent
      inputId?: string
      propagateError?: boolean
    },
  ) => Promise<'sent' | 'queued' | 'steered' | null>
}

export function useDesktopComposerController({
  input,
  messages,
  hasConversationMessages: hasConversationMessagesOverride,
  placement,
  draftKey,
  routedSessionId,
  permissionMode,
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
  planExecutionModel,
  planModeActive,
  modelConfigured,
  selectedModelMetadata,
  workspace,
  attachments,
  subagentMode,
  onAttachmentsChange,
  onAppendAttachmentsForDraft,
  onRemoveAttachmentForDraft,
  onDraftAccepted,
  onPermissionChange,
  onProviderModelChange,
  createSessionForWorkspace,
  submitToSession,
}: ControllerOptions) {
  const navigate = useNavigate()
  const [goalModeEnabled, setGoalModeEnabled] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSubmitOutcome, setLastSubmitOutcome] =
    useState<ComposerSubmitOutcome | null>(null)
  const [, setDraftStoreVersion] = useState(0)
  const composingRef = useRef(false)
  const submittingRef = useRef(false)
  const attachmentGenerationRef = useRef(new Map<ComposerDraftKey, number>())
  const initialDraftRef = useRef(composerDraftStore.get(draftKey))
  const draftClientIdRef = useRef(initialDraftRef.current.clientId)
  const activeDraftKeyRef = useRef<ComposerDraftKey>(draftKey)
  const [skillCommands, setSkillCommands] = useState<ComposerSkillCommand[]>([])
  const [selectedSkillToken, setSelectedSkillToken] =
    useState<ComposerSkillCommand | null>(null)

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
    !isSubmitting &&
    (placement === 'new-session' || Boolean(routedSessionId))
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
  const hasConversationMessages =
    hasConversationMessagesOverride ??
    messages.some(message => message.role !== 'system')

  useEffect(() => {
    if (permissionModeVisible) return
    onPermissionChange('default')
  }, [onPermissionChange, permissionModeVisible])

  useEffect(
    () =>
      composerDraftStore.subscribe(() => {
        setDraftStoreVersion(value => value + 1)
        setSelectedSkillToken(
          restoreSkillToken(
            composerDraftStore.get(draftKey).skillInvocation,
            skillCommands,
          ),
        )
      }),
    [draftKey, skillCommands],
  )

  useEffect(() => {
    if (activeDraftKeyRef.current === draftKey) return
    activeDraftKeyRef.current = draftKey
    const nextDraft = composerDraftStore.get(draftKey)
    setGoalModeEnabled(false)
    setSelectedSkillToken(
      restoreSkillToken(nextDraft.skillInvocation, skillCommands),
    )
    setLastSubmitOutcome(null)
    draftClientIdRef.current = nextDraft.clientId
  }, [draftKey, skillCommands])

  useEffect(() => {
    composerDraftStore.update(draftKey, current => ({
      ...current,
      clientId: draftClientIdRef.current,
      document: createComposerDocument(input),
      attachments,
      collaborationMode: planModeActive ? 'plan' : 'default',
    }))
  }, [attachments, draftKey, input, planModeActive])

  useEffect(() => {
    if (subagentMode) {
      setSkillCommands([])
      setSelectedSkillToken(null)
      return
    }
    let cancelled = false
    const load = (forceReload = false) =>
      loadCachedRuntimeSkills(workspace?.path, forceReload)
        .then(skills => skills.map(skillToComposerCommand))
        .then(commands => {
          if (!cancelled) {
            setSkillCommands(commands)
            setSelectedSkillToken(
              restoreSkillToken(
                composerDraftStore.get(draftKey).skillInvocation,
                commands,
              ),
            )
          }
        })
        .catch(() => {
          if (!cancelled) setSkillCommands([])
        })
    void load()
    const unsubscribe = desktopClient.onRuntimeSkillsUpdated(() => {
      void load(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [draftKey, subagentMode, workspace?.path])

  function handleSubmit(delivery: ComposerDeliveryIntent = 'default'): void {
    if (
      submittingRef.current ||
      composingRef.current ||
      !modelConfigured ||
      !canSubmit
    ) {
      return
    }
    submittingRef.current = true
    setIsSubmitting(true)
    setLastSubmitOutcome(null)
    composerDraftStore.clearSubmitOutcome(draftKey)
    void performSubmit(delivery).finally(() => {
      submittingRef.current = false
      setIsSubmitting(false)
    })
  }

  async function performSubmit(
    delivery: ComposerDeliveryIntent,
  ): Promise<void> {
    const sourceDraftKey = draftKey
    const snapshot: ComposerDraftContentSnapshot = {
      text: input,
      attachments: [...attachments],
    }

    if (goalModeEnabled && placement !== 'new-session' && routedSessionId) {
      const goalText = input.trim()
      if (!goalText) {
        setLastSubmitOutcome({
          status: 'failed',
          phase: 'prepare',
          message: '请输入目标内容',
          sessionId: routedSessionId,
        })
        composerDraftStore.setSubmitOutcome(sourceDraftKey, {
          status: 'failed',
          phase: 'prepare',
          message: '请输入目标内容',
          sessionId: routedSessionId,
        })
        return
      }
      try {
        await desktopClient.setSessionGoal(routedSessionId, {
          objective: goalText,
          status: 'active',
        })
        applyPlanExecutionModel()
        onDraftAccepted?.(sourceDraftKey, snapshot)
        composerDraftStore.clear(sourceDraftKey)
        if (activeDraftKeyRef.current === sourceDraftKey) {
          setSelectedSkillToken(null)
          setGoalModeEnabled(false)
          draftClientIdRef.current = crypto.randomUUID()
        }
        const successOutcome: ComposerSubmitOutcome = {
          status: 'sent',
          sessionId: routedSessionId,
        }
        setLastSubmitOutcome(successOutcome)
        composerDraftStore.clearSubmitOutcome(sourceDraftKey)
      } catch (error) {
        console.error('Failed to set session goal:', error)
        const failureOutcome: ComposerSubmitOutcome = {
          status: 'failed',
          phase: 'send',
          message: errorMessageOf(error),
          sessionId: routedSessionId,
        }
        setLastSubmitOutcome(failureOutcome)
        composerDraftStore.setSubmitOutcome(sourceDraftKey, failureOutcome)
      }
      return
    }

    const draft: ComposerDraft = {
      clientId: draftClientIdRef.current,
      document: createComposerDocument(input),
      attachments,
      skillInvocation: selectedSkillToken
        ? {
            name: selectedSkillToken.skill.name,
            path: selectedSkillToken.skill.path,
          }
        : undefined,
      collaborationMode: planModeActive ? 'plan' : 'default',
    }
    const isNewSession = placement === 'new-session'
    const outcome = await executeComposerSubmitTransaction({
      draft,
      targetSessionId: isNewSession ? null : routedSessionId,
      createSession: isNewSession
        ? (initialSessionName, projectlessPrompt) =>
            createSessionForWorkspace(
              workspace,
              initialSessionName,
              projectlessPrompt,
            )
        : undefined,
      // Keep navigation before submission so the routed page owns all
      // streaming state from the first response event onward.
      navigateToSession: nextSessionId =>
        {
          composerDraftStore.move(sourceDraftKey, `session:${nextSessionId}`)
          navigate(sessionPath(nextSessionId))
      },
      submitToSession: async (targetSessionId, value, metadata) => {
        const result = await submitToSession(targetSessionId, value, {
          delivery,
          inputId: metadata.inputId,
          propagateError: true,
        })
        if (!result) throw new Error('发送失败，请重试')
        return result === 'queued' ? 'queued' : 'sent'
      },
    })
    setLastSubmitOutcome(outcome)

    if (outcome.status === 'failed') {
      const failureDraftKey: ComposerDraftKey = outcome.sessionId
        ? `session:${outcome.sessionId}`
        : sourceDraftKey
      composerDraftStore.setSubmitOutcome(failureDraftKey, outcome)
      return
    }

    const acceptedDraftKey: ComposerDraftKey = isNewSession
      ? `session:${outcome.sessionId}`
      : sourceDraftKey
    onDraftAccepted?.(acceptedDraftKey, snapshot)
    composerDraftStore.clear(acceptedDraftKey)
    composerDraftStore.clearSubmitOutcome(acceptedDraftKey)
    if (activeDraftKeyRef.current === acceptedDraftKey) {
      setSelectedSkillToken(null)
      setGoalModeEnabled(false)
      draftClientIdRef.current = crypto.randomUUID()
    }
  }

  function applyPlanExecutionModel(): void {
    if (!planExecutionModel) return
    const slashIdx = planExecutionModel.indexOf('/')
    if (slashIdx <= 0 || slashIdx >= planExecutionModel.length - 1) return
    onProviderModelChange(
      planExecutionModel.slice(0, slashIdx) as ModelProviderID,
      planExecutionModel.slice(slashIdx + 1),
    )
  }

  async function handleOpenFiles(): Promise<void> {
    const targetDraftKey = draftKey
    const generation = nextAttachmentGeneration(
      attachmentGenerationRef.current,
      targetDraftKey,
    )
    const selected = await desktopClient.chooseComposerFiles()
    if (attachmentGenerationRef.current.get(targetDraftKey) !== generation) {
      return
    }
    appendAttachments(targetDraftKey, selected)
  }

  async function handleAddFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return
    const targetDraftKey = draftKey
    const generation = nextAttachmentGeneration(
      attachmentGenerationRef.current,
      targetDraftKey,
    )
    await desktopClient.authorizeComposerFilePaths(filePaths)
    const selected = await desktopClient.readComposerFiles(filePaths)
    if (attachmentGenerationRef.current.get(targetDraftKey) !== generation) {
      return
    }
    appendAttachments(targetDraftKey, selected)
  }

  function appendAttachments(
    targetDraftKey: ComposerDraftKey,
    nextAttachments: DesktopComposerAttachment[],
  ): void {
    if (nextAttachments.length === 0) return
    if (onAppendAttachmentsForDraft) {
      onAppendAttachmentsForDraft(targetDraftKey, nextAttachments)
      return
    }
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments.filter(
        attachment => !attachmentIds.has(attachment.id),
      ),
    ])
  }

  function handleRemoveAttachment(attachmentId: string): void {
    if (onRemoveAttachmentForDraft) {
      onRemoveAttachmentForDraft(draftKey, attachmentId)
      return
    }
    onAttachmentsChange(
      attachments.filter(attachment => attachment.id !== attachmentId),
    )
  }

  async function handleCompact(): Promise<void> {
    if (!routedSessionId) throw new Error('请先创建任务后再压缩上下文')
    await desktopClient.compactSession(routedSessionId)
  }

  function handleCommandError(message: string): void {
    const outcome: ComposerSubmitOutcome = {
      status: 'failed',
      phase: 'send',
      message,
      sessionId: routedSessionId ?? undefined,
    }
    setLastSubmitOutcome(outcome)
    composerDraftStore.setSubmitOutcome(draftKey, outcome)
  }

  return {
    branchName,
    canSubmit,
    effectivePermissionMode,
    goalModeEnabled,
    handleAddFilePaths,
    handleCommandError,
    handleCompact,
    handleOpenFiles,
    handleRemoveAttachment,
    handleSkillDeselect: () => {
      composerDraftStore.setSkillInvocation(draftKey, undefined)
      setSelectedSkillToken(null)
    },
    handleSkillSelect: (skill: ComposerSkillCommand) => {
      composerDraftStore.setSkillInvocation(draftKey, {
        name: skill.skill.name,
        path: skill.skill.path,
      })
      setSelectedSkillToken(skill)
    },
    handleSubmit,
    handleCompositionEnd: () => {
      composingRef.current = false
      setIsComposing(false)
    },
    handleCompositionStart: () => {
      composingRef.current = true
      setIsComposing(true)
    },
    hasConversationMessages,
    isComposing,
    isSubmitting,
    lastSubmitOutcome:
      composerDraftStore.getSubmitOutcome(draftKey) ?? lastSubmitOutcome,
    permissionOptions,
    selectedSkillToken,
    setGoalModeEnabled,
    skillCommands,
    unsupportedAttachmentReason,
  }
}

const runtimeSkillCache = new Map<string, DesktopInstalledSkill[]>()
const runtimeSkillRequests = new Map<string, Promise<DesktopInstalledSkill[]>>()

export function loadCachedRuntimeSkills(
  workspacePath?: string,
  forceReload = false,
  loader: (
    workspacePath?: string,
    forceReload?: boolean,
  ) => Promise<DesktopInstalledSkill[]> = async (path, force) => {
    const result = await desktopClient.listRuntimeSkills(path, {
      forceReload: force,
    })
    return result.state === 'ready' && result.data
      ? result.data.filter(skill => skill.enabled)
      : []
  },
): Promise<DesktopInstalledSkill[]> {
  const key = workspacePath?.trim() || '__no_workspace__'
  if (forceReload) runtimeSkillCache.delete(key)
  const cached = runtimeSkillCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = runtimeSkillRequests.get(key)
  if (pending) return pending
  const request = loader(workspacePath, forceReload)
    .then(skills => {
      const enabled = skills.filter(skill => skill.enabled)
      runtimeSkillCache.set(key, enabled)
      runtimeSkillRequests.delete(key)
      return enabled
    })
    .catch(error => {
      runtimeSkillRequests.delete(key)
      throw error
    })
  runtimeSkillRequests.set(key, request)
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
  return `/threads/${encodeURIComponent(sessionId)}`
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function restoreSkillToken(
  invocation: ComposerDraft['skillInvocation'],
  commands: ComposerSkillCommand[],
): ComposerSkillCommand | null {
  if (!invocation) return null
  const command = commands.find(item => item.skill.name === invocation.name)
  return {
    id: `skill:${invocation.name}`,
    trigger: invocation.name,
    title: command?.title ?? invocation.name,
    description: command?.description ?? '',
    source: 'skill',
    skill: {
      name: invocation.name,
      path: invocation.path,
      scope: command?.skill.scope ?? 'repo',
    },
  }
}

function nextAttachmentGeneration(
  generations: Map<ComposerDraftKey, number>,
  draftKey: ComposerDraftKey,
): number {
  const next = (generations.get(draftKey) ?? 0) + 1
  generations.set(draftKey, next)
  return next
}
