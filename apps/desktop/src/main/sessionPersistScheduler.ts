export type SessionPersistScheduler<State> = {
  requestSave(options?: { immediate?: boolean }): void
  flush(): Promise<void>
}

export function createSessionPersistScheduler<State>(options: {
  debounceMs: number
  getState(): State
  save(state: State): Promise<void>
  onError?(error: unknown): void
  onStatusChange?(status: 'saved' | 'unsaved'): void
  retryDelaysMs?: readonly number[]
  sleep?(delayMs: number): Promise<void>
}): SessionPersistScheduler<State> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let running: Promise<void> | null = null
  let lastError: unknown
  const retryDelaysMs = options.retryDelaysMs ?? [50, 150]
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))

  const clearPendingTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  const enqueueSave = () => {
    pending = true
    if (!running) {
      running = runSaves().finally(() => {
        running = null
      })
    }
  }

  const runSaves = async () => {
    while (pending) {
      pending = false
      const state = options.getState()
      let failure: unknown
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        try {
          await options.save(state)
          failure = undefined
          break
        } catch (error) {
          failure = error
          if (attempt < retryDelaysMs.length) {
            await sleep(retryDelaysMs[attempt]!)
          }
        }
      }
      if (failure !== undefined) {
        lastError = failure
        pending = true
        options.onError?.(failure)
        options.onStatusChange?.('unsaved')
        return
      }
      if (lastError !== undefined) {
        lastError = undefined
        options.onStatusChange?.('saved')
      }
    }
  }

  return {
    requestSave({ immediate = false }: { immediate?: boolean } = {}) {
      if (immediate) {
        clearPendingTimer()
        enqueueSave()
        return
      }
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        enqueueSave()
      }, options.debounceMs)
    },
    async flush() {
      if (timer) {
        clearPendingTimer()
        enqueueSave()
      }
      if (pending && !running) enqueueSave()
      while (running) {
        await running
      }
      if (lastError !== undefined) throw lastError
    },
  }
}
