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
    if (!child.killed) {
      child.kill()
    }
    if (await exitMonitor.wait(timeoutMs)) return

    const forceKill = options.forceKill ?? (candidate =>
      forceKillChild(candidate, options.platform ?? process.platform))
    await forceKill(child)
    if (await exitMonitor.wait(timeoutMs)) return
    throw new Error(`Child process ${child.pid ?? 'unknown'} did not exit after force kill`)
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
): Promise<void> {
  if (platform !== 'win32' || child.pid == null) {
    child.kill('SIGKILL')
    return
  }
  await new Promise<void>((resolve, reject) => {
    const taskkill = spawn(
      'taskkill',
      ['/pid', String(child.pid), '/t', '/f'],
      { windowsHide: true, stdio: 'ignore' },
    )
    taskkill.once('error', reject)
    taskkill.once('exit', code => {
      if (code === 0 || hasExited(child)) {
        resolve()
      } else {
        reject(new Error(`taskkill exited with code ${code}`))
      }
    })
  })
}
