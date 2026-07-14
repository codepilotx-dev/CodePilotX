import type { PermissionMode, Run, SendStrategy, TaskMode } from '@codepilotx/shared'

export type { PermissionMode, SendStrategy, TaskMode }

export type TaskPhase = 'idle' | Run['status']
export type EditActionState = 'idle' | 'undone' | 'reviewed'
export type PlanActionState = 'idle' | 'proposals-generated' | 'kept'

export interface ViewPreferences {
  expandedRows: Record<string, boolean>
  filesExpanded: Record<string, boolean>
  editActions: Record<string, EditActionState>
  planActions: Record<string, PlanActionState>
}

const preferenceKey = (sessionID: string) => `codepilotx.sessionView.preferences.${sessionID}`

export const initialViewPreferences: ViewPreferences = {
  expandedRows: {},
  filesExpanded: {},
  editActions: {},
  planActions: {},
}

export function readViewPreferences(sessionID: string): ViewPreferences {
  try {
    const raw = localStorage.getItem(preferenceKey(sessionID))
    if (!raw) return initialViewPreferences
    const parsed = JSON.parse(raw) as Partial<ViewPreferences>
    return {
      ...initialViewPreferences,
      expandedRows: recordOfBooleans(parsed.expandedRows),
      filesExpanded: recordOfBooleans(parsed.filesExpanded),
    }
  } catch {
    return initialViewPreferences
  }
}

export function writeViewPreferences(sessionID: string, preferences: ViewPreferences): void {
  const persisted: Pick<ViewPreferences, 'expandedRows' | 'filesExpanded'> = {
    expandedRows: preferences.expandedRows,
    filesExpanded: preferences.filesExpanded,
  }
  try {
    localStorage.setItem(preferenceKey(sessionID), JSON.stringify(persisted))
  } catch {
    // Local preferences are best-effort only.
  }
}

export function updateExpandedRow(preferences: ViewPreferences, rowID: string, defaultValue = false): ViewPreferences {
  return { ...preferences, expandedRows: { ...preferences.expandedRows, [rowID]: !(preferences.expandedRows[rowID] ?? defaultValue) } }
}

export function updateFilesExpanded(preferences: ViewPreferences, rowID: string, defaultValue = false): ViewPreferences {
  return { ...preferences, filesExpanded: { ...preferences.filesExpanded, [rowID]: !(preferences.filesExpanded[rowID] ?? defaultValue) } }
}

export function phaseFromRun(run: Run | null | undefined): TaskPhase {
  return run?.status ?? 'idle'
}

function recordOfBooleans(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}
