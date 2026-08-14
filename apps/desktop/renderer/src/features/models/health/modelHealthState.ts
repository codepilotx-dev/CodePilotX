import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'

export type ModelHealthRunSnapshot = NonNullable<
  RpcResult<'model/health/read'>['run']
>
export type ModelHealthItem = ModelHealthRunSnapshot['items'][number]
export type ModelHealthCounts = ModelHealthRunSnapshot['counts']

export type ModelHealthUpdatedPayload = {
  runId: string
  status: ModelHealthRunSnapshot['status']
  counts: ModelHealthRunSnapshot['counts']
  changed?: ModelHealthItem
  completedAt?: number
}

export type ModelHealthFilter = {
  query?: string
  providerId?: string | null
  status?: ModelHealthItem['status'] | null
}

export const MODEL_HEALTH_STATUS_LABELS: Record<ModelHealthItem['status'], string> = {
  queued: '等待中',
  running: '测试中',
  healthy: '健康',
  failed: '失败',
  cancelled: '已取消',
}

const modelKey = (model: ModelHealthItem['model']): string =>
  `${String(model.providerID)}/${String(model.id)}${model.variant ? `/${String(model.variant)}` : ''}`

export type ModelHealthModel = ModelHealthItem['model']

/** The page-scoped, non-persistent state machine used by the health workspace. */
export type ModelHealthState = {
  run: ModelHealthRunSnapshot | null
  /** True when `model/health/read` returned an authoritative snapshot we trust. */
  reconciled: boolean
  /** Payload carries a runId different from the current page run; ignore. */
  staleEventRunId?: string | null
}

export const createModelHealthState = (): ModelHealthState => ({
  run: null,
  reconciled: false,
  staleEventRunId: null,
})

/**
 * Applies an incremental `model/health/updated` event to the page state.
 * Events for an unrelated runId are ignored. Replaces a single item by model key
 * and refreshes counts, keeping the original provider/model ordering stable.
 */
export function applyModelHealthEvent(
  state: ModelHealthState,
  event: ModelHealthUpdatedPayload,
): ModelHealthState {
  if (!state.run || state.run.runId !== event.runId) {
    return state.run
      ? { ...state, staleEventRunId: event.runId }
      : state
  }
  const items = [...state.run.items]
  if (event.changed) {
    const key = modelKey(event.changed.model)
    const index = items.findIndex(item => modelKey(item.model) === key)
    if (index >= 0) items[index] = event.changed
  }
  return {
    ...state,
    staleEventRunId: null,
    reconciled: false,
    run: {
      ...state.run,
      status: event.status,
      counts: { ...event.counts },
      ...(event.completedAt !== undefined ? { completedAt: event.completedAt } : {}),
      items,
    },
  }
}

/** Replaces the page run with an authoritative snapshot (start or read). */
export function replaceModelHealthRun(
  state: ModelHealthState,
  run: ModelHealthRunSnapshot | null,
): ModelHealthState {
  return {
    ...state,
    run,
    reconciled: true,
    staleEventRunId: null,
  }
}

/** Marks results stale when catalog/credentials change; the UI prompts to retest. */
export function invalidateModelHealth(
  state: ModelHealthState,
): ModelHealthState {
  return {
    ...state,
    run: null,
    reconciled: false,
    staleEventRunId: null,
  }
}

export function isModelHealthRunActive(
  status: ModelHealthRunSnapshot['status'],
): boolean {
  return status === 'running' || status === 'cancelling'
}

/** Recomputes counts from items so every state transition keeps the invariant. */
export function countModelHealthItems(
  items: readonly ModelHealthItem[],
): ModelHealthCounts {
  const counts = {
    total: items.length,
    queued: 0,
    running: 0,
    healthy: 0,
    failed: 0,
    cancelled: 0,
  }
  for (const item of items) {
    counts[item.status] += 1
  }
  return counts
}

/**
 * Replaces one item by model key and recomputes counts. Used by the page-local
 * single-model retest path, which never creates a new global batch.
 */
export function replaceModelHealthItem(
  state: ModelHealthState,
  item: ModelHealthItem,
): ModelHealthState {
  if (!state.run) return state
  const key = modelKey(item.model)
  const index = state.run.items.findIndex(
    existing => modelKey(existing.model) === key,
  )
  if (index < 0) return state
  const items = [...state.run.items]
  items[index] = item
  return {
    ...state,
    reconciled: false,
    run: {
      ...state.run,
      items,
      counts: countModelHealthItems(items),
    },
  }
}

export function filterModelHealthItems(
  items: readonly ModelHealthItem[],
  filter: ModelHealthFilter,
): ModelHealthItem[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? ''
  const providerId = filter.providerId?.trim() || null
  const status = filter.status ?? null
  return items.filter(item => {
    const searchable = [
      String(item.model.providerID),
      String(item.model.id),
      String(item.model.variant ?? ''),
    ].join(' ').toLocaleLowerCase()
    if (query && !searchable.includes(query)) return false
    if (providerId && String(item.model.providerID) !== providerId) return false
    if (status && item.status !== status) return false
    return true
  })
}

export function providerOfItem(item: ModelHealthItem): string {
  return String(item.model.providerID)
}
