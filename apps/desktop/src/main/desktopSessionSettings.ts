import type {
  DesktopApprovalPolicy,
  DesktopCollaborationMode,
  DesktopPermissionMode,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopThinkingMode,
  LocalRouterMode,
} from '../shared/types.js'
import {
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
} from '@codepilotx/core/agent/codepilotxSessionContract.js'

export function createSessionSettingsSnapshot(params: {
  localRouterMode?: LocalRouterMode
  permissionProfile: string
  approvalPolicy: DesktopApprovalPolicy
  approvalsReviewer: DesktopSessionSettingsSnapshot['approvalsReviewer']
  permissionMode: DesktopPermissionMode
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: DesktopSessionSettingsSnapshot['providerID']
  providerBaseURL?: string
  model?: string
  planExecutionModel?: string
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
  installCodePilotXDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}): DesktopSessionSettingsSnapshot {
  const collaborationMode = resolveCodePilotXCollaborationMode({
    collaborationMode: params.collaborationMode,
    planModeActive: params.planModeActive,
  })
  const settings: DesktopSessionSettingsSnapshot = {
    localRouterMode: params.localRouterMode,
    permissionProfile: params.permissionProfile,
    approvalPolicy: params.approvalPolicy,
    approvalsReviewer: params.approvalsReviewer,
    permissionMode: params.permissionMode,
    collaborationMode,
    planModeActive: planModeActiveFromCollaborationMode(collaborationMode),
    thinkingMode: params.thinkingMode,
    additionalDirectories: params.additionalDirectories,
    installCodePilotXDependencies: params.installCodePilotXDependencies !== false,
    enableMemory: params.enableMemory !== false,
    rustSearchAndDiffKernels: params.rustSearchAndDiffKernels === true,
  }
  if (params.providerID) settings.providerID = params.providerID
  if (params.providerBaseURL) settings.providerBaseURL = params.providerBaseURL
  if (params.model) settings.model = params.model
  if (params.planExecutionModel) {
    settings.planExecutionModel = params.planExecutionModel
  }
  if (params.reviewModel) settings.reviewModel = params.reviewModel
  if (params.smallFastModel) settings.smallFastModel = params.smallFastModel
  if (params.fastModel) settings.fastModel = params.fastModel
  if (params.defaultModel) settings.defaultModel = params.defaultModel
  if (params.deepModel) settings.deepModel = params.deepModel
  if (params.sessionName) settings.sessionName = params.sessionName
  if (params.systemPrompt) settings.systemPrompt = params.systemPrompt
  if (params.appendSystemPrompt) {
    settings.appendSystemPrompt = params.appendSystemPrompt
  }
  return settings
}

export function applySessionPlanModeActiveToSnapshot(
  snapshot: DesktopSessionSnapshot,
  planModeActive: boolean,
): DesktopSessionSnapshot {
  return applySessionCollaborationModeToSnapshot(
    snapshot,
    resolveCodePilotXCollaborationMode({ planModeActive }),
  )
}

export function applySessionLocalRouterModeToSnapshot(
  snapshot: DesktopSessionSnapshot,
  localRouterMode: LocalRouterMode,
): DesktopSessionSnapshot {
  return {
    ...snapshot,
    item: {
      ...snapshot.item,
      localRouterMode,
    },
    settings: {
      ...snapshot.settings,
      localRouterMode,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function applySessionCollaborationModeToSnapshot(
  snapshot: DesktopSessionSnapshot,
  collaborationMode: DesktopCollaborationMode,
): DesktopSessionSnapshot {
  const planModeActive = planModeActiveFromCollaborationMode(collaborationMode)
  return {
    ...snapshot,
    item: {
      ...snapshot.item,
      collaborationMode,
      planModeActive,
    },
    settings: {
      ...snapshot.settings,
      collaborationMode,
      planModeActive,
    },
    updatedAt: new Date().toISOString(),
  }
}

export function applySessionPermissionModeToSnapshot(
  snapshot: DesktopSessionSnapshot,
  permissionMode: DesktopPermissionMode,
): DesktopSessionSnapshot {
  return {
    ...snapshot,
    item: {
      ...snapshot.item,
      permissionMode,
    },
    settings: {
      ...snapshot.settings,
      permissionMode,
    },
    updatedAt: new Date().toISOString(),
  }
}
