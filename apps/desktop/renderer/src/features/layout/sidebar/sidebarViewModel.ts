import type {
  DesktopRemovedWorkspace,
  DesktopSidebarOrganization,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import type { SessionListItem } from '../../../uiTypes.js'
import { sortSessionsByRecency } from '../../session/state/sessionSorting.js'

export type SidebarSessionVisualState =
  | 'needs-input'
  | 'running'
  | 'unread'
  | 'idle'

export type SidebarPinnedItem =
  | {
      key: string
      kind: 'session'
      pinnedAt: string | null
      session: SessionListItem
    }
  | {
      key: string
      kind: 'project'
      pinnedAt: string | null
      project: DesktopWorkspace
    }

export type SidebarProjectSessionBucket = {
  allSessions: SessionListItem[]
  displaySessions: SessionListItem[]
  openCount: number
  unreadCount: number
}

export type SidebarViewModel = {
  allProjectSessions: SessionListItem[]
  pinnedSessions: SessionListItem[]
  pinnedWorkspaces: DesktopWorkspace[]
  projectSessionBuckets: ReadonlyMap<string, SidebarProjectSessionBucket>
  projectWorkspaces: DesktopWorkspace[]
  recentSessions: SessionListItem[]
  standaloneSessions: SessionListItem[]
  unpinnedSessions: SessionListItem[]
  visibleSessions: SessionListItem[]
  sessionStateById: Record<string, SidebarSessionVisualState>
}

export type SidebarFocusSectionId =
  | 'priority'
  | `day-${number}`

export type SidebarFocusSection = {
  id: SidebarFocusSectionId
  label: string
  sessions: SessionListItem[]
}

export function buildSidebarFocusSections(input: {
  now: number
  sessions: readonly SessionListItem[]
  sessionStateById: Readonly<Record<string, SidebarSessionVisualState>>
}): SidebarFocusSection[] {
  const priority: SessionListItem[] = []
  const priorityRankById = new Map<string, number>()
  const dayBuckets = new Map<number, SessionListItem[]>()

  for (const session of input.sessions) {
    const state = input.sessionStateById[session.id]
    const priorityRank = sidebarPriorityRank(state)
    if (priorityRank >= 0) {
      priority.push(session)
      priorityRankById.set(session.id, priorityRank)
      continue
    }
    const activityMs = sessionRecencyMs(session)
    if (activityMs <= 0) {
      // 时间无效的普通任务不进入聚焦视图
      continue
    }
    let offset = localDayOrdinal(input.now) - localDayOrdinal(activityMs)
    if (offset < 0) offset = 0
    if (offset > 6) continue
    const bucket = dayBuckets.get(offset)
    if (bucket) {
      bucket.push(session)
    } else {
      dayBuckets.set(offset, [session])
    }
  }

  const sections: SidebarFocusSection[] = []
  if (priority.length > 0) {
    sections.push({
      id: 'priority',
      label: '优先级',
      sessions: sortPrioritySessions(priority, priorityRankById),
    })
  }

  for (const offset of [...dayBuckets.keys()].sort((a, b) => a - b)) {
    const sessions = dayBuckets.get(offset) ?? []
    if (sessions.length === 0) continue
    const dayDate = new Date(input.now)
    dayDate.setDate(dayDate.getDate() - offset)
    sections.push({
      id: `day-${offset}`,
      label: labelForDayOffset(offset, dayDate),
      sessions: sortSessionsByRecency(sessions),
    })
  }
  return sections
}

export function labelForDayOffset(offset: number, date: Date): string {
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  return `星期${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`
}

export function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ) / 86_400_000
}

function sortPrioritySessions(
  sessions: readonly SessionListItem[],
  priorityRankById: ReadonlyMap<string, number>,
): SessionListItem[] {
  return [...sessions].sort((left, right) => {
    const leftRank = priorityRankById.get(left.id) ?? 3
    const rightRank = priorityRankById.get(right.id) ?? 3
    return (
      leftRank - rightRank ||
      sessionRecencyMs(right) - sessionRecencyMs(left) ||
      right.id.localeCompare(left.id)
    )
  })
}

function sidebarPriorityRank(
  state: SidebarSessionVisualState | undefined,
): number {
  if (state === 'needs-input') return 0
  if (state === 'unread') return 1
  if (state === 'running') return 2
  return -1
}

