/**
 * SessionCoordinator —— 线程串联行/异线程并行协调器。
 *
 * 核心语义（参考 opencode SessionRunCoordinator）：
 *   - 同 key 串行：同一线程的 drain 按 FIFO 执行
 *   - 异 key 并行：不同线程可以同时 drain
 *   - run：显式 drain 请求，调用方等待结果
 *   - wake：合并式唤醒，如果已有 drain 在进行则 coalesce 到下一次
 *   - awaitIdle：等待当前 drain 链完全静默
 *
 * 状态机（per key）：
 *   idle --run/wake--> draining --run--> draining + coalesced rerun
 *   draining --wake--> draining (pending coalesced flag)
 *   draining完成 --has rerun--> draining (rerun cycle)
 *   draining完成 --no rerun--> idle
 *
 * 参考：
 *   - opencode: SessionRunCoordinator (`session/run-coordinator.ts`)
 *   - codex-main: `in_process.rs` 的序列化消息处理
 *   - claude-code-master: Task.run → Task.kill 生命周期
 */
import { randomUUID } from 'node:crypto'

// ── 类型 ─────────────────────────────────────────────────────────────────

export type CoordinatorMode = 'run' | 'wake'

export type DrainResult<A> = {
  value: A
  mode: CoordinatorMode
}

export type CoordinatorOptions<A> = {
  /** 实际的 drain 函数，接收 mode 返回结果。*/
  drain: (key: string, mode: CoordinatorMode) => Promise<A>
  /** drain 失败时的回调。*/
  onFailure?: (key: string, error: Error) => void
}

// ── 内部状态 ─────────────────────────────────────────────────────────────

type Entry<A> = {
  /** 当前 drain 完成后的 promise。*/
  done: Promise<A>
  resolve: (value: A) => void
  reject: (error: Error) => void
  mode: CoordinatorMode
  /** 是否被 coalesced rerun 标记。*/
  rerun: boolean
  /** 显式 run 的 deferred（无 rerun 时等于 done）。*/
  explicitRun: Promise<A> | null
  resolveExplicit: ((value: A) => void) | null
}

// ── Coordinator ──────────────────────────────────────────────────────────

export class SessionCoordinator<A = void> {
  private active = new Map<string, Entry<A>>()

  constructor(private readonly options: CoordinatorOptions<A>) {}

  // ── 公共 API ──────────────────────────────────────────────────────────

  /** 显式 drain 请求。调用方等待结果。同 key 串行：所有 run 共享同一轮 drain。*/
  async run(key: string): Promise<A> {
    const existing = this.active.get(key)
    if (existing) {
      // 已经在 draining → 返回与当前 drain 相同的结果（合并，不触发 rerun）
      return existing.done
    }
    // 新 drain
    return this.startDrain(key, 'run')
  }

  /** 合并式唤醒。不等待结果，多个 wake 合并为一个。*/
  async wake(key: string): Promise<void> {
    const existing = this.active.get(key)
    if (existing) {
      // 已在 draining → 标记 rerun（不改变模式）
      existing.rerun = true
      return
    }
    // 启动 drain（wake 模式）
    this.startDrain(key, 'wake')
  }

  /** 等待指定 key 的当前 drain 链完全静默。*/
  async awaitIdle(key: string): Promise<A | undefined> {
    const existing = this.active.get(key)
    if (!existing) return undefined
    return existing.done
  }

  /** 所有 key 是否都处于 idle。*/
  get isIdle(): boolean {
    return this.active.size === 0
  }

  /** 当前活跃的 key 列表。*/
  get activeKeys(): string[] {
    return Array.from(this.active.keys())
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private startDrain(key: string, initialMode: CoordinatorMode): Promise<A> {
    let resolve: (value: A) => void
    let reject: (error: Error) => void
    const done = new Promise<A>((res, rej) => {
      resolve = res
      reject = rej
    })

    const entry: Entry<A> = {
      done,
      resolve: resolve!,
      reject: reject!,
      mode: initialMode,
      rerun: false,
      explicitRun: null,
      resolveExplicit: null,
    }

    this.active.set(key, entry)
    this.executeDrain(key, entry, initialMode)

    return done
  }

  private async executeDrain(
    key: string,
    entry: Entry<A>,
    mode: CoordinatorMode,
  ): Promise<void> {
    try {
      const value = await this.options.drain(key, mode)

      if (entry.rerun) {
        // 有 coalesced rerun → 继续下一轮
        entry.rerun = false
        if (entry.resolveExplicit) {
          // 如果有显式等待，先 resolve 它
          entry.resolveExplicit(value)
          entry.explicitRun = null
          entry.resolveExplicit = null
        }
        // 下一轮使用最新的 mode
        this.executeDrain(key, entry, entry.mode)
        return
      }

      // drain 完成，无 rerun → idle
      this.active.delete(key)
      entry.resolve(value)
      if (entry.resolveExplicit) {
        entry.resolveExplicit(value)
      }
    } catch (error) {
      this.active.delete(key)
      entry.reject(error as Error)
      this.options.onFailure?.(key, error as Error)
    }
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────

function promiseWithResolvers<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
