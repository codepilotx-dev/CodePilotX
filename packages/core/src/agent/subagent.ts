/**
 * Subagent 数据模型 & Fork 协议
 *
 * 参考 codex-main v2:
 *   - Thread: `forked_from_id`, `parent_thread_id`, `agent_nickname`, `agent_role`
 *   - SessionSource::SubAgent
 *   - thread/fork API
 *
 * v4 设计：
 *   - 子代理是 first-class child thread/session
 *   - Fork 记录 `parentThreadId`, `forkedFromId`, `agentPath`, `agentRole`
 *   - Mailbox 模式：子代理只向父上下文发送 bounded completion message
 *   - Fork history 白名单：只继承 system/developer/user/final assistant
 */

import type { ThreadEvent, ThreadId } from './workflow.js'

// ── Subagent 元数据 ──────────────────────────────────────────────────────

/** 子代理的角色类型。*/
export type AgentRole = 'assistant' | 'critic' | 'planner' | 'coder' | 'reviewer' | 'custom'

/** 子代理的溯源信息。*/
export type SubagentMetadata = {
  /** 父线程 ID。*/
  parentThreadId: ThreadId
  /** 创建此子代理的 fork 源线程 ID（通常等于 parentThreadId）。*/
  forkedFromId: ThreadId
  /** 子代理的路径标识（如 "agent/coder-v2"）。*/
  agentPath: string
  /** 子代理的角色。*/
  agentRole: AgentRole
  /** 子代理的自定义名字。*/
  agentNickname?: string
  /** 子代理使用的模型。*/
  model?: string
  /** 子代理的系统提示词覆盖。*/
  systemPromptOverride?: string
}

// ── Mailbox 消息 ────────────────────────────────────────────────────────

/** 子代理返回给父线程的结构化完成消息。*/
export type SubagentCompletionMessage = {
  /** 消息类型。*/
  type: 'subagent.completed' | 'subagent.failed' | 'subagent.interrupted'
  /** 子代理 ID。*/
  agentId: ThreadId
  /** 摘要文本（bounded，非完整 transcript）。*/
  summary: string
  /** 关键输出（可选，结构化数据）。*/
  output?: Record<string, unknown>
  /** 错误信息（仅 failed 时）。*/
  error?: string
  /** Token 使用统计。*/
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

// ── Fork 历史白名单 ─────────────────────────────────────────────────────

/** Fork 时继承的事件类型白名单。*/
export const FORK_HISTORY_ALLOWED_EVENT_TYPES = new Set<string>([
  'thread.started',
  'turn.started',
  'turn.completed',
])

/** Fork 时继承的 turn item type 白名单（只保留稳定内容）。*/
export const FORK_HISTORY_ALLOWED_ITEM_TYPES = new Set<string>([
  'user',
  'agent_message',
  'proposed_plan',
  'text',
])

/**
 * 判断 ThreadEvent 是否应在 fork 时被继承。
 * 根据白名单原则：只继承稳定 system/developer/user/final assistant 内容。
 */
export function shouldIncludeInForkHistory(event: ThreadEvent): boolean {
  if (FORK_HISTORY_ALLOWED_EVENT_TYPES.has(event.type)) return true
  if (event.type === 'item.completed') {
    const item = (event as any).item
    if (item && FORK_HISTORY_ALLOWED_ITEM_TYPES.has(item.type)) return true
  }
  return false
}

// ── 子代理线程事件 ─────────────────────────────────────────────────────

/**
 * 创建子代理相关的 thread event 类型。
 * 这些事件被注入到父上下文的 event stream 中，但内容 bounded。
 */
export function createSubagentStartedEvent(
  agentId: ThreadId,
  parentThreadId: ThreadId,
  metadata: Omit<SubagentMetadata, 'parentThreadId'>,
): ThreadEvent {
  return {
    schemaVersion: 1,
    eventId: `subagent-started-${agentId}`,
    sequence: 0,
    type: 'turn.started',
    threadId: parentThreadId,
    turnId: agentId,
    createdAt: new Date().toISOString(),
    input: `Agent: ${metadata.agentRole} (${metadata.agentPath})`,
    metadata: {
      subagent: true,
      agentId,
      agentRole: metadata.agentRole,
      agentPath: metadata.agentPath,
    },
  } as ThreadEvent
}

/**
 * 创建子代理完成事件（bounded 信息，非完整 transcript）。
 */
export function createSubagentCompletionEvent(
  message: SubagentCompletionMessage,
  parentThreadId: ThreadId,
): ThreadEvent {
  return {
    schemaVersion: 1,
    eventId: `subagent-${message.type}-${message.agentId}`,
    sequence: 0,
    type: 'turn.completed',
    threadId: parentThreadId,
    turnId: message.agentId,
    createdAt: new Date().toISOString(),
    finalResponse: message.summary,
    metadata: {
      subagent: true,
      type: message.type,
      agentId: message.agentId,
      output: message.output,
      error: message.error,
      usage: message.usage,
    },
  } as ThreadEvent
}
