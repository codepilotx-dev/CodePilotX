import {
  createKeyedDisclosureStore,
  type KeyedDisclosureStore,
} from '../../../components/ui/keyedDisclosureStore.js'

const STORAGE_PREFIX = 'conversation.timeline-disclosures.v1.'
const MAX_EXPANDED_IDS = 1_000

type TimelineDisclosureSnapshotV1 = {
  schemaVersion: 1
  expandedIds: string[]
}

const storesByStorage = new WeakMap<Storage, Map<string, KeyedDisclosureStore>>()

export function getTimelineDisclosureStore(threadId: string): KeyedDisclosureStore {
  const storage = window.localStorage
  let stores = storesByStorage.get(storage)
  if (!stores) {
    stores = new Map()
    storesByStorage.set(storage, stores)
  }
  const existing = stores.get(threadId)
  if (existing) return existing

  const store = createKeyedDisclosureStore({
    initialExpandedKeys: readTimelineDisclosureState(storage, threadId),
    maxExpandedKeys: MAX_EXPANDED_IDS,
    persist: (expandedIds) => {
      const snapshot: TimelineDisclosureSnapshotV1 = {
        schemaVersion: 1,
        expandedIds: [...expandedIds],
      }
      try {
        storage.setItem(storageKey(threadId), JSON.stringify(snapshot))
      } catch {
        /* Storage can be disabled or full; the in-memory state remains authoritative. */
      }
    },
  })
  stores.set(threadId, store)
  return store
}

export function loadTimelineDisclosureState(threadId: string): Set<string> {
  return new Set(getTimelineDisclosureStore(threadId).getExpandedKeys())
}

export function setTimelineDisclosureExpanded(
  threadId: string,
  disclosureId: string,
  expanded: boolean,
): Set<string> {
  const store = getTimelineDisclosureStore(threadId)
  if (expanded && store.getSnapshot(disclosureId)) {
    // Preserve the v1 helper's recency semantics without affecting the UI toggle path.
    store.setExpanded(disclosureId, false)
  }
  store.setExpanded(disclosureId, expanded)
  return new Set(store.getExpandedKeys())
}

function readTimelineDisclosureState(storage: Storage, threadId: string): Set<string> {
  try {
    const raw = storage.getItem(storageKey(threadId))
    if (!raw) return new Set()
    const snapshot = parseSnapshot(JSON.parse(raw))
    return snapshot ? new Set(snapshot.expandedIds) : new Set()
  } catch {
    return new Set()
  }
}

function parseSnapshot(value: unknown): TimelineDisclosureSnapshotV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (
    !Array.isArray(value.expandedIds) ||
    value.expandedIds.some(
      (entry) => typeof entry !== 'string' || entry.length === 0,
    )
  ) return null

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
