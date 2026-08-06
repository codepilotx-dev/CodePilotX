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
  | 'pinned'
  | `day-${number}`

export type SidebarFocusSection = {
  id: SidebarFocusSectionId
  label: string
  sessions: SessionListItem[]
}

export type SidebarTimelineModel = {
  /** 所有需要关注的任务，不受置顶分组开关影响。 */
  attentionSessions: SessionListItem[]
  /** showPinned 为 true 时，从其余分组抽出的置顶任务。 */
  pinnedSessions: SessionListItem[]
  /** 实际显示在“优先级”分类中的关注任务。 */
  prioritySessions: SessionListItem[]
  dateSections: SidebarFocusSection[]
}

export function buildSidebarTimelineModel(input: {
  now: number
  sessions: readonly SessionListItem[]
  showPinned: boolean
}): SidebarTimelineModel {
  const attention: SessionListItem[] = []
  const attentionRankById = new Map<string, number>()
  const pinned: SessionListItem[] = []
  const dayBuckets = new Map<number, SessionListItem[]>()

  for (const session of input.sessions) {
    const priorityRank = sidebarTimelinePriorityRank(session)
    if (priorityRank != null) {
      attention.push(session)
      attentionRankById.set(session.id, priorityRank)
      continue
    }
    if (input.showPinned && session.pinnedAt != null) {
      pinned.push(session)
      continue
    }
    const activityMs = sessionRecencyMs(session)
    if (activityMs <= 0) {
      // 时间无效的普通任务不进入时间线
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

  let prioritySessions = attention
  if (input.showPinned) {
    const pinnedAttention = attention.filter(session => session.pinnedAt != null)
    if (pinnedAttention.length > 0) {
      pinned.push(...pinnedAttention)
      const pinnedAttentionIds = new Set(pinnedAttention.map(session => session.id))
      prioritySessions = attention.filter(session => !pinnedAttentionIds.has(session.id))
    }
  }

  const dateSections: SidebarFocusSection[] = []
  for (const offset of [...dayBuckets.keys()].sort((a, b) => a - b)) {
    const sessions = dayBuckets.get(offset) ?? []
    if (sessions.length === 0) continue
    const dayDate = new Date(input.now)
    dayDate.setDate(dayDate.getDate() - offset)
    dateSections.push({
      id: `day-${offset}`,
      label: labelForDayOffset(offset, dayDate),
      sessions: sortSessionsByRecency(sessions),
    })
  }
  return {
    attentionSessions: sortPrioritySessions(attention, attentionRankById),
    pinnedSessions: sortSessionsByRecency(pinned),
    prioritySessions: sortPrioritySessions(prioritySessions, attentionRankById),
    dateSections,
  }
}

/** “全部标为已读”的目标集合：未读的关注任务。 */
export function sidebarAttentionUnreadSessions(
  sessions: readonly SessionListItem[],
): SessionListItem[] {
  return sessions.filter(session => session.unreadAt != null)
}

/** 安全批量归档集合：仅“已完成但未读”的关注任务，排除等待用户操作或计划审批的任务。 */
export function sidebarArchivableAttentionSessions(
  sessions: readonly SessionListItem[],
): SessionListItem[] {
  return sessions.filter(
    session =>
      session.latestTurnStatus === 'completed' &&
      session.pendingPlanApproval !== true,
  )
}

function sidebarTimelinePriorityRank(
  session: SessionListItem,
): number | null {
  if (
    session.latestTurnStatus === 'waiting-question' ||
    session.latestTurnStatus === 'waiting-permission'
  ) {
    return 0
  }
  if (session.pendingPlanApproval === true) {
    return 1
  }
  if (
    session.latestTurnStatus === 'completed' &&
    session.unreadAt != null
  ) {
    return 2
  }
  return null
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
  const sessionItems: SidebarPinnedItem[] = pinnedSessions
    .map(
      (session): SidebarPinnedItem => ({
        key: sidebarPinnedSessionKey(session),
        kind: 'session',
        pinnedAt: session.pinnedAt ?? null,
        session,
      }),
    )
    .sort(
      (left, right) =>
        timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt),
    )
  const projectItems: SidebarPinnedItem[] = pinnedWorkspaces
    .map(
      (project): SidebarPinnedItem => ({
        key: sidebarPinnedProjectKey(project),
        kind: 'project',
        pinnedAt: project.pinnedAt ?? null,
        project,
      }),
    )
    .sort(
      (left, right) =>
        timestampMs(right.pinnedAt) - timestampMs(left.pinnedAt),
    )
  const sessionKeys = new Set(sessionItems.map(item => item.key))
  const projectKeys = new Set(projectItems.map(item => item.key))
  // 置顶区固定为“全部置顶会话 → 全部置顶文件夹”；
  // 旧 storedOrder 可能是跨类型混排，读取时按类型过滤，仅保留各类型内部的手动顺序。
  return [
    ...orderPinnedItemGroup(
      sessionItems,
      storedOrder.filter(key => sessionKeys.has(key)),
    ),
    ...orderPinnedItemGroup(
      projectItems,
      storedOrder.filter(key => projectKeys.has(key)),
    ),
  ]
}

function orderPinnedItemGroup(
  items: readonly SidebarPinnedItem[],
  storedKeys: readonly string[],
): SidebarPinnedItem[] {
  const storedKeySet = new Set(storedKeys)
  const itemByKey = new Map(items.map(item => [item.key, item]))
  return [
    ...items.filter(item => !storedKeySet.has(item.key)),
    ...storedKeys.flatMap(key => {
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
  const source = items.find(item => item.key === sourceKey)
  const target = items.find(item => item.key === targetKey)
  if (!source || !target || source.kind !== target.kind) return null
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
