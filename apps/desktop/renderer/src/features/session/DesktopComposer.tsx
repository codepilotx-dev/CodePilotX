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
} from '../../../shared/types.js'
import { THINKING_MODE_OPTIONS } from '../settings/settingsStorage.js'
import type { ModelPreset } from '../../modelPresets.js'
import type { Message } from '../../uiTypes.js'
import { ComposerCard } from './ComposerCard.js'
import type {
  ComposerCapabilities,
  ComposerDraftContentSnapshot,
  ComposerDraftKey,
  ComposerPlacement,
  ComposerSubmitShortcut,
} from './composerTypes.js'
import {
  useDesktopComposerController,
} from './useDesktopComposerController.js'

export {
  getDesktopComposerBranchName,
  loadCachedSlashCommands,
} from './useDesktopComposerController.js'
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
  placement: ComposerPlacement
  draftKey: ComposerDraftKey
  capabilities?: Partial<ComposerCapabilities>
  submitShortcut?: ComposerSubmitShortcut
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
    options?: { propagateError?: boolean },
  ) => Promise<'sent' | 'queued' | 'steered' | null>
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
  placement,
  draftKey,
  capabilities,
  submitShortcut,
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
  onAppendAttachmentsForDraft,
  onRemoveAttachmentForDraft,
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
  onFollowUpSendNow,
  onFollowUpReorder,
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
      ? { ...capabilities, goals: false }
      : capabilities
  const {
    branchName,
    canSubmit,
    effectivePermissionMode,
    goalModeEnabled,
    handleAddFilePaths,
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
    selectedSkillToken,
    setGoalModeEnabled,
    slashCommands,
    unsupportedAttachmentReason,
  } = useDesktopComposerController({
    input,
    messages,
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
  })

  return (
    <ComposerCard
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={effectivePermissionMode}
      planModeActive={planModeActive}
      placement={placement}
      capabilities={effectiveCapabilities}
      submitShortcut={submitShortcut}
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
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onInterrupt={() => void onInterrupt()}
      onProviderModelChange={onProviderModelChange}
      onProviderOpen={onProviderOpen}
      onProviderSearch={onProviderSearch}
      onAddFiles={filePaths => void handleAddFilePaths(filePaths)}
      onOpenFiles={() => void handleOpenFiles()}
      onRemoveAttachment={handleRemoveAttachment}
      onOpenWorkspace={workspaceItem => void onOpenWorkspace(workspaceItem)}
      onCloneGithub={onCloneGithub}
      onClearWorkspace={onClearWorkspace}
      onOpenBrowser={onOpenBrowser}
      onBranchSelect={branch => void onBranchSelect(branch)}
      onCreateBranch={onCreateBranch}
      onStartReview={onStartReview}
      onPermissionChange={onPermissionChange}
      onPlanModeChange={onPlanModeChange}
      onLocalRouterModeChange={onLocalRouterModeChange}
      onSubmit={handleSubmit}
      onThinkingChange={onThinkingChange}
      onSkillSelect={handleSkillSelect}
      onSkillDeselect={handleSkillDeselect}
      routedSessionId={routedSessionId}
      contextDropdownSide="top"
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
    />
  )
}
