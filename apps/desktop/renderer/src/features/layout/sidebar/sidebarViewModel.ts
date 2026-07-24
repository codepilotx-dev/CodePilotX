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
    .filter(workspace => Boolean(workspace.pinnedAt))
    .sort((left, right) => timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt))
  const pinnedProjectPaths = new Set(pinnedWorkspaces.map(workspace => workspace.path))
  const projectWorkspaces = allProjects
    .filter(workspace => !pinnedProjectPaths.has(workspace.path))
    .sort(
      (left, right) =>
        latestProjectActivity(right.path, unpinnedSessions) -
          latestProjectActivity(left.path, unpinnedSessions) ||
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
  const byPath = new Map<string, DesktopWorkspace>()
  for (const workspace of recentWorkspaces) {
    if (!removedPaths.has(workspace.path)) byPath.set(workspace.path, workspace)
  }
  for (const session of sessions) {
    if (
      session.standalone ||
      removedPaths.has(session.workspacePath) ||
      byPath.has(session.workspacePath)
    ) {
      continue
    }
    byPath.set(session.workspacePath, {
      name: session.workspaceName,
      path: session.workspacePath,
    })
  }
  return [...byPath.values()]
}

function latestProjectActivity(
  projectPath: string,
  sessions: readonly SessionListItem[],
): number {
  let latest = 0
  for (const session of sessions) {
    if (session.standalone || session.workspacePath !== projectPath) continue
    latest = Math.max(latest, timestampMs(session.lastMessageAt ?? session.createdAt))
  }
  return latest
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}
