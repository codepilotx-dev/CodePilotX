export type SessionStoreChangeEmitter = {
  requestEmit(options?: { immediate?: boolean }): void
}

export function createSessionStoreChangeEmitter(options: {
  debounceMs: number
  emit(): void
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (timer: unknown) => void
}): SessionStoreChangeEmitter {
  const setTimer = options.setTimeout ?? setTimeout
  const clearTimer =
    options.clearTimeout ??
    ((pendingTimer: unknown) =>
      clearTimeout(pendingTimer as Parameters<typeof clearTimeout>[0]))
  let timer: unknown = null

  function clearPendingTimer(): void {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  return {
    requestEmit({ immediate = false }: { immediate?: boolean } = {}) {
      if (immediate) {
        clearPendingTimer()
        options.emit()
        return
      }
      if (timer !== null) return
      timer = setTimer(() => {
        timer = null
        options.emit()
      }, options.debounceMs)
    },
  }
}
