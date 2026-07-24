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
  if (options.sort === 'created') {
    return [...sessions].sort(
      (left, right) =>
        timestampMs(right.createdAt) - timestampMs(left.createdAt) ||
        right.id.localeCompare(left.id),
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

  const positions = new Map<string, number>()
  for (const [index, sessionId] of order.entries()) {
    if (!positions.has(sessionId)) {
      positions.set(sessionId, index)
    }
  }
  return recentSessions.sort((left, right) => {
    const leftPosition = positions.get(left.id)
    const rightPosition = positions.get(right.id)
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition
    }
    if (leftPosition !== undefined) return -1
    if (rightPosition !== undefined) return 1
    return 0
  })
}

function sessionPriorityRank(
  session: SessionListItem,
  options: Pick<
    SidebarSessionSortOptions,
    'needsInputSessionIds' | 'unreadSessionIds'
  >,
): number {
  if (options.needsInputSessionIds.has(session.id)) return 0
  if (options.unreadSessionIds.has(session.id)) return 1
  return 2
}

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
