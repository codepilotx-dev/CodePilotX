import { randomUUID } from "node:crypto"
import type {
  DesktopTerminalEvent,
  DesktopTerminalSnapshot,
  EnsureDesktopTerminalInput,
  RunDesktopTerminalActionInput,
} from "@codepilotx/shared/desktop-terminal-ipc"
import {
  spawn as spawnPty,
  type IPty,
  type IPtyForkOptions,
  type IWindowsPtyForkOptions,
} from "node-pty"
import { applyTerminalEnvironmentDelta, createTerminalEnvironment, type TerminalEnvironmentDelta } from "./terminal-environment.js"
import { safeTerminalError, TerminalError } from "./terminal-errors.js"
import { HostProcessTreeKiller, type ProcessTreeKiller } from "./process-tree.js"
import { ShellProfileService } from "./shell-profile-service.js"
import {
  TerminalSession,
  type TerminalLaunchContext,
  type TerminalOutputMirrorSink,
} from "./terminal-session.js"

export interface TerminalLaunchContextResolver {
  resolve(threadId: string): Promise<TerminalLaunchContext>
}

export interface TerminalActionLaunch {
  context: TerminalLaunchContext
  environment: TerminalEnvironmentDelta
  command: string
}

export interface TerminalActionResolver {
  prepareAction(threadId: string, actionName: string): Promise<TerminalActionLaunch>
}

export interface TerminalPtyFactory {
  spawn(
    file: string,
    args: string[],
    options: IPtyForkOptions | IWindowsPtyForkOptions,
  ): IPty
}

export interface TerminalManagerOptions {
  contextResolver: TerminalLaunchContextResolver
  actionResolver?: TerminalActionResolver
  profiles?: ShellProfileService
  ptyFactory?: TerminalPtyFactory
  processTreeKiller?: ProcessTreeKiller
  mirrorSink?: TerminalOutputMirrorSink
  onEvent: (event: DesktopTerminalEvent) => void
  environment?: NodeJS.ProcessEnv
}

export class TerminalManager {
  readonly #contextResolver: TerminalLaunchContextResolver
  readonly #actionResolver: TerminalActionResolver | undefined
  readonly #profiles: ShellProfileService
  readonly #ptyFactory: TerminalPtyFactory
  readonly #processTreeKiller: ProcessTreeKiller
  readonly #mirrorSink: TerminalOutputMirrorSink | undefined
  readonly #onEvent: (event: DesktopTerminalEvent) => void
  readonly #environment: NodeJS.ProcessEnv
  readonly #byThread = new Map<string, TerminalSession>()
  readonly #byTerminal = new Map<string, TerminalSession>()
  readonly #threadLocks = new Map<string, Promise<void>>()
  #lifecycleGeneration = 0
  #stopping = false
  #stopPromise: Promise<void> | undefined

  constructor(options: TerminalManagerOptions) {
    this.#contextResolver = options.contextResolver
    this.#actionResolver = options.actionResolver
    this.#profiles = options.profiles ?? new ShellProfileService()
    this.#ptyFactory = options.ptyFactory ?? { spawn: spawnPty }
    this.#processTreeKiller = options.processTreeKiller ?? new HostProcessTreeKiller()
    this.#mirrorSink = options.mirrorSink
    this.#onEvent = options.onEvent
    this.#environment = options.environment ?? process.env
  }

  listProfiles() {
    return this.#profiles.list()
  }

