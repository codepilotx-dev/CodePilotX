import { expect, test } from 'bun:test'
import {
  ensureAnthropicToolResultPairing,
  ensureToolResultPairing,
  normalizeMessagesForAPI,
} from './messages.js'

test('ensureToolResultPairing preserves results for adjacent assistant tool-use messages', () => {
  const paired = ensureToolResultPairing(
    normalizeMessagesForAPI(
      [
        assistantToolUse('msg-question', 'call_question', 'AskUserQuestion'),
        assistantToolUse('msg-search', 'call_search', 'ToolSearch'),
        userToolResult('call_question', 'Question validation failed'),
        userToolResult('call_search', 'Tool loaded'),
      ] as any,
      [],
    ),
  )

  expect(paired.map(message => message.type)).toEqual(['assistant', 'user'])
  expect(
    (paired[0]!.message.content as any[]).map(block => block.id),
  ).toEqual(['call_question', 'call_search'])
  expect(
    (paired[1]!.message.content as any[]).map(block => ({
      toolUseId: block.tool_use_id,
      isError: block.is_error,
      content: block.content,
    })),
  ).toEqual([
    {
      toolUseId: 'call_question',
      isError: undefined,
      content: 'Question validation failed',
    },
    { toolUseId: 'call_search', isError: undefined, content: 'Tool loaded' },
  ])
})

test('ensureAnthropicToolResultPairing repairs SDK message params', () => {
  const paired = ensureAnthropicToolResultPairing([
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_question', name: 'AskUserQuestion', input: {} },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_search', name: 'ToolSearch', input: {} }],
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Continue after tools.' },
        {
          type: 'tool_result',
          tool_use_id: 'call_question',
          content: 'Question validation failed',
        },
        { type: 'tool_result', tool_use_id: 'call_search', content: 'Tool loaded' },
      ],
    },
  ] as any)

  expect(paired.map(message => message.role)).toEqual(['assistant', 'user'])
  expect((paired[0]!.content as any[]).map(block => block.id)).toEqual([
    'call_question',
    'call_search',
  ])
  expect((paired[1]!.content as any[]).map(block => block.type)).toEqual([
    'tool_result',
    'tool_result',
    'text',
  ])
})

function assistantToolUse(messageId: string, id: string, name: string) {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: 'test',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [{ type: 'tool_use', id, name, input: {} }],
    },
  }
}

function userToolResult(toolUseId: string, content: string) {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    },
  }
}
