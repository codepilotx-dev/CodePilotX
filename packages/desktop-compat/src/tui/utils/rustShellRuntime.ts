import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { createInterface } from 'readline'
import treeKill from 'tree-kill'
import { isEnvTruthy } from './envUtils.js'
import { formatDuration } from './format.js'
import { TaskOutput } from './task/TaskOutput.js'
import type { ExecResult, ShellCommand } from './ShellCommand.js'

export type RustShellRuntimeEligibility = {
  shouldUseSandbox: boolean
  shouldAutoBackground: boolean
  hasStdoutCallback: boolean
}

export function shouldUseRustShellRuntime({
  shouldUseSandbox,
  shouldAutoBackground,
  hasStdoutCallback,
}: RustShellRuntimeEligibility): boolean {
  return (
    isEnvTruthy(process.env.CODEPILOTX_RUST_SHELL) &&
    !shouldUseSandbox &&
    !shouldAutoBackground &&
    !hasStdoutCallback
  )
}

export type RustShellCommandRequest = {
  runtimePath: string
  spawnBinary: string
  shellArgs: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  taskOutput: TaskOutput
  abortSignal: AbortSignal
  windowsHide: boolean
}

type RustShellEvent =
  | { type: 'started'; pid: number }
  | { type: 'exited'; code: number }
  | { type: 'timedOut' }
  | { type: 'failed'; message: string }

const SIGKILL = 137
const SIGTERM = 143

type RustShellRuntimeSearchOptions = {
  cwd?: string
  execPath?: string
  env?: NodeJS.ProcessEnv
}

export function findRustShellRuntimeExecutable(
  options: RustShellRuntimeSearchOptions = {},
): string | null {
  const env = options.env ?? process.env
  const override =
    env.CODEPILOTX_RUST_RUNTIME_PATH ?? env.CODEPILOTX_RUST_SHELL_RUNTIME_PATH
  if (override && existsSync(override)) {
    return override
  }

  const binaryName =
    process.platform === 'win32' ? 'codepilotx-runtime.exe' : 'codepilotx-runtime'
  const cwd = options.cwd ?? process.cwd()
  const execPath = options.execPath ?? process.execPath
  const candidates = [
    resolve(cwd, 'rust', 'codepilotx-runtime', 'target', 'debug', binaryName),
    resolve(
      dirname(execPath),
      '..',
      '..',
      'rust',
      'codepilotx-runtime',
      'target',
      'debug',
      binaryName,
    ),
  ]
  return (
    candidates.find(candidate => existsSync(candidate)) ?? null
  )
}

export function getRustShellRuntimeDevPath(root: string): string {
  return resolve(
    root,
    'rust',
    'codepilotx-runtime',
    'target',
    'debug',
    process.platform === 'win32' ? 'codepilotx-runtime.exe' : 'codepilotx-runtime',
  )
}

export function spawnRustShellCommand(
  request: RustShellCommandRequest,
): ShellCommand {
  return new RustShellCommand(request)
}

function envRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

function prependStderr(prefix: string, stderr: string): string {
  return stderr ? `${prefix} ${stderr}` : prefix
}

class RustShellCommand implements ShellCommand {
  #childProcess: ChildProcessWithoutNullStreams
  #abortSignal: AbortSignal
  #boundAbortHandler: (() => void) | null = null
  #resultResolver: ((result: ExecResult) => void) | null = null
  #backgroundTaskId: string | undefined
  #status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  #settled = false
  #timedOut = false
  #failedMessage = ''
  #exitCode = 1
  #shellPid: number | null = null
  readonly taskOutput: TaskOutput
  readonly result: Promise<ExecResult>

