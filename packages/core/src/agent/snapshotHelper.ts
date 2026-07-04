/**
 * SnapshotHelper —— 从 EventStorePort 派生出会话快照。
 *
 * 纯逻辑组合，将 InMemoryEventStore（或其它 EventStorePort 实现）与
 * deriveWorkflowSessionView 结合，提供统一的 getSnapshot 接口。
 *
 * 参考：
 *   - TUI AppServerThreadRegistry.getSessionSnapshot
 *   - codex-main 的 snapshot 投影模式
 *   - claude-code-master 的 SessionIndex
 */

import type { ThreadId } from './workflow.js'
import { deriveWorkflowSessionView } from './workflowView.js'
import type { EventStorePort, SessionSnapshot } from './ports.js'

/** 从 EventStore 派生 Snapshot 的助手类。*/
export class EventStoreSnapshotHelper {
  constructor(private readonly store: EventStorePort) {}

  getSnapshot(threadId: ThreadId): SessionSnapshot {
    const events = this.store.getEvents(threadId)
    return {
      threadId,
      eventCount: events.length,
      updatedAt: events.at(-1)?.createdAt ?? null,
      view: deriveWorkflowSessionView(events, threadId),
    }
  }
}
