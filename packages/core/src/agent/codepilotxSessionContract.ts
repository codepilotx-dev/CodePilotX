export type CodePilotXCollaborationModeKind = 'default' | 'plan'

export type CodePilotXCollaborationModeSettings = {
  reasoningEffort?: string | null
  developerInstructions?: string | null
}

export type CodePilotXCollaborationMode = {
  mode: CodePilotXCollaborationModeKind
  settings?: CodePilotXCollaborationModeSettings
}

export const DEFAULT_CODEPILOTX_COLLABORATION_MODE: CodePilotXCollaborationMode = {
  mode: 'default',
}

export const PLAN_CODEPILOTX_COLLABORATION_MODE: CodePilotXCollaborationMode = {
  mode: 'plan',
}

export function normalizeCodePilotXCollaborationMode(
  value: unknown,
): CodePilotXCollaborationMode {
  if (!value || typeof value !== 'object') return DEFAULT_CODEPILOTX_COLLABORATION_MODE
  const mode = (value as { mode?: unknown }).mode
  if (mode === 'plan') return PLAN_CODEPILOTX_COLLABORATION_MODE
  if (mode === 'default') return DEFAULT_CODEPILOTX_COLLABORATION_MODE
  return DEFAULT_CODEPILOTX_COLLABORATION_MODE
}

export function isPlanCollaborationMode(
  value: unknown,
): value is CodePilotXCollaborationMode {
  return normalizeCodePilotXCollaborationMode(value).mode === 'plan'
}

export function planModeActiveFromCollaborationMode(value: unknown): boolean {
  return isPlanCollaborationMode(value)
}

export function collaborationModeFromPlanModeActive(
  planModeActive: boolean | undefined,
): CodePilotXCollaborationMode {
  return planModeActive === true
    ? PLAN_CODEPILOTX_COLLABORATION_MODE
    : DEFAULT_CODEPILOTX_COLLABORATION_MODE
}

export function resolveCodePilotXCollaborationMode(params: {
  collaborationMode?: unknown
  planModeActive?: boolean
}): CodePilotXCollaborationMode {
  if (params.collaborationMode !== undefined) {
    return normalizeCodePilotXCollaborationMode(params.collaborationMode)
  }
  return collaborationModeFromPlanModeActive(params.planModeActive)
}
