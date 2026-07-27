import type { SessionListItem } from '../../../uiTypes.js'
import type { DesktopSidebarSort } from '../../../../shared/types.js'

export function sortSessionsByRecency<T extends SessionListItem>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort(compareSessionsByRecency)
}

export type SidebarSessionSortOptions = {
  sort: DesktopSidebarSort
  needsInputSessionIds: ReadonlySet<string>
  unreadSessionIds: ReadonlySet<string>
  scopeKey?: string
  manualOrderByScope: Record<string, readonly string[]>
}

export function sortSessionsForSidebar<T extends SessionListItem>(
  sessions: readonly T[],
  options: SidebarSessionSortOptions,
): T[] {
  if (options.sort === 'manual') {
    return sortSessionsByManualOrder(sessions, options)
  }
  if (options.sort === 'priority') {
    return [...sessions].sort((left, right) =>
      compareSessionsByPriority(left, right, options),
    )
  }
  return sortSessionsByRecency(sessions)
}

export function compareSessionsByRecency<T extends SessionListItem>(
  left: T,
  right: T,
): number {
  return (
    sessionRecencyMs(right) - sessionRecencyMs(left) ||
    timestampMs(right.createdAt) - timestampMs(left.createdAt) ||
    right.id.localeCompare(left.id)
  )
}

function compareSessionsByPriority<T extends SessionListItem>(
  left: T,
  right: T,
  options: Pick<
    SidebarSessionSortOptions,
    'needsInputSessionIds' | 'unreadSessionIds'
  >,
): number {
  return (
    sessionPriorityRank(left, options) - sessionPriorityRank(right, options) ||
    compareSessionsByRecency(left, right)
  )
}

function sortSessionsByManualOrder<T extends SessionListItem>(
  sessions: readonly T[],
  options: Pick<
    SidebarSessionSortOptions,
    'manualOrderByScope' | 'scopeKey'
  >,
): T[] {
  const recentSessions = sortSessionsByRecency(sessions)
  const order = options.scopeKey
    ? options.manualOrderByScope[options.scopeKey] ?? []
    : []
  if (order.length === 0) return recentSessions

  const sessionById = new Map(
    recentSessions.map(session => [session.id, session]),
  )
  const storedSessions: T[] = []
  const storedIds = new Set<string>()
  for (const sessionId of order) {
    const session = sessionById.get(sessionId)
    if (!session || storedIds.has(sessionId)) continue
    storedIds.add(sessionId)
    storedSessions.push(session)
  }
  let storedIndex = 0
  return recentSessions.map(session => {
    if (!storedIds.has(session.id)) return session
    const storedSession = storedSessions[storedIndex]
    storedIndex += 1
    return storedSession ?? session
  })
}

function sessionPriorityRank(
  session: SessionListItem,
  options: Pick<
    SidebarSessionSortOptions,
    'needsInputSessionIds' | 'unreadSessionIds'
  >,
): number {
  if (
    session.status === 'waiting' ||
    options.needsInputSessionIds.has(session.id)
  ) {
    return 0
  }
  if (options.unreadSessionIds.has(session.id)) return 1
  if (session.status === 'running') return 2
  return 3
}

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
