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
  if (hasExited(child)) return
  const timeoutMs = options.timeoutMs ?? 5_000
  const gracefulExit = waitForExit(child, timeoutMs)
  if (!child.killed) {
    child.kill()
  }
  if (await gracefulExit) return

  const forceKill = options.forceKill ?? (candidate =>
    forceKillChild(candidate, options.platform ?? process.platform))
  await forceKill(child)
  if (await waitForExit(child, timeoutMs)) return
  throw new Error(`Child process ${child.pid ?? 'unknown'} did not exit after force kill`)
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode != null || child.signalCode != null
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = (exited: boolean) => {
      clearTimeout(timeout)
      child.off('exit', onExit)
      child.off('close', onExit)
      child.off('error', onError)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const onError = () => {
      // A process error is not proof that the process exited.
    }
    const timeout = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('close', onExit)
    child.on('error', onError)
  })
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
