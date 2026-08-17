import { AgentError } from "../domain"

/** 释放单个运行时资源；失败只影响该 disposer 自身。 */
export type RuntimeDisposer = () => void | Promise<void>

/** scope 的释放原因，覆盖所有终态路径。 */
export type RuntimeDisposeReason = "settled" | "aborted" | "shutdown" | "failed"

/**
 * 一轮运行持有的资源租约（如 MCP turn lease、插件 generation lease）。
 * 租约在 scope 内登记，随 scope 逆序回收；release 必须幂等。
 */
export interface RuntimeLease {
  readonly id: string
  readonly generation: number
  release(): Promise<void>
}

/** 一次运行的身份绑定，用于区分主 Agent、侧边聊天与子 Agent。 */
export interface AgentRuntimeIdentity {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
}

/**
 * 每个主 Agent、侧边聊天和子 Agent 运行拥有的独立、可回收 Runtime Scope。
 *
 * 生命周期：dispose() 先停止接收新操作，再触发 abort，等待已登记操作收敛，
 * 最后按注册逆序释放 disposer。子 scope 必须先于父 scope 释放。
 */
export interface AgentRuntimeScope {
  readonly identity: AgentRuntimeIdentity
  readonly signal: AbortSignal
  readonly disposed: boolean
  /** 注册一个释放时执行的 disposer，返回同一 disposer 便于调用方复用。 */
  add(disposer: RuntimeDisposer): RuntimeDisposer
  /** 登记一个需要随 scope 收敛的操作；dispose 会等待其完成。 */
  run<T>(operation: () => Promise<T>): Promise<T>
  /** 创建子 scope；父 scope 释放前必须先释放子 scope。 */
  fork(identity: AgentRuntimeIdentity): AgentRuntimeScope
  /** 幂等释放；单个 disposer 失败不会阻止其他 disposer。 */
  dispose(reason: RuntimeDisposeReason): Promise<void>
}

export class AgentRuntimeScopeImpl implements AgentRuntimeScope {
  private readonly controller = new AbortController()
  private readonly disposers: RuntimeDisposer[] = []
  private readonly pending = new Set<Promise<unknown>>()
  private readonly children = new Set<AgentRuntimeScopeImpl>()
  private releaseState: { promise: Promise<void>; reason: RuntimeDisposeReason } | null = null

  constructor(
    readonly identity: AgentRuntimeIdentity,
    private readonly parent?: AgentRuntimeScopeImpl,
  ) {
    if (parent) {
      if (parent.disposed) {
        throw new AgentError("RUNTIME_SCOPE_DISPOSED", "父 Runtime Scope 已释放，无法创建子 scope", 409)
      }
      parent.children.add(this)
      parent.signal.addEventListener("abort", () => this.controller.abort(), { once: true })
    }
  }

  get signal() {
    return this.controller.signal
  }

  get disposed() {
    return this.releaseState !== null
  }

  add(disposer: RuntimeDisposer): RuntimeDisposer {
    if (this.disposed) {
      throw new AgentError("RUNTIME_SCOPE_DISPOSED", "Runtime Scope 已释放，无法注册新的 disposer", 409)
    }
    this.disposers.push(disposer)
    return disposer
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) {
      throw new AgentError("RUNTIME_SCOPE_DISPOSED", "Runtime Scope 已释放，无法开始新的操作", 409)
    }
    const task = Promise.resolve().then(operation)
    this.pending.add(task)
    try {
      return await task
    } finally {
      this.pending.delete(task)
    }
  }

  fork(identity: AgentRuntimeIdentity): AgentRuntimeScope {
    return new AgentRuntimeScopeImpl(identity, this)
  }

  dispose(reason: RuntimeDisposeReason): Promise<void> {
    if (this.releaseState) return this.releaseState.promise
    const promise = this.release(reason)
    this.releaseState = { promise, reason }
    return promise
  }

  private async release(reason: RuntimeDisposeReason): Promise<void> {
    // 1. 停止接收新操作并触发 abort。
    this.controller.abort()
    // 2. 子 scope 先于父 scope 释放。
    const children = [...this.children]
    this.children.clear()
    await Promise.allSettled(children.map((child) => child.dispose(reason)))
    // 3. 等待已登记操作收敛。
    await Promise.allSettled([...this.pending])
    this.pending.clear()
    // 4. 按注册逆序释放 disposer；单个失败不阻止其他 disposer。
    const failures: unknown[] = []
    for (const disposer of this.disposers.reverse()) {
      try {
        await disposer()
      } catch (cause) {
        failures.push(cause)
      }
    }
    this.disposers.length = 0
    if (failures.length > 0) {
      throw new AgentError("RUNTIME_SCOPE_DISPOSE_FAILED", `Runtime Scope 释放时 ${failures.length} 个 disposer 失败`, 500)
    }
  }
}
