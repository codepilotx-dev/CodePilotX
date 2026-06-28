import { expect, test } from 'bun:test'
import { sdkMessageToThreadEvents } from './sdkEventMapping.js'
import type { WorkflowEventIds } from '@codepilotx/core/agent/workflow.js'

const ids: WorkflowEventIds = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  now: () => '2026-06-22T00:00:00.000Z',
  itemId: (kind, seed) => `${kind}-${seed ?? '1'}`,
}

test('assistant SDK message maps text to completed agent_message item', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'session-1',
      message: {
        content: [{ type: 'text', text: 'Hello' }],
      },
    },
    ids,
  )

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'agent_message-assistant-1',
      type: 'agent_message',
      status: 'completed',
      text: 'Hello',
    },
  })
})

test('tool progress SDK message maps to updated tool_call item', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'tool_progress',
      tool_use_id: 'tool-1',
      tool_name: 'Bash',
      session_id: 'session-1',
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.updated',
    item: {
      id: 'tool_call-tool-1',
      type: 'tool_call',
      status: 'in_progress',
      toolName: 'Bash',
    },
  })
})

test('assistant tool_use and user tool_result preserve one tool lifecycle', () => {
  const started = sdkMessageToThreadEvents(
    {
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: 'a.ts' },
          },
        ],
      },
    },
    ids,
  )
  const completed = sdkMessageToThreadEvents(
    {
      type: 'user',
      uuid: 'user-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'ok',
          },
        ],
      },
    },
    ids,
  )

  expect(started[0]).toMatchObject({
    type: 'item.started',
    item: {
      id: 'tool_call-tool-1',
      type: 'tool_call',
      toolName: 'Read',
      toolUseId: 'tool-1',
    },
  })
  expect(completed[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'tool_result-tool-1',
      type: 'tool_result',
      status: 'completed',
      toolUseId: 'tool-1',
    },
  })
})

test('parallel same-name SDK tool calls pair by toolUseId', () => {
  const started = sdkMessageToThreadEvents(
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-a', name: 'Read', input: {} },
          { type: 'tool_use', id: 'tool-b', name: 'Read', input: {} },
        ],
      },
    },
    ids,
  )
  const completed = sdkMessageToThreadEvents(
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-b', content: 'b' },
          { type: 'tool_result', tool_use_id: 'tool-a', content: 'a' },
        ],
      },
    },
    ids,
  )

  expect(started.map(event => ('item' in event ? event.item.toolUseId : null))).toEqual([
    'tool-a',
    'tool-b',
  ])
  expect(completed.map(event => ('item' in event ? event.item.toolUseId : null))).toEqual([
    'tool-b',
    'tool-a',
  ])
})

test('failed tool result maps readable result metadata', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'user',
      uuid: 'user-1',
      tool_use_result: {
        stderr: 'command failed',
        stdout: 'partial output',
      },
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            is_error: true,
            content: 'Bash',
          },
        ],
      },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      type: 'tool_result',
      status: 'failed',
      summary: 'Bash',
      isError: true,
      metadata: {
        content: 'Bash',
        stderr: 'command failed',
        stdout: 'partial output',
        result: {
          stderr: 'command failed',
          stdout: 'partial output',
        },
      },
    },
  })
})

test('failed tool result extracts nested readable metadata', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'user',
      uuid: 'user-1',
      tool_use_result: {
        error: { message: 'Read failed' },
        output: [{ text: 'No such file' }],
      },
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            is_error: true,
            content: 'Read',
          },
        ],
      },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      type: 'tool_result',
      status: 'failed',
      metadata: {
        content: 'Read',
        error: 'message=Read failed',
        output: 'No such file',
        result: {
          error: { message: 'Read failed' },
          output: [{ text: 'No such file' }],
        },
      },
    },
  })
})

test('tool result metadata keeps block content when no structured result exists', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'user',
      uuid: 'user-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: 'plain output' }],
          },
        ],
      },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      type: 'tool_result',
      summary: 'plain output',
      metadata: {
        content: 'plain output',
      },
    },
  })
})

test('result success and error map to terminal turn events', () => {
  expect(
    sdkMessageToThreadEvents(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done',
        stop_reason: 'end_turn',
        total_cost_usd: 0.01,
        usage: { inputTokens: 1 },
      },
      ids,
    )[0],
  ).toMatchObject({
    type: 'turn.completed',
    finalResponse: 'Done',
    stopReason: 'end_turn',
    costUsd: 0.01,
  })

  expect(
    sdkMessageToThreadEvents(
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: 'Failed',
      },
      ids,
    )[0],
  ).toMatchObject({
    type: 'turn.failed',
    error: { message: 'Failed', code: 'error_during_execution' },
  })
})

test('compact boundary maps to a reasoning item without changing turn order', () => {
  const events = sdkMessageToThreadEvents(
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'compact-1',
      compact_metadata: { trigger: 'auto', pre_tokens: 1000 },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'reasoning-compact-1',
      type: 'reasoning',
      text: 'Conversation compacted',
    },
  })
})
