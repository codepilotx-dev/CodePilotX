import type {
  DesktopApprovalPolicy,
  DesktopPermissionMode,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopThinkingMode,
} from '../shared/types.js'

export function createSessionSettingsSnapshot(params: {
  permissionProfile: string
  approvalPolicy: DesktopApprovalPolicy
  approvalsReviewer: DesktopSessionSettingsSnapshot['approvalsReviewer']
  permissionMode: DesktopPermissionMode
  providerID?: DesktopSessionSettingsSnapshot['providerID']
  providerBaseURL?: string
  model?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
  askUserQuestionMaxQuestions: DesktopSessionSettingsSnapshot['askUserQuestionMaxQuestions']
  rustSearchAndDiffKernels?: boolean
}): DesktopSessionSettingsSnapshot {
  const settings: DesktopSessionSettingsSnapshot = {
    permissionProfile: params.permissionProfile,
    approvalPolicy: params.approvalPolicy,
    approvalsReviewer: params.approvalsReviewer,
    permissionMode: params.permissionMode,
    thinkingMode: params.thinkingMode,
    additionalDirectories: params.additionalDirectories,
    askUserQuestionMaxQuestions: params.askUserQuestionMaxQuestions,
    rustSearchAndDiffKernels: params.rustSearchAndDiffKernels === true,
  }
  if (params.providerID) settings.providerID = params.providerID
  if (params.providerBaseURL) settings.providerBaseURL = params.providerBaseURL
  if (params.model) settings.model = params.model
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
