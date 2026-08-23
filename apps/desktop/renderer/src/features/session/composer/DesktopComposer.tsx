import { useEffect } from 'react'
import type React from 'react'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopModelMetadata,
  DesktopPermissionMode,
  DesktopQueuePauseReason,
  DesktopQueuedFollowUp,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopThreadGoal,
  DesktopUserMessageInput,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
} from '../../../../shared/types.js'
import { THINKING_MODE_OPTIONS } from '../../settings/settingsStorage.js'
import type { ModelPreset } from '../../../modelPresets.js'
import type { Message } from '../../../uiTypes.js'
import { ComposerCard } from './ComposerCard.js'
import type {
  ComposerCapabilities,
  ComposerDeliveryIntent,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
  ComposerDocument,
  ComposerPlacement,
  ComposerSubmitShortcut,
  ComposerSurface,
  WorkingPlugin,
} from './composerTypes.js'
import {
  useDesktopComposerController,
} from './useDesktopComposerController.js'
import { resolveAvailableCodingModel } from './codingModelSelection.js'

export {
  loadCachedRuntimeSkills,
} from './useDesktopComposerController.js'
export { getDesktopComposerBranchName } from './composerWorkspacePresentation.js'
export type {
  ComposerCapabilities,
  ComposerCollaborationMode,
  ComposerExecutionMode,
  ComposerPlacement,
  ComposerStackMode,
  ComposerSubmitShortcut,
} from './composerTypes.js'

type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
}

