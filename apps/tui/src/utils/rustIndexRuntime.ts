import { spawn } from 'child_process'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { findRustShellRuntimeExecutable } from './rustShellRuntime.js'

export type RustIndexBuildRequest = {
  workspace: string
  cachePath: string
  hidden: boolean
  noIgnore: boolean
  maxFiles?: number
}

export type RustIndexBuildResponse = {
  filesIndexed: number
  bytesWritten: number
}

export type RustIndexQueryRequest = {
  cachePath: string
  query: string
  limit: number
}

export type RustIndexedFileEntry = {
  path: string
  size: number
  modifiedUnixSeconds?: number
}

export type RustIndexQueryResponse = {
  matches: RustIndexedFileEntry[]
}

type RustIndexEvent =
  | { type: 'started' }
  | { type: 'buildCompleted'; filesIndexed: number; bytesWritten: number }
  | { type: 'queryCompleted'; matches: RustIndexedFileEntry[] }
  | { type: 'failed'; message: string }

export function shouldUseRustIndexSidecar(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CODEPILOTX_RUST_INDEX_SIDECAR)
}

export async function tryBuildRustIndex(
  request: RustIndexBuildRequest,
  abortSignal: AbortSignal,
): Promise<RustIndexBuildResponse | null> {
  if (!shouldUseRustIndexSidecar()) {
    return null
  }
  const runtimePath = findRustShellRuntimeExecutable()
  if (!runtimePath) {
    logForDebugging('Rust index sidecar fallback: runtime executable not found')
    return null
  }

  try {
    return await runRustIndexRuntime(runtimePath, 'index-build', request, abortSignal)
  } catch (error) {
    if (abortSignal.aborted) throw error
    logForDebugging(`Rust index sidecar fallback: ${String(error)}`)
    return null
  }
}

export async function tryQueryRustIndex(
  request: RustIndexQueryRequest,
  abortSignal: AbortSignal,
): Promise<RustIndexQueryResponse | null> {
  if (!shouldUseRustIndexSidecar()) {
    return null
  }
  const runtimePath = findRustShellRuntimeExecutable()
  if (!runtimePath) {
    logForDebugging('Rust index sidecar fallback: runtime executable not found')
    return null
  }

  try {
    return await runRustIndexRuntime(runtimePath, 'index-query', request, abortSignal)
  } catch (error) {
    if (abortSignal.aborted) throw error
    logForDebugging(`Rust index sidecar fallback: ${String(error)}`)
    return null
  }
}

async function runRustIndexRuntime<T>(
  runtimePath: string,
  command: 'index-build' | 'index-query',
  request: unknown,
  abortSignal: AbortSignal,
): Promise<T> {
  return await new Promise((resolve, reject) => {
    const child = spawn(runtimePath, [command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const abortHandler = () => {
      child.kill('SIGKILL')
    }

    abortSignal.addEventListener('abort', abortHandler, { once: true })
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.once('error', error => {
      if (settled) return
      settled = true
      abortSignal.removeEventListener('abort', abortHandler)
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      abortSignal.removeEventListener('abort', abortHandler)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Rust index exited ${code}`))
        return
      }
      try {
        resolve(parseIndexEvents<T>(stdout, command))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(JSON.stringify(request))
  })
}

function parseIndexEvents<T>(
  stdout: string,
  command: 'index-build' | 'index-query',
): T {
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const event = JSON.parse(line) as RustIndexEvent
    if (event.type === 'started') {
      continue
    }
    if (event.type === 'failed') {
      throw new Error(event.message)
    }
    if (command === 'index-build' && event.type === 'buildCompleted') {
      return {
        filesIndexed: event.filesIndexed,
        bytesWritten: event.bytesWritten,
      } as T
    }
    if (command === 'index-query' && event.type === 'queryCompleted') {
      return { matches: event.matches } as T
    }
  }
  throw new Error(`Rust ${command} runtime did not return a completed event`)
}
