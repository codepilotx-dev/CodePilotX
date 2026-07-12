export type IdleTaskScheduler = {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
  setTimeout: (callback: () => void, delay: number) => number
  clearTimeout: (id: number) => void
}

export type LatestRequestGuard = {
  begin(): number
  isActive(): boolean
  isCurrent(generation: number): boolean
  dispose(): void
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let generation = 0
  let disposed = false
  return {
    begin: () => ++generation,
    isActive: () => !disposed,
    isCurrent: candidate => !disposed && candidate === generation,
    dispose: () => {
      disposed = true
      generation += 1
    },
  }
}

export type BrowserRequestController<T> = {
  read(request: () => Promise<T>): boolean
  open(request: () => Promise<T>): void
  runMutation(request: () => Promise<T>): void
  dispose(): void
}

export function createBrowserRequestController<T>(
  commit: (value: T) => void,
  onError: (error: unknown) => void = () => {},
): BrowserRequestController<T> {
  const guard = createLatestRequestGuard()
  let openingGeneration: number | null = null

  const run = (request: () => Promise<T>, opening: boolean): void => {
    const generation = guard.begin()
    if (opening) openingGeneration = generation
    let pending: Promise<T>
    try {
      pending = request()
    } catch (error) {
      if (guard.isCurrent(generation)) onError(error)
      if (openingGeneration === generation) openingGeneration = null
      return
    }
    void pending
      .then(value => {
        if (guard.isCurrent(generation)) commit(value)
      })
      .catch(error => {
        if (guard.isCurrent(generation)) onError(error)
      })
      .finally(() => {
        if (openingGeneration === generation) openingGeneration = null
      })
  }

  return {
    read: request => {
      if (!guard.isActive() || openingGeneration !== null) return false
      run(request, false)
      return true
    },
    open: request => run(request, true),
    runMutation: request => run(request, false),
    dispose: () => guard.dispose(),
  }
}

export function getProviderCatalogKey(state: DesktopModelProviderState): string {
  return [
    state.selectedProviderID ?? '',
    state.baseURL ?? '',
    state.apiKeyConfigured ? 'key' : 'no-key',
  ].join('\0')
}

export function canCommitProviderCatalog(
  active: boolean,
  currentCatalogKey: string | null,
  requestCatalogKey: string,
): boolean {
  return active && currentCatalogKey === requestCatalogKey
}

export function mergeBrowserStateError(
  current: DesktopBrowserState | null,
  error: unknown,
): DesktopBrowserState | null {
  if (!current) return null
  return {
    ...current,
    error: error instanceof Error ? error.message : String(error),
  }
}

export function scheduleIdleTask(
  task: () => void,
  scheduler: IdleTaskScheduler = window,
): () => void {
  if (scheduler.requestIdleCallback && scheduler.cancelIdleCallback) {
    const id = scheduler.requestIdleCallback(task, { timeout: 1500 })
    return () => scheduler.cancelIdleCallback?.(id)
  }
  const id = scheduler.setTimeout(task, 0)
  return () => scheduler.clearTimeout(id)
}
import type {
  DesktopBrowserState,
  DesktopModelProviderState,
} from '../../../shared/types.js'
