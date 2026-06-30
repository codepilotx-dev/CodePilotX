export type CodexCollaborationModeKind = 'default' | 'plan'

export type CodexCollaborationModeSettings = {
  reasoningEffort?: string | null
  developerInstructions?: string | null
}

export type CodexCollaborationMode = {
  mode: CodexCollaborationModeKind
  settings?: CodexCollaborationModeSettings
}

export const DEFAULT_CODEX_COLLABORATION_MODE: CodexCollaborationMode = {
  mode: 'default',
}

export const PLAN_CODEX_COLLABORATION_MODE: CodexCollaborationMode = {
  mode: 'plan',
}

export function normalizeCodexCollaborationMode(
  value: unknown,
): CodexCollaborationMode {
  if (!value || typeof value !== 'object') return DEFAULT_CODEX_COLLABORATION_MODE
  const mode = (value as { mode?: unknown }).mode
  if (mode === 'plan') return PLAN_CODEX_COLLABORATION_MODE
  if (mode === 'default') return DEFAULT_CODEX_COLLABORATION_MODE
  return DEFAULT_CODEX_COLLABORATION_MODE
}

export function isPlanCollaborationMode(
  value: unknown,
): value is CodexCollaborationMode {
  return normalizeCodexCollaborationMode(value).mode === 'plan'
}

export function planModeActiveFromCollaborationMode(value: unknown): boolean {
  return isPlanCollaborationMode(value)
}

export function collaborationModeFromPlanModeActive(
  planModeActive: boolean | undefined,
): CodexCollaborationMode {
  return planModeActive === true
    ? PLAN_CODEX_COLLABORATION_MODE
    : DEFAULT_CODEX_COLLABORATION_MODE
}

export function resolveCodexCollaborationMode(params: {
  collaborationMode?: unknown
  planModeActive?: boolean
}): CodexCollaborationMode {
  if (params.collaborationMode !== undefined) {
    return normalizeCodexCollaborationMode(params.collaborationMode)
  }
  return collaborationModeFromPlanModeActive(params.planModeActive)
}
