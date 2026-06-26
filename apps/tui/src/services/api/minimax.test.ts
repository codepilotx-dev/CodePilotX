import { expect, test } from 'bun:test'
import { streamText } from 'ai'
import {
  createAnthropicCompatibleAiSdkProvider,
  toAiSdkMessages,
} from './minimax.js'

test('toAiSdkMessages coalesces adjacent assistant tool calls before tool results', () => {
  const messages = [
    assistantToolUse('call_question', 'AskUserQuestion'),
    assistantToolUse('call_search', 'ToolSearch'),
    userToolResult('call_question', 'Question validation failed'),
    userToolResult('call_search', 'Tool loaded'),
  ]

  const converted = toAiSdkMessages(messages as any, [] as any)

  expect(converted.map(message => message.role)).toEqual([
    'assistant',
    'tool',
    'tool',
  ])
  expect((converted[0]!.content as any[]).map(part => part.toolCallId)).toEqual(
    ['call_question', 'call_search'],
  )
})

test('toAiSdkMessages keeps tool results before sibling user text', () => {
  const converted = toAiSdkMessages(
    [
      assistantToolUse('call_question', 'AskUserQuestion'),
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'Continue after the tool result.' },
            {
              type: 'tool_result',
              tool_use_id: 'call_question',
              content: 'Question validation failed',
              is_error: true,
            },
          ],
        },
      },
    ] as any,
    [] as any,
  )

  expect(converted.map(message => message.role)).toEqual([
    'assistant',
    'tool',
    'user',
  ])
})

test('anthropic-compatible minimax provider sends MiniMax api key header', async () => {
  let seenHeaders: HeadersInit | undefined
  const provider = createAnthropicCompatibleAiSdkProvider({
    provider: {
      providerID: 'minimax-cn-coding-plan',
      displayName: 'MiniMax Token Plan (minimaxi.com)',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
    },
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      seenHeaders = init?.headers
      return new Response(
        [
          anthropicChunk({
            type: 'message_start',
            message: {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'MiniMax-M3',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          }),
          anthropicChunk({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
          anthropicChunk({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'ok' },
          }),
          anthropicChunk({
            type: 'content_block_stop',
            index: 0,
          }),
          anthropicChunk({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 },
          }),
          anthropicChunk({ type: 'message_stop' }),
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })

  const result = streamText({
    model: provider('MiniMax-M3'),
    prompt: 'hi',
  })
  for await (const _part of result.fullStream) {
    // Consume the stream to force the request through the fake fetch.
  }

  expect(seenHeaders).toMatchObject({
    'x-api-key': 'test-key',
  })
})

function anthropicChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n`
}

function assistantToolUse(id: string, name: string) {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id,
          name,
          input: {},
        },
      ],
    },
  }
}

function userToolResult(toolUseId: string, content: string) {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
        },
      ],
    },
  }
}
