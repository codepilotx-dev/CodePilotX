import { spawn } from 'child_process'
import { isAbsolute } from 'path'
import { isEnvTruthy } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { findRustShellRuntimeExecutable } from './rustShellRuntime.js'

type RustSearchCommand = 'glob' | 'grep'

type RustSearchEvent =
  | { type: 'completed'; lines: string[] }
  | { type: 'failed'; message: string }

const UNSUPPORTED_GREP_ARGS = new Set([
  '-A',
  '-B',
  '-C',
  '-U',
  '--multiline-dotall',
  '--type',
  '--context',
])

export function rustSearchCommandForArgs(
  args: string[],
): RustSearchCommand | null {
  return args.includes('--files') ? 'glob' : 'grep'
}

export function shouldUseRustSearchRuntime(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const command = rustSearchCommandForArgs(args)
  if (command === 'glob') {
    return isEnvTruthy(env.CODEPILOTX_RUST_GLOB) && canUseRustGlobArgs(args)
  }
  if (command === 'grep') {
    return isEnvTruthy(env.CODEPILOTX_RUST_GREP) && canUseRustGrepArgs(args)
  }
  return false
}

export async function tryRunRustSearchRuntime(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[] | null> {
  if (!shouldUseRustSearchRuntime(args)) {
    return null
  }

  const command = rustSearchCommandForArgs(args)
  const runtimePath = findRustShellRuntimeExecutable()
  if (!command || !runtimePath) {
    return null
  }

  try {
    return await runRustSearchRuntime(runtimePath, command, args, target, abortSignal)
  } catch (error) {
    if (abortSignal.aborted) {
      throw error
    }
    logForDebugging(`Rust ${command} runtime fallback: ${String(error)}`)
    return null
  }
}

async function runRustSearchRuntime(
  runtimePath: string,
  command: RustSearchCommand,
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
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
        reject(new Error(stderr.trim() || `Rust ${command} exited ${code}`))
        return
      }
      try {
        resolve(parseSearchEvents(stdout))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(JSON.stringify({ args, target }))
  })
}

function parseSearchEvents(stdout: string): string[] {
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const event = JSON.parse(line) as RustSearchEvent
    if (event.type === 'completed') {
      return event.lines
    }
    if (event.type === 'failed') {
      throw new Error(event.message)
    }
  }
  throw new Error('Rust search runtime did not return a completed event')
}

function canUseRustGlobArgs(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (
      arg === '--files' ||
      arg === '--sort=modified' ||
      arg === '--no-ignore' ||
      arg === '--hidden'
    ) {
      continue
    }
    if (arg === '--glob') {
      const pattern = args[++i]
      if (!pattern || hasAbsoluteGlob(pattern)) return false
      continue
    }
    return false
  }
  return true
}

function canUseRustGrepArgs(args: string[]): boolean {
  let patternCount = 0
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (UNSUPPORTED_GREP_ARGS.has(arg)) return false
    if (arg === '--hidden' || arg === '-i' || arg === '-l' || arg === '-c' || arg === '-n') {
      continue
    }
    if (arg === '--glob') {
      const pattern = args[++i]
      if (!pattern || hasAbsoluteGlob(pattern)) return false
      continue
    }
    if (arg === '--max-columns') {
      const value = args[++i]
      if (!value || !/^\d+$/.test(value)) return false
      continue
    }
    if (arg === '-e') {
      if (!args[++i]) return false
      patternCount += 1
      continue
    }
    if (arg.startsWith('-')) return false
    patternCount += 1
  }
  return patternCount === 1
}

function hasAbsoluteGlob(pattern: string): boolean {
  const raw = pattern.startsWith('!') ? pattern.slice(1) : pattern
  return isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
}
