import type { SessionListItem } from '../../uiTypes.js'

export function sortSessionsByRecency<T extends SessionListItem>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort(compareSessionsByRecency)
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

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
