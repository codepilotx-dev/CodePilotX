type TaskboardStartResult = {
  operation: {
    threadId?: string | null
  }
}

export async function reconcileTaskboardStartSession<T extends TaskboardStartResult>(
  start: () => Promise<T>,
  reconcileSessions: () => Promise<void>,
): Promise<T> {
  const result = await start()
  if (result.operation.threadId) await reconcileSessions()
  return result
}
