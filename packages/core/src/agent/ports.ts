/**
 * Runtime Port Interfaces
 *
 * 定义 agent runtime 的边界抽象（ports & adapters 模式）。
 * 所有端口在 core 层以纯接口形式存在，具体实现在 TUI（sidecar 内）或
 * desktop 侧（sidecar manager）。
 *
 * 参考：
 *   - codex-main: app-server-protocol / app-server 分层
 *   - opencode: SessionRunCoordinator / SessionExecution Effect ports
 *   - claude-code-master: Task interface + TaskContext
 */

import type { ThreadEvent, ThreadId, TurnId, TurnStatus } from './workflow.js'
import type { AgentRuntimeEvent } from './runtime.js'

// ── ThreadRuntimePort ──────────────────────────────────────────────────

/** 创建/恢复线程时的设置 */
export type ThreadStartSettings = {
  cwd?: string
  model?: string
  providerID?: string
  providerBaseURL?: string
  permissionProfile?: string
  sandboxMode?: string
  approvalPolicy?: string
  permissionsRevocation?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  thinkingMode?: string
}

export type ForkOptions = {
  threadId?: ThreadId
  settings?: ThreadStartSettings
  metadata?: Record<string, unknown>
}

export type ThreadStartResult = {
  threadId: ThreadId
  status: TurnStatus
  createdAt: string
  event: ThreadEvent
}

export type ThreadResumeResult = {
  threadId: ThreadId
  state: ThreadState
  event: ThreadEvent
}

export type ThreadState = {
  threadId: ThreadId
  status: TurnStatus
  createdAt: string
  currentTurnId?: TurnId
}

export type TurnInput = {
  threadId: ThreadId
  turnId?: TurnId
  input: string | unknown[]
  uuid?: string
  isMeta?: boolean
}

/** Thread 生命周期管理端口。*/
export interface ThreadRuntimePort {
  /** 创建新会话线程。*/
  startThread(settings: ThreadStartSettings & { threadId?: ThreadId }): ThreadStartResult
  /** 恢复已有会话线程。*/
  resumeThread(threadId: ThreadId, settings: ThreadStartSettings, state?: unknown): ThreadResumeResult
  /** 从源线程 fork 出新线程。*/
  forkThread(sourceThreadId: ThreadId, options?: ForkOptions): ThreadResumeResult
  /** 提交用户输入并流式返回事件。*/
  submitTurn(input: TurnInput): AsyncGenerator<ThreadEvent, void, unknown>
  /** 中断进行中的 turn。*/
  interruptTurn(threadId: ThreadId, turnId?: string): ThreadEvent
  /** 回滚到指定 turn。*/
  rollbackTurn(threadId: ThreadId, turnId: string): ThreadEvent
}

// ── EventStorePort ─────────────────────────────────────────────────────

/** 线程事件的持久化/存储端口。*/
export interface EventStorePort {
  /** 追加事件到线程。*/
  append(event: ThreadEvent): void
  /** 获取线程的全部事件。*/
  getEvents(threadId: ThreadId): ThreadEvent[]
  /** 获取线程的事件计数。*/
  getEventCount(threadId: ThreadId): number
  /** 清空线程的事件记录。*/
  clear(threadId: ThreadId): void
}

// ── SnapshotPort ───────────────────────────────────────────────────────

import type { WorkflowSessionView } from './workflowView.js'

export type SessionSnapshot = {
  threadId: ThreadId
  eventCount: number
  updatedAt: string | null
  view: WorkflowSessionView
}

/** 从事件记录派生出会话快照的端口。*/
export interface SnapshotPort {
  /** 获取线程的会话快照。*/
  getSnapshot(threadId: ThreadId): SessionSnapshot
}

// ── EventSinkPort ─────────────────────────────────────────────────────

/** 运行时事件的分发端口。*/
export interface EventSinkPort {
  /** 发射一个运行时事件。*/
  emit(event: AgentRuntimeEvent): void
  /** 订阅运行时事件，返回 unsubscribe 函数。*/
  subscribe(callback: (event: AgentRuntimeEvent) => void): () => void
}

// ── CompositePort (组合端口) ───────────────────────────────────────────

/**
 * 组合端口 —— 将多个运行时端口聚合成一个统一的 runtime。
 * 用于 Desktop 和 TUI 统一接入 core appServer 协议。
 */
export interface AgentRuntimePort {
  readonly threads: ThreadRuntimePort
  readonly events: EventStorePort
  readonly snapshots: SnapshotPort
  readonly eventSink: EventSinkPort
}
