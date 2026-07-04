/**
 * InMemoryEventStore —— 纯内存事件存储实现。
 *
 * 纯逻辑，无 side effect，可被 TUI/Desktop/Sidecar 共享。
 * 用于 v2 将纯事件模型迁入 core。
 *
 * 参考：
 *   - claude-code-master 的 TaskStateBase 的 outputFile/outputOffset
 *   - opencode 的 SessionStore
 */
import type { ThreadEvent, ThreadId } from './workflow.js'
import type { EventStorePort } from './ports.js'

export class InMemoryEventStore implements EventStorePort {
  private readonly eventsByThreadId = new Map<ThreadId, ThreadEvent[]>()

  append(event: ThreadEvent): void {
    const events = this.eventsByThreadId.get(event.threadId) ?? []
    events.push(event)
    this.eventsByThreadId.set(event.threadId, events)
  }

  getEvents(threadId: ThreadId): ThreadEvent[] {
    return this.eventsByThreadId.get(threadId) ?? []
  }

  getEventCount(threadId: ThreadId): number {
    return this.eventsByThreadId.get(threadId)?.length ?? 0
  }

  clear(threadId: ThreadId): void {
    this.eventsByThreadId.delete(threadId)
  }

  /** 所有线程的事件条数总和（用于统计/调试）。*/
  get totalEventCount(): number {
    let total = 0
    for (const events of this.eventsByThreadId.values()) {
      total += events.length
    }
    return total
  }
}
