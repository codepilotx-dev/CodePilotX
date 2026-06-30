export type SessionPersistScheduler<State> = {
  requestSave(options?: { immediate?: boolean }): void
  flush(): Promise<void>
}

export function createSessionPersistScheduler<State>(options: {
  debounceMs: number
  getState(): State
  save(state: State): Promise<void>
  onError?(error: unknown): void
}): SessionPersistScheduler<State> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let running: Promise<void> | null = null

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
      try {
        await options.save(options.getState())
      } catch (error) {
        options.onError?.(error)
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
      while (running) {
        await running
      }
    },
  }
}
