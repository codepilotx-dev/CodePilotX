import { spawn, type ChildProcess } from 'node:child_process'

export type ChildProcessTerminationOptions = {
  timeoutMs?: number
  platform?: NodeJS.Platform
  forceKill?: (child: ChildProcess) => Promise<void>
}

export async function terminateChildProcess(
  child: ChildProcess,
  options: ChildProcessTerminationOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const exitMonitor = createExitMonitor(child)
  try {
    if (exitMonitor.exited) return
    let gracefulKillError: unknown
    if (!child.killed) {
      try {
        child.kill()
      } catch (error) {
        gracefulKillError = error
      }
    }
    if (!gracefulKillError && await exitMonitor.wait(timeoutMs)) return

    const forceKill = options.forceKill ?? (candidate =>
      forceKillChild(
        candidate,
        options.platform ?? process.platform,
        timeoutMs,
      ))
    try {
      await forceKill(child)
    } catch (forceKillError) {
      if (gracefulKillError) {
        throw new AggregateError(
          [gracefulKillError, forceKillError],
          'Graceful and forceful child termination failed',
        )
      }
      throw forceKillError
    }
    if (!await exitMonitor.wait(timeoutMs)) {
      const timeoutError = new Error(
        `Child process ${child.pid ?? 'unknown'} did not exit after force kill`,
      )
      if (gracefulKillError) {
        throw new AggregateError(
          [gracefulKillError, timeoutError],
          'Graceful termination failed and force kill did not exit',
        )
      }
      throw timeoutError
    }
    if (gracefulKillError) throw gracefulKillError
  } finally {
    exitMonitor.dispose()
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode != null || child.signalCode != null
}

function createExitMonitor(child: ChildProcess): {
  readonly exited: boolean
  wait(timeoutMs: number): Promise<boolean>
  dispose(): void
} {
  let exited = hasExited(child)
  const waiters = new Set<(exited: boolean) => void>()
  const onExit = () => {
    exited = true
    for (const resolve of waiters) resolve(true)
    waiters.clear()
  }
  const onError = () => {
    // A process error is not proof that the process exited.
  }
  if (!exited) {
    child.once('exit', onExit)
    child.once('close', onExit)
    child.on('error', onError)
  }
  return {
    get exited() {
      return exited
    },
    wait(timeoutMs) {
      if (exited) return Promise.resolve(true)
      return new Promise(resolve => {
        const finish = (didExit: boolean) => {
          clearTimeout(timeout)
          waiters.delete(finish)
          resolve(didExit)
        }
        const timeout = setTimeout(() => finish(false), timeoutMs)
        waiters.add(finish)
      })
    },
    dispose() {
      child.off('exit', onExit)
      child.off('close', onExit)
      child.off('error', onError)
      for (const resolve of waiters) resolve(false)
      waiters.clear()
    },
  }
}

async function forceKillChild(
  child: ChildProcess,
  platform: NodeJS.Platform,
  timeoutMs: number,
): Promise<void> {
  if (platform !== 'win32' || child.pid == null) {
    child.kill('SIGKILL')
    return
  }
  await runWindowsTaskkill(child.pid, { timeoutMs })
}

export async function runWindowsTaskkill(
  pid: number,
  options: {
    timeoutMs?: number
    spawnTaskkill?: () => ChildProcess
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const taskkill = options.spawnTaskkill?.() ?? spawn(
    'taskkill',
    ['/pid', String(pid), '/t', '/f'],
    { windowsHide: true, stdio: 'ignore' },
  )
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      taskkill.off('error', onError)
      taskkill.off('exit', onExit)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null) => {
      cleanup()
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`taskkill exited with code ${code}`))
      }
    }
    const timeout = setTimeout(() => {
      cleanup()
      try {
        taskkill.kill()
      } catch {
        // The timeout remains the primary failure; the helper is best-effort.
      }
      reject(new Error(`taskkill timed out for pid ${pid}`))
    }, timeoutMs)
    taskkill.once('error', onError)
    taskkill.once('exit', onExit)
  })
}
