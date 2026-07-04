import { expect, test } from 'bun:test'
import {
  shouldIncludeInForkHistory,
  createSubagentStartedEvent,
  createSubagentCompletionEvent,
  FORK_HISTORY_ALLOWED_EVENT_TYPES,
  FORK_HISTORY_ALLOWED_ITEM_TYPES,
} from './subagent.js'
import type { ThreadEvent } from './workflow.js'

test('fork history allows thread.started, turn.started, turn.completed', () => {
  const allowedEvents = ['thread.started', 'turn.started', 'turn.completed']
  const disallowedEvents = ['thread.stopped', 'turn.failed', 'item.started', 'item.completed']

  for (const type of allowedEvents) {
    expect(shouldIncludeInForkHistory({
      type: type as ThreadEvent['type'],
    } as ThreadEvent)).toBe(true)
  }

  for (const type of disallowedEvents) {
    expect(shouldIncludeInForkHistory({
      type: type as ThreadEvent['type'],
    } as ThreadEvent)).toBe(false)
  }
})

test('fork history allows only user/agent_message/proposed_plan/text items in item.completed', () => {
  const allowedItems = ['user', 'agent_message', 'proposed_plan', 'text']
  const disallowedItems = ['tool_use', 'tool_result', 'reasoning', 'file_change', 'error']

  for (const itemType of allowedItems) {
    expect(shouldIncludeInForkHistory({
      type: 'item.completed',
      item: { type: itemType },
    } as ThreadEvent)).toBe(true)
  }

  for (const itemType of disallowedItems) {
    expect(shouldIncludeInForkHistory({
      type: 'item.completed',
      item: { type: itemType },
    } as ThreadEvent)).toBe(false)
  }

  // item.completed without item property should be false
  expect(shouldIncludeInForkHistory({
    type: 'item.completed',
  } as ThreadEvent)).toBe(false)
})

test('createSubagentStartedEvent creates a turn.started event with subagent metadata', () => {
  const event = createSubagentStartedEvent('agent-123', 'parent-456', {
    agentPath: 'agent/coder-v2',
    agentRole: 'coder',
    forkedFromId: 'parent-456',
    agentNickname: 'code-bot',
  })

  expect(event.type).toBe('turn.started')
  expect(event.threadId).toBe('parent-456')
  expect(event.turnId).toBe('agent-123')
  expect(event.metadata).toMatchObject({
    subagent: true,
    agentId: 'agent-123',
    agentRole: 'coder',
    agentPath: 'agent/coder-v2',
  })
})

test('createSubagentCompletionEvent creates bounded completion with summary', () => {
  const event = createSubagentCompletionEvent({
    type: 'subagent.completed',
    agentId: 'agent-123',
    summary: 'Fixed the type error in coordinator.ts',
    output: { files: ['coordinator.ts'] },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  }, 'parent-456')

  expect(event.type).toBe('turn.completed')
  expect(event.threadId).toBe('parent-456')
  expect(event.turnId).toBe('agent-123')
  // 验证 bounded content — 不是完整 transcript
  expect(event.metadata?.subagent).toBe(true)
  expect(event.metadata?.type).toBe('subagent.completed')
  expect(event.metadata?.output).toEqual({ files: ['coordinator.ts'] })
  expect(event.metadata?.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
  // finalResponse 应该是 bounded summary，不是全文
  expect('finalResponse' in event).toBe(true)
  if ('finalResponse' in event) {
    expect((event as any).finalResponse).toContain('Fixed the type error')
  }
})

test('subagent failed event includes error message', () => {
  const event = createSubagentCompletionEvent({
    type: 'subagent.failed',
    agentId: 'agent-123',
    summary: 'Agent encountered an error',
    error: 'Tool execution timeout after 60s',
  }, 'parent-456')

  expect(event.metadata?.type).toBe('subagent.failed')
  expect(event.metadata?.error).toBe('Tool execution timeout after 60s')
})