  async ensure(input: EnsureDesktopTerminalInput): Promise<DesktopTerminalSnapshot> {
    validateThreadId(input.threadId)
    validateTerminalSize(input.cols, input.rows)
    return this.#withThreadLock(input.threadId, async () => {
      const generation = this.#activeGeneration()
      const context = await this.#contextResolver.resolve(input.threadId)
      this.#assertActiveGeneration(generation)
      const existing = this.#byThread.get(input.threadId)
      if (existing) {
        if (existing.hasContext(context)) return existing.snapshot()
        existing.markContextChanged(true)
        await existing.close("workspace-delete")
        this.#delete(existing)
        this.#assertActiveGeneration(generation)
      }
      return this.#launch(input, context, createTerminalEnvironment(this.#environment))
    })
  }

  async runAction(input: RunDesktopTerminalActionInput): Promise<DesktopTerminalSnapshot> {
    validateThreadId(input.threadId)
    validateTerminalSize(input.cols, input.rows)
    if (typeof input.actionName !== "string" || !input.actionName.trim() || input.actionName.length > 200) {
      throw new TerminalError("TERMINAL_ACTION_UNAVAILABLE", "终端 Action 标识无效")
    }
    return this.#withThreadLock(input.threadId, async () => {
      const generation = this.#activeGeneration()
      if (!this.#actionResolver) throw new TerminalError("TERMINAL_UNAVAILABLE", "终端 Action 不可用")
      const launch = await this.#actionResolver.prepareAction(input.threadId, input.actionName)
      this.#assertActiveGeneration(generation)
      if (
        launch.context.threadId !== input.threadId
        || typeof launch.command !== "string"
        || !launch.command.trim()
        || launch.command.includes("\0")
        || Buffer.byteLength(launch.command, "utf8") > 65_000
      ) {
        throw new TerminalError("TERMINAL_CONTEXT_STALE", "终端 Action 上下文无效")
      }
      const existing = this.#byThread.get(input.threadId)
      if (existing) {
        await existing.close("workspace-delete")
        this.#delete(existing)
        this.#assertActiveGeneration(generation)
      }
      const snapshot = this.#launch(
        input,
        launch.context,
        applyTerminalEnvironmentDelta(this.#environment, launch.environment),
      )
      // xterm/ConPTY submits Enter as carriage return for PowerShell, cmd and
      // POSIX interactive shells; line-feed would render without executing in PTY.
      this.write(snapshot.terminalId, snapshot.instanceId, `${launch.command}\r`)
      return snapshot
    })
  }

  #launch(
    input: EnsureDesktopTerminalInput,
    context: TerminalLaunchContext,
    environment: Record<string, string>,
  ): DesktopTerminalSnapshot {
    const profile = this.#profiles.resolve(input.profileId)
    const terminalId = randomUUID()
    const instanceId = randomUUID()
    try {
      const baseOptions: IPtyForkOptions = {
        name: "xterm-256color",
        cols: input.cols,
        rows: input.rows,
        cwd: context.target.cwd,
        env: environment,
      }
      const ptyOptions: IPtyForkOptions | IWindowsPtyForkOptions =
        process.platform === "win32"
          ? { ...baseOptions, useConpty: true, useConptyDll: false }
          : baseOptions
      const pty = this.#ptyFactory.spawn(
        profile.executable,
        [...profile.args],
        ptyOptions,
      )
      const session = new TerminalSession({
        terminalId,
        instanceId,
        profileId: profile.id,
        context,
        pty,
        processTreeKiller: this.#processTreeKiller,
        mirrorSink: this.#mirrorSink,
        onEvent: this.#onEvent,
      })
      this.#byThread.set(input.threadId, session)
      this.#byTerminal.set(terminalId, session)
      return session.snapshot()
    } catch (error) {
      throw safeTerminalError(error)
    }
  }

  attach(terminalId: string, instanceId: string, afterSequence: number): DesktopTerminalSnapshot {
    const session = this.#requireSession(terminalId, instanceId)
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) {
      throw new TerminalError("TERMINAL_CONTEXT_STALE", "终端回放位置无效")
    }
    return session.snapshot(afterSequence)
  }

  write(terminalId: string, instanceId: string, data: string): void {
    if (Buffer.byteLength(data, "utf8") > 65_536) {
      throw new TerminalError("TERMINAL_INPUT_TOO_LARGE", "终端输入过长")
    }
    this.#requireSession(terminalId, instanceId).write(data)
  }

  resize(terminalId: string, instanceId: string, cols: number, rows: number): void {
    validateTerminalSize(cols, rows)
    this.#requireSession(terminalId, instanceId).resize(cols, rows)
  }

  async close(
    terminalId: string,
    instanceId: string,
    reason: "user-close" | "task-close" | "workspace-delete",
  ): Promise<DesktopTerminalSnapshot> {
    const session = this.#requireSession(terminalId, instanceId)
    return this.#withThreadLock(session.context.threadId, async () => {
      const current = this.#requireSession(terminalId, instanceId)
      await current.close(reason)
      const snapshot = current.snapshot()
      this.#delete(current)
      return snapshot
    })
  }

  async closeThread(
    threadId: string,
    reason: "user-close" | "task-close" | "workspace-delete",
  ): Promise<{ closed: boolean }> {
    validateThreadId(threadId)
    return this.#withThreadLock(threadId, async () => {
      const session = this.#byThread.get(threadId)
      if (!session) return { closed: false }
      await session.close(reason)
      this.#delete(session)
      return { closed: true }
    })
  }

  async stopAll(reason: "app-quit" = "app-quit"): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopping = true
    this.#lifecycleGeneration += 1
    const sessions = [...this.#byTerminal.values()]
    const stopPromise = Promise.allSettled(
      sessions.map(session => session.close(reason)),
    ).then(() => {
      for (const session of sessions) this.#delete(session)
    })
    this.#stopPromise = stopPromise
    return stopPromise
  }

  #activeGeneration(): number {
    if (this.#stopping) {
      throw new TerminalError("TERMINAL_UNAVAILABLE", "应用正在关闭，终端不可用")
    }
    return this.#lifecycleGeneration
  }

  #assertActiveGeneration(generation: number): void {
    if (this.#stopping || generation !== this.#lifecycleGeneration) {
      throw new TerminalError("TERMINAL_UNAVAILABLE", "应用正在关闭，终端不可用")
    }
  }

  async #withThreadLock<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#threadLocks.get(threadId) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>(resolveTurn => { release = resolveTurn })
    const tail = previous.then(() => turn)
    this.#threadLocks.set(threadId, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#threadLocks.get(threadId) === tail) this.#threadLocks.delete(threadId)
    }
  }

  #requireSession(terminalId: string, instanceId: string): TerminalSession {
    const session = this.#byTerminal.get(terminalId)
    if (!session) throw new TerminalError("TERMINAL_NOT_FOUND", "集成终端不存在")
    if (!session.matchesInstance(instanceId)) {
      throw new TerminalError("TERMINAL_CONTEXT_STALE", "集成终端实例已变化")
    }
    return session
  }

  #delete(session: TerminalSession): void {
    this.#byTerminal.delete(session.terminalId)
    if (this.#byThread.get(session.context.threadId) === session) {
      this.#byThread.delete(session.context.threadId)
    }
  }
}

export class UnavailableTerminalLaunchContextResolver
implements TerminalLaunchContextResolver {
  async resolve(_threadId: string): Promise<TerminalLaunchContext> {
    throw new TerminalError(
      "TERMINAL_UNAVAILABLE",
      "Agent 尚未提供终端工作目录",
    )
  }
}

function validateThreadId(threadId: string): void {
  if (
    typeof threadId !== "string"
    || threadId.length < 1
    || threadId.length > 200
    || !/^[A-Za-z0-9._:-]+$/.test(threadId)
  ) {
    throw new TerminalError("TERMINAL_CONTEXT_STALE", "任务标识无效")
  }
}

function validateTerminalSize(cols: number, rows: number): void {
  if (
    !Number.isSafeInteger(cols)
    || !Number.isSafeInteger(rows)
    || cols < 2
    || cols > 500
    || rows < 1
    || rows > 300
  ) {
    throw new TerminalError("TERMINAL_INVALID_SIZE", "终端尺寸无效")
  }
}