export type DesktopComposerProps = {
  input: string
  messages: Message[]
  hasConversationMessages?: boolean
  placement: ComposerPlacement
  draftKey: ComposerDraftKey
  capabilities?: Partial<ComposerCapabilities>
  submitShortcut?: ComposerSubmitShortcut
  surface?: ComposerSurface
  workingPlugin?: WorkingPlugin | null
  onWorkingPluginChange?: (plugin: WorkingPlugin | null) => void
  onWorkingPluginAvailabilityChange?: (available: boolean) => void
  onSkillTokenActivate?: (skill: { name: string; path: string }) => void
  placeholder?: string
  routedSessionId: string | null
  sessionStatus: DesktopSessionStatus
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  localRouterMode: LocalRouterMode
  enableParetoCodeRouter: boolean
  enableFusionRouter: boolean
  enableAutoReviewPermissionMode: boolean
  enableFullAccessPermissionMode: boolean
  codingModel?: string
  thinkingMode: DesktopThinkingMode
  selectedProviderID?: ModelProviderID
  selectedModelPreset: string
  modelConfigured: boolean
  modelCatalogLoading?: boolean
  selectedModelMetadata?: DesktopModelMetadata
  showThinkingOptions: boolean
  deepSeekThinkingControls: boolean
  showContextUsage: boolean
  contextUsage: DesktopContextUsage | null
  modelPresets: ModelPreset[]
  providerOptions: ProviderModelOption[]
  recentWorkspaces: DesktopWorkspace[]
  workspace: DesktopWorkspace | null
  attachments: DesktopComposerAttachment[]
  onAttachmentsChange: (attachments: DesktopComposerAttachment[]) => void
  onAppendAttachmentsForDraft?: (
    draftKey: ComposerDraftKey,
    attachments: DesktopComposerAttachment[],
  ) => void
  onRemoveAttachmentForDraft?: (
    draftKey: ComposerDraftKey,
    attachmentId: string,
  ) => void
  onOpenAttachment?: (attachment: DesktopComposerAttachment) => void
  onDraftAccepted?: (
    draftKey: ComposerDraftKey,
    snapshot: ComposerDraftContentSnapshot,
  ) => boolean | void
  onChooseWorkspace: () => Promise<DesktopWorkspace | null>
  onInputChange: (value: string) => void
  onInterrupt: () => Promise<void>
  onProviderModelChange: (
    providerID: ModelProviderID,
    modelPresetID: string,
  ) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void
  onOpenWorkspace: (
    workspace: DesktopWorkspace,
  ) => Promise<DesktopWorkspace | null>
  onCloneGithub: () => void
  onClearWorkspace: () => void
  onOpenBrowser?: () => void
  onOpenMcpSettings?: () => void
  onBranchSelect: (branch: string) => Promise<void>
  onCreateBranch: () => void
  onStartReview?: (
    target:
      | { type: 'uncommittedChanges' }
      | { type: 'baseBranch'; branch: string },
  ) => void
  onPermissionChange: (value: DesktopPermissionMode) => void
  onPlanModeChange: (active: boolean) => void
  onLocalRouterModeChange: (mode: LocalRouterMode) => void
  onThinkingChange: (value: DesktopThinkingMode) => void
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
  queuedFollowUps?: DesktopQueuedFollowUp[]
  queuePauseReason?: DesktopQueuePauseReason | null
  onFollowUpEdit?: (followUpId: string, input: DesktopUserMessageInput) => void
  onFollowUpRemove?: (followUpId: string) => void
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
  hasConversationMessages: hasConversationMessagesOverride,
  placement,
  draftKey,
  capabilities,
  submitShortcut,
  surface,
  workingPlugin,
  onWorkingPluginChange,
  onWorkingPluginAvailabilityChange,
  onSkillTokenActivate,
  placeholder: placeholderOverride,
  routedSessionId,
  sessionStatus,
  permissionMode,
  planModeActive,
  localRouterMode,
  enableParetoCodeRouter,
  enableFusionRouter,
  enableAutoReviewPermissionMode,
  enableFullAccessPermissionMode,
  codingModel,
  thinkingMode,
  selectedProviderID,
  selectedModelPreset,
  modelConfigured,
  modelCatalogLoading = false,
  selectedModelMetadata,
  showThinkingOptions,
  deepSeekThinkingControls,
  showContextUsage,
  contextUsage,
  modelPresets,
  providerOptions,
  recentWorkspaces,
  workspace,
  attachments,
  onAttachmentsChange,
  onAppendAttachmentsForDraft,
  onRemoveAttachmentForDraft,
  onOpenAttachment,
  onDraftAccepted,
  onChooseWorkspace,
  onInputChange,
  onInterrupt,
  onProviderModelChange,
  onProviderOpen,
  onProviderSearch,
  onOpenWorkspace,
  onCloneGithub,
  onClearWorkspace,
  onOpenBrowser,
  onOpenMcpSettings,
  onBranchSelect,
  onCreateBranch,
  onStartReview,
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
  onFollowUpResume,
  threadGoal,
  onGoalPause,
  onGoalResume,
  onGoalComplete,
  onGoalClear,
  subagentMode = false,
}: DesktopComposerProps): React.ReactNode {
  const effectiveCapabilities =
    placement === 'new-session'
      ? {
          ...capabilities,
          goals: false,
          dictation: capabilities?.dictation ?? true,
        }
      : {
          ...capabilities,
          dictation: capabilities?.dictation ?? true,
        }
  const {
    branchName,
    canSubmit,
    effectivePermissionMode,
    fileAttachmentsAvailable,
    goalModeEnabled,
    handleAddFiles,
    handleCommandError,
    handleCompact,
    handleComposerDocumentChange,
    handleOpenFiles,
    handleRemoveAttachment,
    handleSkillDeselect,
    handleSkillSelect,
    handleSubmit,
    handleCompositionEnd,
    handleCompositionStart,
    hasConversationMessages,
    isSubmitting,
    lastSubmitOutcome,
    permissionOptions,
    activeSkillToken,
    composerDocument,
    setGoalModeEnabled,
    skillCommands,
    taskPlanningAvailable,
    unsupportedAttachmentReason,
  } = useDesktopComposerController({
    input,
    messages,
    hasConversationMessages: hasConversationMessagesOverride,
    placement,
    draftKey,
    routedSessionId,
    permissionMode,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    codingModel: resolveAvailableCodingModel(codingModel, providerOptions),
    planModeActive,
    modelConfigured,
    selectedModelMetadata,
    workspace,
    attachments,
    subagentMode,
    surface,
    workingPlugin,
    onWorkingPluginChange,
    onAttachmentsChange,
    onAppendAttachmentsForDraft,
    onRemoveAttachmentForDraft,
    onDraftAccepted,
    onPermissionChange,
    onProviderModelChange,
    createSessionForWorkspace,
    submitToSession,
  })

  useEffect(() => {
    onWorkingPluginAvailabilityChange?.(taskPlanningAvailable)
  }, [onWorkingPluginAvailabilityChange, taskPlanningAvailable])

  useEffect(() => {
    if (workingPlugin && planModeActive) onPlanModeChange(false)
  }, [onPlanModeChange, planModeActive, workingPlugin])

  function handleWorkingPluginChange(plugin: WorkingPlugin | null): void {
    if (plugin === 'task-planning') {
      onPlanModeChange(false)
      handleSkillDeselect()
    }
    onWorkingPluginChange?.(plugin)
  }

  function handlePlanModeChange(active: boolean): void {
    if (active && workingPlugin) onWorkingPluginChange?.(null)
    onPlanModeChange(active)
  }

  function handleSkillSelectWithWorkingPluginClear(
    skill: Parameters<typeof handleSkillSelect>[0],
  ): void {
    if (workingPlugin) onWorkingPluginChange?.(null)
    handleSkillSelect(skill)
  }

  function handleComposerDocumentChangeWithInput(
    document: ComposerDocument,
  ): void {
    handleComposerDocumentChange(document)
    onInputChange(document.text)
  }

  return (
    <ComposerCard
      draftKey={draftKey}
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={effectivePermissionMode}
      planModeActive={planModeActive}
      placement={placement}
      capabilities={{
        ...effectiveCapabilities,
        fileAttachments:
          fileAttachmentsAvailable
          && (effectiveCapabilities?.fileAttachments ?? true),
      }}
      submitShortcut={submitShortcut}
      surface={surface}
      workingPlugin={workingPlugin}
      taskPlanningAvailable={taskPlanningAvailable}
      onWorkingPluginChange={handleWorkingPluginChange}
      submitting={isSubmitting}
      submitOutcome={lastSubmitOutcome}
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
      submitDisabledReason={unsupportedAttachmentReason ?? undefined}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
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
      skillCommands={skillCommands}
      document={composerDocument}
      selectedSkillToken={activeSkillToken ?? undefined}
      hasConversationMessages={hasConversationMessages}
      placeholder={
        placeholderOverride ??
        (modelCatalogLoading
          ? '加载模型列表中……'
          : hasConversationMessages
            ? '要求后续变更'
            : '随心输入')
      }
      onChooseWorkspace={() => void onChooseWorkspace()}
      onInputChange={onInputChange}
      onDocumentChange={handleComposerDocumentChangeWithInput}
      onSkillTokenActivate={onSkillTokenActivate}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onInterrupt={() => void onInterrupt()}
      onProviderModelChange={onProviderModelChange}
      onProviderOpen={onProviderOpen}
      onProviderSearch={onProviderSearch}
      onAddFiles={files => void handleAddFiles(files)}
      onOpenFiles={() => void handleOpenFiles()}
      onRemoveAttachment={handleRemoveAttachment}
      onOpenAttachment={onOpenAttachment}
      onOpenWorkspace={workspaceItem => void onOpenWorkspace(workspaceItem)}
      onCloneGithub={onCloneGithub}
      onClearWorkspace={onClearWorkspace}
      onOpenBrowser={onOpenBrowser}
      onOpenMcpSettings={onOpenMcpSettings}
      onBranchSelect={branch => void onBranchSelect(branch)}
      onCreateBranch={onCreateBranch}
      onStartReview={onStartReview}
      onPermissionChange={onPermissionChange}
      onPlanModeChange={handlePlanModeChange}
      onLocalRouterModeChange={onLocalRouterModeChange}
      onSubmit={handleSubmit}
      onCompact={handleCompact}
      onCommandError={handleCommandError}
      onThinkingChange={onThinkingChange}
      onSkillSelect={handleSkillSelectWithWorkingPluginClear}
      routedSessionId={routedSessionId}
      contextDropdownSide="top"
      queuedFollowUps={queuedFollowUps}
      queuePauseReason={queuePauseReason}
      onFollowUpEdit={onFollowUpEdit}
      onFollowUpRemove={onFollowUpRemove}
      onFollowUpResume={onFollowUpResume}
      threadGoal={threadGoal}
      onGoalPause={onGoalPause}
      onGoalResume={onGoalResume}
      onGoalComplete={onGoalComplete}
      onGoalClear={onGoalClear}
    />
  )
}
