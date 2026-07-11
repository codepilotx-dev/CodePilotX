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
      const attempt = runDesktopShutdown(dependencies)
      shutdownPromise = attempt.catch(error => {
        shutdownPromise = null
        throw error
      })
    }
    return shutdownPromise
  }
}

export function createDesktopShutdownController(
  dependencies: DesktopShutdownDependencies,
): {
  handleBeforeQuit(event: { preventDefault(): void }): boolean
  readonly shutdownPromise: Promise<void> | null
} {
  let shutdownPromise: Promise<void> | null = null
  let shutdownComplete = false
  return {
    handleBeforeQuit(event) {
      if (shutdownComplete) return true
      event.preventDefault()
      if (!shutdownPromise) {
        const attempt = runDesktopShutdown(dependencies, () => {
            shutdownComplete = true
          })
        shutdownPromise = attempt.catch(error => {
          shutdownPromise = null
          throw error
        })
        void shutdownPromise.catch(() => {})
      }
      return false
    },
    get shutdownPromise() {
      return shutdownPromise
    },
  }
}

async function runDesktopShutdown(
  dependencies: DesktopShutdownDependencies,
  beforeQuit: () => void = () => {},
): Promise<void> {
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
  beforeQuit()
  dependencies.quit()
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
    throw error
  }
}
