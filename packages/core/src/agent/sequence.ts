/**
 * Sequence / EventId 辅助工具
 *
 * 管理线程的事件序列号与 eventId 生成。纯逻辑，无 side effect。
 * 从 TUI 的 ThreadRuntime 中提取出的通用逻辑，供 core/sidecar/desktop 共享。
 *
 * 参考 codex-main: app-server 的 sequence 管理方式。
 */

import { createWorkflowId } from './workflow.js'
import type { ThreadEvent, ThreadId, WorkflowEventIds } from './workflow.js'

/** 线程级别的序列号跟踪器。*/
export class SequenceTracker {
  private readonly sequences = new Map<ThreadId, number>()

  /** 获取线程的下一个序列号并自增。*/
  next(threadId: ThreadId): number {
    const current = this.sequences.get(threadId) ?? 0
    const next = current + 1
    this.sequences.set(threadId, next)
    return next
  }

  /** 获取线程当前序列号（不改变）。*/
  current(threadId: ThreadId): number {
    return this.sequences.get(threadId) ?? 0
  }

  /** 重置线程序列号。*/
  reset(threadId: ThreadId): void {
    this.sequences.delete(threadId)
  }

  /** 创建与序列号绑定的 eventId。*/
  createEventId(threadId: ThreadId, prefix = 'event'): string {
    const seq = this.next(threadId)
    return createWorkflowId(`${prefix}-${threadId}-${seq}`)
  }

  /**
   * 创建一个 WorkflowEventIds 工厂对象，可传给 normalizeThreadEvent 等函数。
   * 这是从 TUI ThreadRuntime.ts 的 `ids` 模式提取的通用逻辑。
   */
  createEventIds(threadId: ThreadId): Pick<WorkflowEventIds, 'eventId' | 'sequence'> {
    return {
      eventId: (event: ThreadEvent, fallbackSequence?: number) => {
        const seq = fallbackSequence ?? this.next(threadId)
        return createWorkflowId('event', `${threadId}-${seq}`)
      },
      sequence: () => this.next(threadId),
    }
  }
}