  constructor(private readonly request: RustShellCommandRequest) {
    this.#abortSignal = request.abortSignal
    this.taskOutput = request.taskOutput
    this.#childProcess = spawn(request.runtimePath, ['shell-run'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.result = new Promise<ExecResult>(resolve => {
      this.#resultResolver = resolve
    })
    this.#wireEvents()
    this.#sendRequest()
  }

  get status(): 'running' | 'backgrounded' | 'completed' | 'killed' {
    return this.#status
  }

  #wireEvents(): void {
    this.#boundAbortHandler = this.#abortHandler.bind(this)
    this.#abortSignal.addEventListener('abort', this.#boundAbortHandler, {
      once: true,
    })

    const rl = createInterface({
      input: this.#childProcess.stdout,
      crlfDelay: Infinity,
    })
    rl.on('line', line => {
      if (!line.trim()) return
      try {
        this.#handleEvent(JSON.parse(line) as RustShellEvent)
      } catch {
        this.#failedMessage = `Invalid rust shell runtime event: ${line}`
      }
    })
    this.#childProcess.stderr.on('data', chunk => {
      this.#failedMessage += String(chunk)
    })
    this.#childProcess.once('error', error => {
      this.#failedMessage = error.message
      void this.#resolve(1)
    })
    this.#childProcess.once('exit', code => {
      rl.close()
      void this.#resolve(code ?? this.#exitCode)
    })
  }

  #sendRequest(): void {
    const body = JSON.stringify({
      spawnBinary: this.request.spawnBinary,
      shellArgs: this.request.shellArgs,
      cwd: this.request.cwd,
      env: envRecord(this.request.env),
      timeoutMs: this.request.timeoutMs,
      outputFilePath: this.taskOutput.path,
      windowsHide: this.request.windowsHide,
    })
    this.#childProcess.stdin.end(body)
  }

  #handleEvent(event: RustShellEvent): void {
    switch (event.type) {
      case 'started':
        this.#shellPid = event.pid
        return
      case 'exited':
        this.#exitCode = event.code
        return
      case 'timedOut':
        this.#timedOut = true
        this.#exitCode = SIGTERM
        return
      case 'failed':
        this.#failedMessage = event.message
        this.#exitCode = 1
        return
    }
  }

  #abortHandler(): void {
    if (this.#abortSignal.reason === 'interrupt') {
      return
    }
    this.kill()
  }

  async #resolve(code: number): Promise<void> {
    if (this.#settled) return
    this.#settled = true
    this.#cleanupListeners()
    if (this.#status === 'running' || this.#status === 'backgrounded') {
      this.#status = 'completed'
    }

    const stdout = await this.taskOutput.getStdout()
    const result: ExecResult = {
      code: this.#timedOut ? SIGTERM : code,
      stdout,
      stderr: this.taskOutput.getStderr(),
      interrupted: this.#status === 'killed',
      backgroundTaskId: this.#backgroundTaskId,
    }

    if (this.taskOutput.stdoutToFile && !this.#backgroundTaskId) {
      if (this.taskOutput.outputFileRedundant) {
        void this.taskOutput.deleteOutputFile()
      } else {
        result.outputFilePath = this.taskOutput.path
        result.outputFileSize = this.taskOutput.outputFileSize
        result.outputTaskId = this.taskOutput.taskId
      }
    }

    if (this.#timedOut) {
      result.stderr = prependStderr(
        `Command timed out after ${formatDuration(this.request.timeoutMs)}`,
        result.stderr,
      )
    } else if (this.#failedMessage.trim()) {
      result.stderr = prependStderr(this.#failedMessage.trim(), result.stderr)
    }

    this.#resultResolver?.(result)
    this.#resultResolver = null
  }

  #cleanupListeners(): void {
    const boundAbortHandler = this.#boundAbortHandler
    if (boundAbortHandler) {
      this.#abortSignal.removeEventListener('abort', boundAbortHandler)
      this.#boundAbortHandler = null
    }
  }

  kill(): void {
    this.#status = 'killed'
    if (this.#shellPid !== null) {
      treeKill(this.#shellPid, 'SIGKILL')
    }
    if (!this.#childProcess.killed) {
      this.#childProcess.kill('SIGKILL')
    }
    void this.#resolve(SIGKILL)
  }

  background(taskId: string): boolean {
    if (this.#status !== 'running') return false
    this.#backgroundTaskId = taskId
    this.#status = 'backgrounded'
    this.#cleanupListeners()
    return true
  }

  cleanup(): void {
    this.#cleanupListeners()
    this.taskOutput.clear()
  }

  onTimeout?: (
    callback: (backgroundFn: (taskId: string) => boolean) => void,
  ) => void
}
