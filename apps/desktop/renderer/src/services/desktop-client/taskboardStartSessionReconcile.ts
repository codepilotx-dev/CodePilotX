type TaskboardStartResult = {
  operation: {
    threadId?: string | null
  }
}

type TaskboardStartSessionReconcileOptions = {
  mode?: 'continue_primary' | 'new_primary'
  prepareContinuePrimarySession?: (threadId: string) => Promise<void>
}

export async function reconcileTaskboardStartSession<T extends TaskboardStartResult>(
  start: () => Promise<T>,
  reconcileSessions: () => Promise<void>,
  options: TaskboardStartSessionReconcileOptions = {},
): Promise<T> {
  const result = await start()
  const threadId = result.operation.threadId
  if (threadId) {
    if (options.mode === 'continue_primary') {
      await options.prepareContinuePrimarySession?.(threadId)
    }
    await reconcileSessions()
  }
  return result
}