export function buildSidebarViewModel({
  manualOrderByScope = {},
  organization = 'projects',
  pendingPermissionSessionIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionPins,
  sessions,
}: {
  manualOrderByScope?: Readonly<Record<string, readonly string[]>>
  organization?: DesktopSidebarOrganization
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
  const allProjectSessions = visibleSessions.filter(session => !session.standalone)
  const projectSessionBuckets = buildProjectSessionBuckets(
    allProjectSessions,
    unpinnedSessions,
  )
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
        left.name.localeCompare(right.name) ||
        projectKey(left).localeCompare(projectKey(right)),
    )
  const pinnedProjectKeys = new Set(pinnedWorkspaces.map(projectKey))
  const recentSessions =
    organization === 'flat'
      ? unpinnedSessions.filter(
          session =>
            session.standalone ||
            !pinnedProjectKeys.has(sessionProjectKey(session)),
        )
      : standaloneSessions
  const projectWorkspaces = sortProjectsForSidebar(
    allProjects.filter(project => !pinnedProjectKeys.has(projectKey(project))),
    {
      manualOrderByScope,
      scopeKey: 'projects',
      sessions: allProjectSessions,
    },
  )
  const sessionStateById = Object.fromEntries(
    visibleSessions.map(session => [
      session.id,
      deriveSidebarSessionVisualState(session, pendingPermissionSessionIds),
    ]),
  )

  return {
    allProjectSessions,
    pinnedSessions,
    pinnedWorkspaces,
    projectSessionBuckets,
    projectWorkspaces,
    recentSessions,
    standaloneSessions,
    unpinnedSessions,
    visibleSessions,
    sessionStateById,
  }
}

export function buildProjectSessionBuckets(
  allProjectSessions: readonly SessionListItem[],
  displaySessions: readonly SessionListItem[],
): ReadonlyMap<string, SidebarProjectSessionBucket> {
  const buckets = new Map<string, SidebarProjectSessionBucket>()
  const ensureBucket = (projectKey: string): SidebarProjectSessionBucket => {
    const existing = buckets.get(projectKey)
    if (existing) return existing
    const created: SidebarProjectSessionBucket = {
      allSessions: [],
      displaySessions: [],
      openCount: 0,
      unreadCount: 0,
    }
    buckets.set(projectKey, created)
    return created
  }

  for (const session of allProjectSessions) {
    if (session.standalone) continue
    const bucket = ensureBucket(sessionProjectKey(session))
    bucket.allSessions.push(session)
    if (session.unreadAt) bucket.unreadCount += 1
    if (isOpenProjectSession(session)) bucket.openCount += 1
  }

  for (const session of displaySessions) {
    if (session.standalone) continue
    ensureBucket(sessionProjectKey(session)).displaySessions.push(session)
  }

  for (const bucket of buckets.values()) {
    bucket.displaySessions.sort(
      (left, right) =>
        sessionRecencyMs(right) - sessionRecencyMs(left) ||
        right.id.localeCompare(left.id),
    )
  }
  return buckets
}

export function countOpenProjectSessions(
  sessions: readonly SessionListItem[],
): number {
  return sessions.filter(isOpenProjectSession).length
}

export function buildSidebarPinnedItems({
  pinnedSessions,
  pinnedWorkspaces,
  storedOrder,
}: {
  pinnedSessions: readonly SessionListItem[]
  pinnedWorkspaces: readonly DesktopWorkspace[]
  storedOrder: readonly string[]
}): SidebarPinnedItem[] {
  const byPinnedAt: SidebarPinnedItem[] = [
    ...pinnedSessions.map(
      (session): SidebarPinnedItem => ({
        key: sidebarPinnedSessionKey(session),
        kind: 'session',
        pinnedAt: session.pinnedAt ?? null,
        session,
      }),
    ),
    ...pinnedWorkspaces.map(
      (project): SidebarPinnedItem => ({
        key: sidebarPinnedProjectKey(project),
        kind: 'project',
        pinnedAt: project.pinnedAt ?? null,
        project,
      }),
    ),
  ].sort(
    (left, right) =>
      timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt),
  )
  const itemByKey = new Map(byPinnedAt.map(item => [item.key, item]))
  const storedKeys = new Set(storedOrder)
  return [
    ...byPinnedAt.filter(item => !storedKeys.has(item.key)),
    ...storedOrder.flatMap(key => {
      const item = itemByKey.get(key)
      return item ? [item] : []
    }),
  ]
}

