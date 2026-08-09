import type { EventEnvelope } from '@codepilotx/agent-protocol'
import {
  applyThreadEnvelopes,
  createCanonicalThreadState,
  prependOlderThreadPage,
  reconcileLatestThreadPage,
  type CanonicalThreadState,
  type ThreadHistoryPageLike,
} from '@codepilotx/session-view'

export type CanonicalThreadIngestionCoordinatorOptions = {
  threadId: string
  initialState?: CanonicalThreadState | null
  onCommit?: (state: CanonicalThreadState) => void
}

/**
 * Owns canonical thread projection commits independently from React render
 * timing. A delivered batch resolves only after the canonical state and cache
 * have been updated, so the transport may safely acknowledge its positions.
 */
export class CanonicalThreadIngestionCoordinator {
  readonly #threadId: string
  readonly #onCommit: ((state: CanonicalThreadState) => void) | undefined
  readonly #listeners = new Set<() => void>()
  #state: CanonicalThreadState | null
  #disposed = false

  constructor(options: CanonicalThreadIngestionCoordinatorOptions) {
    this.#threadId = options.threadId
    this.#state = options.initialState ?? null
    this.#onCommit = options.onCommit
    this.getSnapshot = this.getSnapshot.bind(this)
    this.subscribe = this.subscribe.bind(this)
  }

  getSnapshot(): CanonicalThreadState | null {
    return this.#state
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  rehydrate(page: ThreadHistoryPageLike): void {
    this.#assertActive()
    this.#assertPageThread(page)
    const next = this.#state?.thread.id === this.#threadId
      ? reconcileLatestThreadPage(this.#state, page)
      : createCanonicalThreadState(page)
    this.#commit(next)
  }

  prependOlder(page: ThreadHistoryPageLike): void {
    this.#assertActive()
    this.#assertPageThread(page)
    if (!this.#state || this.#state.thread.id !== this.#threadId) {
      throw new Error('尚未加载当前会话，无法合并更早记录。')
    }
    this.#commit(prependOlderThreadPage(this.#state, page))
  }

  async deliverBatch(events: readonly EventEnvelope[]): Promise<void> {
    this.#assertActive()
    if (events.length === 0) return
    if (!this.#state || this.#state.thread.id !== this.#threadId) {
      throw new Error('尚未加载当前会话，无法提交事件批次。')
    }
    for (const event of events) {
      if (event.streamId !== this.#threadId) {
        throw new Error('事件批次包含不属于当前会话的 stream。')
      }
      if (event.threadId && event.threadId !== this.#threadId) {
        throw new Error('事件批次包含不属于当前会话的 thread。')
      }
    }
    this.#commit(applyThreadEnvelopes(this.#state, events))
  }

  dispose(): void {
    this.#disposed = true
    this.#listeners.clear()
  }

  #commit(next: CanonicalThreadState): void {
    this.#assertActive()
    if (next.thread.id !== this.#threadId) {
      throw new Error('canonical projection 返回了不匹配的会话。')
    }
    if (next === this.#state) return
    this.#state = next
    this.#onCommit?.(next)
    for (const listener of this.#listeners) listener()
  }

  #assertPageThread(page: ThreadHistoryPageLike): void {
    if (page.thread.id !== this.#threadId) {
      throw new Error('历史记录返回了不匹配的会话。')
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error('canonical thread ingestion coordinator 已停止。')
    }
  }
}
