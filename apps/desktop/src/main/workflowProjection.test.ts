import { expect, test } from 'bun:test'
import { DesktopWorkflowProjector } from './workflowProjection.js'
import type { DesktopAgentEvent } from '../shared/types.js'

const sessionId = 'session-1'

function projector(): DesktopWorkflowProjector {
  let id = 0
  return new DesktopWorkflowProjector({
    now: () => '2026-06-22T00:00:00.000Z',
    createId: prefix => `${prefix}-${++id}`,
  })
}

test('user message before status running still starts the turn first', () => {
  const p = projector()
  const input: DesktopAgentEvent[] = [
    { type: 'status', sessionId, status: 'idle' },
    { type: 'message', sessionId, role: 'system', text: 'init' },
    { type: 'message', sessionId, role: 'user', text: 'hi' },
    { type: 'status', sessionId, status: 'running' },
    { type: 'message', sessionId, role: 'assistant', text: 'hello' },
    { type: 'done', sessionId },
  ]

  const events = input.flatMap(event => p.project(event))

  expect(events.map(event => event.type)).toEqual([
    'thread.started',
    'turn.started',
    'item.completed',
    'item.completed',
    'turn.completed',
  ])
  expect(events[1]).toMatchObject({
    type: 'turn.started',
    threadId: sessionId,
  })
  const turnId = 'turnId' in events[1]! ? events[1]!.turnId : undefined
  expect(events[2]).toMatchObject({
    type: 'item.completed',
    turnId,
    item: {
      type: 'user_message',
      text: 'hi',
    },
  })
})

test('status running starts a turn when it arrives before item events', () => {
  const p = projector()
  const events = [
    { type: 'status', sessionId, status: 'running' } as const,
    {
      type: 'tool_start',
      sessionId,
      toolName: 'Read',
      summary: 'Reading file',
    } as const,
    {
      type: 'tool_result',
      sessionId,
      toolName: 'Read',
      summary: 'Read file',
    } as const,
    { type: 'done', sessionId } as const,
  ].flatMap(event => p.project(event))

  expect(events.map(event => event.type)).toEqual([
    'thread.started',
    'turn.started',
    'item.started',
    'item.completed',
    'turn.completed',
  ])
  expect(events[2]).toMatchObject({
    type: 'item.started',
    turnId: 'turn-1',
    item: { type: 'tool_call', toolName: 'Read' },
  })
  expect(events[3]).toMatchObject({
    type: 'item.completed',
    turnId: 'turn-1',
    item: { type: 'tool_result', toolName: 'Read' },
  })
  const startToolUseId =
    'item' in events[2]! && 'toolUseId' in events[2]!.item
      ? events[2]!.item.toolUseId
      : null
  const resultToolUseId =
    'item' in events[3]! && 'toolUseId' in events[3]!.item
      ? events[3]!.item.toolUseId
      : null
  expect(startToolUseId).toBe(resultToolUseId)
})

test('same-name tools in one turn get distinct ids and FIFO results', () => {
  const p = new DesktopWorkflowProjector({
    now: () => '2026-06-22T00:00:00.000Z',
    createId: (prefix, seed) => `${prefix}-${seed ?? 'next'}`,
  })
  const events = [
    { type: 'status', sessionId, status: 'running' } as const,
    {
      type: 'tool_start',
      sessionId,
      toolName: 'Read',
      summary: 'Reading a.ts',
    } as const,
    {
      type: 'tool_start',
      sessionId,
      toolName: 'Read',
      summary: 'Reading b.ts',
    } as const,
    {
      type: 'tool_result',
      sessionId,
      toolName: 'Read',
      summary: 'a.ts contents',
    } as const,
    {
      type: 'tool_result',
      sessionId,
      toolName: 'Read',
      summary: 'b.ts contents',
    } as const,
  ].flatMap(event => p.project(event))

  const toolEvents = events.filter(
    event =>
      'item' in event &&
      (event.item.type === 'tool_call' || event.item.type === 'tool_result'),
  )
  const toolUseIds = toolEvents.map(event =>
    'item' in event &&
    (event.item.type === 'tool_call' || event.item.type === 'tool_result')
      ? event.item.toolUseId
      : undefined,
  )
  const itemIds = toolEvents.map(event =>
    'item' in event ? event.item.id : undefined,
  )

  expect(toolUseIds).toEqual([
    'tool-use-turn-next-Read-1',
    'tool-use-turn-next-Read-2',
    'tool-use-turn-next-Read-1',
    'tool-use-turn-next-Read-2',
  ])
  expect(new Set(itemIds).size).toBe(4)
})

test('uses upstream tool use ids before generated FIFO ids', () => {
  const p = new DesktopWorkflowProjector({
    now: () => '2026-06-22T00:00:00.000Z',
    createId: (prefix, seed) => `${prefix}-${seed ?? 'next'}`,
  })
  const events = [
    { type: 'status', sessionId, status: 'running' } as const,
    {
      type: 'tool_start',
      sessionId,
      toolName: 'AskUserQuestion',
      summary: 'AskUserQuestion',
      toolUseId: 'call-question-1',
    } as const,
    {
      type: 'tool_result',
      sessionId,
      toolName: 'AskUserQuestion',
      summary: 'InputValidationError',
      toolUseId: 'call-question-1',
      isError: true,
    } as const,
  ].flatMap(event => p.project(event))

  const toolEvents = events.filter(
    event =>
      'item' in event &&
      (event.item.type === 'tool_call' || event.item.type === 'tool_result'),
  )

  expect(
    toolEvents.map(event =>
      'item' in event &&
      (event.item.type === 'tool_call' || event.item.type === 'tool_result')
        ? { id: event.item.id, toolUseId: event.item.toolUseId }
        : null,
    ),
  ).toEqual([
    {
      id: 'tool_call-call-question-1',
      toolUseId: 'call-question-1',
    },
    {
      id: 'tool_result-call-question-1',
      toolUseId: 'call-question-1',
    },
  ])
})

test('failed tool results keep readable metadata through projection', () => {
  const p = projector()
  const events = [
    { type: 'status', sessionId, status: 'running' } as const,
    {
      type: 'tool_start',
      sessionId,
      toolName: 'Glob',
      summary: 'Glob: *',
    } as const,
    {
      type: 'tool_result',
      sessionId,
      toolName: 'Glob',
      summary: 'Glob',
      isError: true,
      metadata: {
        stderr: 'ripgrep executable not found',
        output: 'Install rg or configure bundled path',
      },
    } as const,
  ].flatMap(event => p.project(event))

  const result = events.find(
    event => 'item' in event && event.item.type === 'tool_result',
  )

  expect(result).toMatchObject({
    type: 'item.completed',
    item: {
      type: 'tool_result',
      status: 'failed',
      isError: true,
      metadata: {
        stderr: 'ripgrep executable not found',
        output: 'Install rg or configure bundled path',
      },
    },
  })
})

test('permission decisions project into the active workflow turn', () => {
  const p = projector()
  p.project({ type: 'status', sessionId, status: 'running' })
  const request = {
    requestId: 'permission-1',
    toolName: 'Edit',
    input: { file_path: 'a.ts' },
    description: 'Edit a.ts',
  }

  const events = p.projectPermissionDecision(sessionId, request, {
    behavior: 'allow',
  })

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: 'item.completed',
    threadId: sessionId,
    turnId: 'turn-1',
    item: {
      type: 'permission_request',
      status: 'completed',
      request,
      metadata: { decision: 'allow' },
    },
  })
  expect(typeof events[0]?.eventId).toBe('string')
  expect(events[0]?.sequence).toBe(3)
})
