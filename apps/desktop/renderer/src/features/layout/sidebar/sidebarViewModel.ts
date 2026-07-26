import type {
  DesktopRemovedWorkspace,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import type { SessionListItem } from '../../../uiTypes.js'

export type SidebarSessionVisualState =
  | 'needs-input'
  | 'running'
  | 'unread'
  | 'idle'

export type SidebarViewModel = {
  pinnedSessions: SessionListItem[]
  pinnedWorkspaces: DesktopWorkspace[]
  projectWorkspaces: DesktopWorkspace[]
  standaloneSessions: SessionListItem[]
  unpinnedSessions: SessionListItem[]
  sessionStateById: Record<string, SidebarSessionVisualState>
}

export function buildSidebarViewModel({
  pendingPermissionSessionIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionPins,
  sessions,
}: {
  pendingPermissionSessionIds: ReadonlySet<string>
  recentWorkspaces: readonly DesktopWorkspace[]
  removedWorkspaces: readonly DesktopRemovedWorkspace[]
  sessionPins: Readonly<Record<string, string>>
  sessions: readonly SessionListItem[]
}): SidebarViewModel {
  const visibleSessions = sessions
    .filter(session => !session.archivedAt)
    .map(session => ({
      ...session,
      pinnedAt: sessionPins[session.id] ?? null,
    }))
  const pinnedSessions = visibleSessions
    .filter(session => Boolean(session.pinnedAt))
    .sort((left, right) => timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt))
  const pinnedIds = new Set(pinnedSessions.map(session => session.id))
  const unpinnedSessions = visibleSessions.filter(session => !pinnedIds.has(session.id))
  const standaloneSessions = unpinnedSessions.filter(session => session.standalone)
  const allProjects = mergeProjectWorkspaces(
    recentWorkspaces,
    unpinnedSessions,
    removedWorkspaces,
  )
  const pinnedWorkspaces = allProjects
    .filter(project => Boolean(project.pinnedAt))
    .sort(
      (left, right) =>
        timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt) ||
        left.name.localeCompare(right.name),
    )
  const pinnedProjectKeys = new Set(pinnedWorkspaces.map(projectKey))
  const projectWorkspaces = allProjects
    .filter(project => !pinnedProjectKeys.has(projectKey(project)))
    .sort(
      (left, right) =>
        latestProjectActivity(right, unpinnedSessions) -
          latestProjectActivity(left, unpinnedSessions) ||
        left.name.localeCompare(right.name),
    )
  const sessionStateById = Object.fromEntries(
    visibleSessions.map(session => [
      session.id,
      deriveSidebarSessionVisualState(session, pendingPermissionSessionIds),
    ]),
  )

  return {
    pinnedSessions,
    pinnedWorkspaces,
    projectWorkspaces,
    standaloneSessions,
    unpinnedSessions,
    sessionStateById,
  }
}

export function deriveSidebarSessionVisualState(
  session: SessionListItem,
  pendingPermissionSessionIds: ReadonlySet<string>,
): SidebarSessionVisualState {
  if (
    session.status === 'waiting' ||
    pendingPermissionSessionIds.has(session.id)
  ) {
    return 'needs-input'
  }
  if (session.status === 'running') return 'running'
  if (session.unreadAt) return 'unread'
  return 'idle'
}

function mergeProjectWorkspaces(
  recentWorkspaces: readonly DesktopWorkspace[],
  sessions: readonly SessionListItem[],
  removedWorkspaces: readonly DesktopRemovedWorkspace[],
): DesktopWorkspace[] {
  const removedPaths = new Set(removedWorkspaces.map(item => item.path))
  const byProject = new Map<string, DesktopWorkspace>()
  for (const workspace of recentWorkspaces) {
    if (!removedPaths.has(workspace.path)) {
      byProject.set(projectKey(workspace), workspace)
    }
  }
  for (const session of sessions) {
    if (
      session.standalone ||
      removedPaths.has(session.workspacePath) ||
      byProject.has(sessionProjectKey(session))
    ) {
      continue
    }
    byProject.set(sessionProjectKey(session), {
      projectId: session.projectId ?? undefined,
      name: session.workspaceName,
      path: session.workspacePath,
    })
  }
  return [...byProject.values()]
}

function latestProjectActivity(
  project: DesktopWorkspace,
  sessions: readonly SessionListItem[],
): number {
  let latest = timestampMs(project.lastOpenedAt)
  for (const session of sessions) {
    if (
      session.standalone ||
      sessionProjectKey(session) !== projectKey(project)
    ) continue
    latest = Math.max(latest, timestampMs(session.lastMessageAt ?? session.createdAt))
  }
  return latest
}

function projectKey(project: DesktopWorkspace): string {
  return project.projectId
    ? `id:${project.projectId}`
    : `path:${normalizePath(project.path)}`
}

function sessionProjectKey(session: SessionListItem): string {
  return session.projectId
    ? `id:${session.projectId}`
    : `path:${normalizePath(session.workspacePath)}`
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}
