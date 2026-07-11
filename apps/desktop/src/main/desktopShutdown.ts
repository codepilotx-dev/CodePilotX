export type DesktopShutdownDependencies = {
  flushRollout(): Promise<void>
  flushSessionStore(): Promise<void>
  disposeSessions(): Promise<void>
  quit(): void
  logError(step: string, error: unknown): void
}

export function createDesktopShutdown(
  dependencies: DesktopShutdownDependencies,
): () => Promise<void> {
  let shutdownPromise: Promise<void> | null = null
  return () => {
    if (!shutdownPromise) {
      shutdownPromise = runDesktopShutdown(dependencies)
    }
    return shutdownPromise
  }
}

async function runDesktopShutdown(
  dependencies: DesktopShutdownDependencies,
): Promise<void> {
  try {
    await runStep('rollout_flush', dependencies.flushRollout, dependencies.logError)
    await runStep(
      'session_store_flush',
      dependencies.flushSessionStore,
      dependencies.logError,
    )
    await runStep(
      'session_dispose',
      dependencies.disposeSessions,
      dependencies.logError,
    )
  } finally {
    dependencies.quit()
  }
}

async function runStep(
  step: string,
  operation: () => Promise<void>,
  logError: (step: string, error: unknown) => void,
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    logError(step, error)
  }
}
