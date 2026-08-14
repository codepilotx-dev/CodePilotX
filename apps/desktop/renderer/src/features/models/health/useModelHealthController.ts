import type { RpcResult } from '@codepilotx/agent-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../../utils/errors.js'
import {
  applyModelHealthEvent,
  createModelHealthState,
  invalidateModelHealth,
  isModelHealthRunActive,
  replaceModelHealthItem,
  replaceModelHealthRun,
  type ModelHealthItem,
  type ModelHealthModel,
  type ModelHealthState,
  type ModelHealthUpdatedPayload,
} from './modelHealthState.js'

export type ModelHealthExcludedProvider =
  RpcResult<'model/health/preview'>['excludedProviders'][number]

export type ModelHealthConfirmState = {
  open: boolean
  totalRequests: number
  excludedProviders: ModelHealthExcludedProvider[]
  busy: boolean
}

export type ModelHealthController = {
  state: ModelHealthState
  /** True while preview/start/cancel RPCs or a single-model retest are in flight. */
  busy: boolean
  confirm: ModelHealthConfirmState | null
  /** Page-scoped notice, e.g. configuration changed or no eligible models. */
  notice: string | null
  requestStart: () => Promise<void>
  confirmStart: () => Promise<void>
  dismissConfirm: () => void
  cancelRun: () => Promise<void>
  retestItem: (model: ModelHealthModel) => Promise<void>
  dismissNotice: () => void
}

const CONFIGURATION_CHANGED_NOTICE = '模型或凭据配置已变化，请重新测试。'
const NO_ELIGIBLE_MODELS_NOTICE = '没有已启用且已配置凭据的模型。'

const modelKeyOf = (model: ModelHealthModel): string =>
  `${String(model.providerID)}/${String(model.id)}${model.variant ? `/${String(model.variant)}` : ''}`

/**
 * Page-scoped controller for the model health workspace. Results live only in
 * this session's state: the Agent owns the batch snapshot and the live event
 * stream; this hook reconciles them into the page without any persistence.
 *
 * `active` tells the controller whether the health view is currently shown so
 * that leaving the view or unmounting always cancels an accepted batch by its
 * operationId instead of leaving billable probes running.
 */