export function reorderSidebarPinnedItemKeys(
  items: readonly SidebarPinnedItem[],
  sourceKey: string,
  targetKey: string,
): string[] | null {
  if (sourceKey === targetKey) return null
  const order = items.map(item => item.key)
  const sourceIndex = order.indexOf(sourceKey)
  const targetIndex = order.indexOf(targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return null
  const [moved] = order.splice(sourceIndex, 1)
  if (!moved) return null
  order.splice(targetIndex, 0, moved)
  return order
}

export function sidebarPinnedSessionKey(session: SessionListItem): string {
  return `session:${session.id}`
}

export function sidebarPinnedProjectKey(project: DesktopWorkspace): string {
  return `project:${sidebarProjectKey(project)}`
}

export function sortProjectsForSidebar(
  projects: readonly DesktopWorkspace[],
  {
    manualOrderByScope,
    scopeKey,
    sessions,
  }: {
    manualOrderByScope: Readonly<Record<string, readonly string[]>>
    scopeKey: string
    sessions: readonly SessionListItem[]
  },
): DesktopWorkspace[] {
  const projectMetrics = new Map<
    string,
    { latestActivity: number }
  >()
  for (const project of projects) {
    projectMetrics.set(projectKey(project), {
      latestActivity: timestampMs(project.lastOpenedAt),
    })
  }
  for (const session of sessions) {
    const metrics = projectMetrics.get(sessionProjectKey(session))
    if (!metrics) continue
    metrics.latestActivity = Math.max(
      metrics.latestActivity,
      timestampMs(session.lastMessageAt ?? session.createdAt),
    )
  }

  const byActivity = [...projects].sort((left, right) => {
    const leftMetrics = projectMetrics.get(projectKey(left))
    const rightMetrics = projectMetrics.get(projectKey(right))
    return (
      (rightMetrics?.latestActivity ?? 0) -
        (leftMetrics?.latestActivity ?? 0) ||
      left.name.localeCompare(right.name) ||
      projectKey(left).localeCompare(projectKey(right))
    )
  })
  return applyStoredProjectOrder(
    byActivity,
    manualOrderByScope[scopeKey] ?? [],
  )
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
  if (session.unreadAt) return 'unread'
  if (session.status === 'running') return 'running'
  return 'idle'
}

function mergeProjectWorkspaces(
  recentWorkspaces: readonly DesktopWorkspace[],
  sessions: readonly SessionListItem[],
  removedWorkspaces: readonly DesktopRemovedWorkspace[],
): DesktopWorkspace[] {
  const removedPaths = new Set(
    removedWorkspaces.map(item => normalizePath(item.path)),
  )
  const byProject = new Map<string, DesktopWorkspace>()
  for (const workspace of recentWorkspaces) {
    if (!removedPaths.has(normalizePath(workspace.path))) {
      byProject.set(projectKey(workspace), workspace)
    }
  }
  for (const session of sessions) {
    if (
      session.standalone ||
      removedPaths.has(normalizePath(session.workspacePath)) ||
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

export function sidebarProjectKey(project: DesktopWorkspace): string {
  return project.projectId
    ? `id:${project.projectId}`
    : `path:${normalizePath(project.path)}`
}

function projectKey(project: DesktopWorkspace): string {
  return sidebarProjectKey(project)
}

export function sidebarSessionProjectKey(session: SessionListItem): string {
  return session.projectId
    ? `id:${session.projectId}`
    : `path:${normalizePath(session.workspacePath)}`
}

function sessionProjectKey(session: SessionListItem): string {
  return sidebarSessionProjectKey(session)
}

export function normalizeSidebarPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

function normalizePath(value: string): string {
  return normalizeSidebarPath(value)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function isOpenProjectSession(session: SessionListItem): boolean {
  return session.status === 'queued'
    || session.status === 'waiting'
    || session.status === 'running'
}

function applyStoredProjectOrder(
  projects: readonly DesktopWorkspace[],
  storedOrder: readonly string[],
): DesktopWorkspace[] {
  const projectByKey = new Map(
    projects.map(project => [projectKey(project), project]),
  )
  const storedKeys = new Set(storedOrder)
  return [
    ...projects.filter(project => !storedKeys.has(projectKey(project))),
    ...storedOrder.flatMap(key => {
      const project = projectByKey.get(key)
      return project ? [project] : []
    }),
  ]
}
