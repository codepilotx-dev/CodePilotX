export const SESSION_INDEX_REMOVAL_RETRY_DELAYS_MS = [0, 100, 500] as const

export async function disposeDesktopSessionRuntimes(
  disposers: Iterable<() => Promise<void>>,
): Promise<void> {
  await Promise.all([...disposers].map(dispose => dispose()))
}

type RemoveDesktopSessionLocalStateOptions = {
  sessionId: string
  removeIndex: (sessionId: string) => Promise<void>
  removeLocalState: () => void
  disposeRuntime: () => Promise<void>
}

export async function removeDesktopSessionLocalState(
  options: RemoveDesktopSessionLocalStateOptions,
): Promise<void> {
  await options.removeIndex(options.sessionId)
  options.removeLocalState()
  await options.disposeRuntime()
}

type DisposeDesktopSessionOptions = RemoveDesktopSessionLocalStateOptions & {
  appServerThreadId: string | null
  appServerThreadPending: boolean
  deleteThread: (threadId: string) => Promise<unknown>
  flushPersistence: () => Promise<void>
}

export async function disposeDesktopSession(
  options: DisposeDesktopSessionOptions,
): Promise<void> {
  await options.flushPersistence()
  if (options.appServerThreadId) {
    await options.deleteThread(options.appServerThreadId)
  } else if (!options.appServerThreadPending) {
    throw new Error('This desktop session is not backed by an app-server Thread.')
  }

  await removeDesktopSessionLocalState(options)
}

export async function removeSessionIndexWithRetry(
  sessionId: string,
  removeIndex: (sessionId: string) => Promise<void>,
  wait: (delayMs: number) => Promise<void> = delay =>
    new Promise(resolve => setTimeout(resolve, delay)),
): Promise<void> {
  let lastError: unknown
  for (const delayMs of SESSION_INDEX_REMOVAL_RETRY_DELAYS_MS) {
    if (delayMs > 0) await wait(delayMs)
    try {
      await removeIndex(sessionId)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to remove desktop session index entry: ${sessionId}`)
}
