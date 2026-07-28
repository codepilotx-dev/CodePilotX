const STORAGE_PREFIX = 'conversation.timeline-disclosures.v1.'
const MAX_EXPANDED_IDS = 1_000

type TimelineDisclosureSnapshotV1 = {
  schemaVersion: 1
  expandedIds: string[]
}

export function loadTimelineDisclosureState(threadId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(threadId))
    if (!raw) return new Set()

    const snapshot = parseSnapshot(JSON.parse(raw))
    return snapshot ? new Set(snapshot.expandedIds) : new Set()
  } catch {
    return new Set()
  }
}

export function setTimelineDisclosureExpanded(
  threadId: string,
  disclosureId: string,
  expanded: boolean,
): Set<string> {
  const expandedIds = [...loadTimelineDisclosureState(threadId)]
  const existingIndex = expandedIds.indexOf(disclosureId)
  if (existingIndex >= 0) expandedIds.splice(existingIndex, 1)

  if (expanded) expandedIds.push(disclosureId)
  const recentExpandedIds = expandedIds.slice(-MAX_EXPANDED_IDS)
  const nextState = new Set(recentExpandedIds)

  const snapshot: TimelineDisclosureSnapshotV1 = {
    schemaVersion: 1,
    expandedIds: recentExpandedIds,
  }
  try {
    window.localStorage.setItem(
      storageKey(threadId),
      JSON.stringify(snapshot),
    )
  } catch {
    /* localStorage full or disabled; keep the returned in-memory state. */
  }

  return nextState
}

function parseSnapshot(value: unknown): TimelineDisclosureSnapshotV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    !Array.isArray(value.expandedIds) ||
    value.expandedIds.some(
      (entry) => typeof entry !== 'string' || entry.length === 0,
    )
  ) {
    return null
  }

  const expandedIds = [...new Set(value.expandedIds)]
  return {
    schemaVersion: 1,
    expandedIds: expandedIds.slice(-MAX_EXPANDED_IDS),
  }
}

function storageKey(threadId: string): string {
  return STORAGE_PREFIX + threadId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