export function useModelHealthController(active: boolean): ModelHealthController {
  const [state, setState] = useState<ModelHealthState>(createModelHealthState)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ModelHealthConfirmState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const activeRef = useRef(active)
  activeRef.current = active
  /** Run of the batch the page currently owns; null once invalidated. */
  const activeRunIdRef = useRef<string | null>(null)
  /** operationId of a start RPC still in flight (registered before the call). */
  const pendingOperationIdRef = useRef<string | null>(null)
  /** Live events buffered while a snapshot is pending; applied in order after it installs. */
  const pendingEventsRef = useRef<ModelHealthUpdatedPayload[]>([])
  /** True while a start RPC or an authoritative read is in flight. */
  const stagingRef = useRef(false)
  /** Bumped on every new batch, invalidation and unmount to discard stale retests. */
  const generationRef = useRef(0)
  const retestingModelKeysRef = useRef<Set<string>>(new Set())

  const cancelActiveRunBestEffort = useCallback(async (): Promise<void> => {
    const pending = pendingOperationIdRef.current
    if (pending) {
      try {
        await desktopClient.cancelModelHealth(pending, pending)
      } catch {
        // Best-effort: the Agent batch dies with the connection anyway.
      }
      pendingOperationIdRef.current = null
    }
    const runId = activeRunIdRef.current
    const run = stateRef.current.run
    if (!runId || !run || run.runId !== runId) return
    if (!isModelHealthRunActive(run.status)) return
    try {
      await desktopClient.cancelModelHealth(runId, runId)
    } catch {
      // Best-effort: the Agent batch dies with the connection anyway.
    }
  }, [])

  /** Installs an authoritative `model/health/read` snapshot, then applies any events that raced it. */
  const reconcileWithAgent = useCallback(async (): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) return
    stagingRef.current = true
    try {
      const read = await desktopClient.readModelHealth(runId).catch(() => null)
      if (!read?.run) {
        // The batch is gone. Only clear the run this controller owns; a newer
        // batch started by another path must not be touched.
        setState(current => {
          if (!current.run || current.run.runId !== runId) return current
          return { ...current, run: null, reconciled: false }
        })
        if (activeRunIdRef.current === runId) activeRunIdRef.current = null
        return
      }
      const run = read.run
      setState(current => {
        let next = replaceModelHealthRun(current, run)
        for (const event of pendingEventsRef.current) {
          next = applyModelHealthEvent(next, event)
        }
        return next
      })
    } finally {
      pendingEventsRef.current = []
      stagingRef.current = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = desktopClient.subscribeAgentEventEnvelopes({
      liveEventTypes: AGENT_LIVE_EVENT_FILTERS.modelHealth,
      onReplayComplete: () => void reconcileWithAgent(),
      onDeliveryError: () => void reconcileWithAgent(),
    }, async events => {
      for (const event of events) {
        if (event.type === 'model/health/updated') {
          if (stagingRef.current) {
            // Buffer until the pending start/read snapshot installs so a fast
            // running/completed event is not dropped.
            pendingEventsRef.current.push(event.payload)
            continue
          }
          setState(current => applyModelHealthEvent(current, event.payload))
          continue
        }
        if (
          event.type === 'catalog/updated'
          || event.type === 'provider/credential/updated'
        ) {
          // Results were computed against a previous generation of the catalog.
          // Only prompt a retest when this page already holds results; the
          // first visit to an untested page must not show a misleading notice.
          if (stateRef.current.run) {
            await cancelActiveRunBestEffort()
            generationRef.current += 1
            retestingModelKeysRef.current = new Set()
            activeRunIdRef.current = null
            setNotice(CONFIGURATION_CHANGED_NOTICE)
            setState(current => invalidateModelHealth(current))
          }
          return
        }
      }
    })
    return () => {
      unsubscribe()
      generationRef.current += 1
      retestingModelKeysRef.current = new Set()
      pendingEventsRef.current = []
      void cancelActiveRunBestEffort()
    }
    // The subscription and its cleanup are stable for the page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving the health view cancels an accepted batch best-effort by its
  // operationId; re-entering leaves whatever snapshot the events produced.
  useEffect(() => {
    if (active) return
    generationRef.current += 1
    retestingModelKeysRef.current = new Set()
    void cancelActiveRunBestEffort()
  }, [active])

  const requestStart = useCallback(async (): Promise<void> => {
    const run = stateRef.current.run
    if (run && isModelHealthRunActive(run.status)) return
    setBusy(true)
    try {
      const preview = await desktopClient.previewModelHealth()
      if (preview.totalRequests === 0) {
        setConfirm(null)
        setNotice(NO_ELIGIBLE_MODELS_NOTICE)
        return
      }
      setNotice(null)
      setConfirm({
        open: true,
        totalRequests: preview.totalRequests,
        excludedProviders: [...preview.excludedProviders],
        busy: false,
      })
    } catch (error) {
      setNotice(fullErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const confirmStart = useCallback(async (): Promise<void> => {
    if (!confirm || confirm.totalRequests === 0) return
    setConfirm(current => current ? { ...current, busy: true } : current)
    setBusy(true)
    const operationId = crypto.randomUUID()
    pendingOperationIdRef.current = operationId
    stagingRef.current = true
    const installRun = (run: RpcResult<'model/health/start'>['run']) => {
      generationRef.current += 1
      retestingModelKeysRef.current = new Set()
      activeRunIdRef.current = run.runId
      setState(current => {
        let next = replaceModelHealthRun(current, run)
        for (const event of pendingEventsRef.current) {
          next = applyModelHealthEvent(next, event)
        }
        return next
      })
    }
    try {
      const result = await desktopClient.startModelHealth(operationId)
      pendingOperationIdRef.current = null
      stagingRef.current = false
      if (!activeRef.current) {
        // The page left while the start RPC was in flight: cancel the accepted
        // batch immediately instead of showing results.
        void desktopClient.cancelModelHealth(result.run.runId, operationId).catch(() => undefined)
        return
      }
      installRun(result.run)
      setConfirm(null)
      setNotice(null)
    } catch (error) {
      // The start response can be lost after the Agent already accepted the
      // batch. Read it back: restore it when the page is still active, cancel
      // it otherwise, and only surface the error when nothing was accepted.
      const read = await desktopClient.readModelHealth(operationId).catch(() => null)
      const run = read?.run ?? null
      pendingOperationIdRef.current = null
      stagingRef.current = false
      if (run) {
        if (!activeRef.current) {
          void desktopClient.cancelModelHealth(run.runId, operationId).catch(() => undefined)
          return
        }
        installRun(run)
        setConfirm(null)
        setNotice(null)
        return
      }
      setConfirm(null)
      setNotice(fullErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [confirm])

  const dismissConfirm = useCallback((): void => {
    setConfirm(null)
  }, [])

  const cancelRun = useCallback(async (): Promise<void> => {
    const pending = pendingOperationIdRef.current
    const run = stateRef.current.run
    if (!pending && (!run || !isModelHealthRunActive(run.status))) return
    setBusy(true)
    try {
      if (pending) {
        await desktopClient.cancelModelHealth(pending, pending)
        pendingOperationIdRef.current = null
        stagingRef.current = false
        setConfirm(null)
      }
      if (run && isModelHealthRunActive(run.status)) {
        const result = await desktopClient.cancelModelHealth(run.runId, run.runId)
        setState(current => replaceModelHealthRun(current, result.run))
      }
    } catch (error) {
      setNotice(fullErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const retestItem = useCallback(async (model: ModelHealthModel): Promise<void> => {
    const run = stateRef.current.run
    if (!run || isModelHealthRunActive(run.status)) return
    const key = modelKeyOf(model)
    if (retestingModelKeysRef.current.has(key)) return
    const runId = run.runId
    const generation = generationRef.current
    const retesting = new Set(retestingModelKeysRef.current)
    retesting.add(key)
    retestingModelKeysRef.current = retesting
    setBusy(true)
    const startedAt = Date.now()
    setState(current => replaceModelHealthItem(current, {
      model,
      status: 'running',
      startedAt,
    }))
    const writeResult = (next: ModelHealthItem): void => {
      // Discard results that belong to an earlier batch: leaving the page, a
      // configuration change or a new batch invalidates the captured run.
      if (generationRef.current !== generation || activeRunIdRef.current !== runId) return
      setState(current => replaceModelHealthItem(current, next))
    }
    try {
      const result = await desktopClient.testModelProvider(
        model.providerID as never,
        model as never,
      )
      const completedAt = Date.now()
      writeResult(result.status === 'reachable'
        ? {
            model,
            status: 'healthy',
            startedAt,
            completedAt,
            latencyMs: result.latencyMs,
          }
        : {
            model,
            status: 'failed',
            startedAt,
            completedAt,
            category: result.category,
            message: result.message,
          })
    } catch {
      writeResult({
        model,
        status: 'failed',
        startedAt,
        completedAt: Date.now(),
        category: 'unknown',
        message: '模型测试失败',
      })
    } finally {
      const remaining = new Set(retestingModelKeysRef.current)
      remaining.delete(key)
      retestingModelKeysRef.current = remaining
      setBusy(false)
    }
  }, [])

  const dismissNotice = useCallback((): void => {
    setNotice(null)
  }, [])

  return {
    state,
    busy,
    confirm,
    notice,
    requestStart,
    confirmStart,
    dismissConfirm,
    cancelRun,
    retestItem,
    dismissNotice,
  }
}
