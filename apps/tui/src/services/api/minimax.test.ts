import { expect, test } from 'bun:test'
import { streamText } from 'ai'
import {
  createAnthropicCompatibleAiSdkProvider,
  findUnsupportedMiniMaxInput,
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
    'user',
  ])
  expect((converted[0]!.content as any[]).map(part => part.toolCallId)).toEqual(
    ['call_question', 'call_search'],
  )
  expect((converted[3]!.content as any[])[0]!.text).toContain(
    'Tool AskUserQuestion completed',
  )
  expect((converted[3]!.content as any[])[1]!.text).toContain(
    'Tool ToolSearch completed',
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
  expect((converted[2]!.content as any[])[0]!.text).toContain(
    'Tool AskUserQuestion failed',
  )
  expect((converted[2]!.content as any[])[1]!.text).toBe(
    'Continue after the tool result.',
  )
})

test('toAiSdkMessages mirrors successful tool results as readable user context', () => {
  const converted = toAiSdkMessages(
    [
      assistantToolUse('call_glob', 'Glob'),
      userToolResult(
        'call_glob',
        'apps\\desktop\\package.json\npackage.json',
      ),
    ] as any,
    [] as any,
  )

  expect(converted.map(message => message.role)).toEqual([
    'assistant',
    'tool',
    'user',
  ])
  expect((converted[1]!.content as any[])[0]).toMatchObject({
    type: 'tool-result',
    toolCallId: 'call_glob',
    toolName: 'Glob',
    output: {
      type: 'text',
    },
  })
  expect((converted[1]!.content as any[])[0]!.output.value).toContain(
    'Tool Glob completed successfully.',
  )
  expect((converted[1]!.content as any[])[0]!.output.value).toContain(
    'Tool call id: call_glob',
  )
  expect((converted[1]!.content as any[])[0]!.output.value).toContain(
    'apps\\desktop\\package.json',
  )
  expect(converted[2]!.content).toContain('Tool Glob completed successfully.')
  expect(converted[2]!.content).toContain('apps\\desktop\\package.json')
})

test('findUnsupportedMiniMaxInput rejects image and document attachments', () => {
  expect(
    findUnsupportedMiniMaxInput([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'aW1hZ2U=',
              },
            },
          ],
        },
      },
    ] as any),
  ).toContain('does not support image input')

  expect(
    findUnsupportedMiniMaxInput([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'cGRm',
              },
            },
          ],
        },
      },
    ] as any),
  ).toContain('does not support document input')
})

test('anthropic-compatible request embeds readable tool result in tool_result content', async () => {
  let requestBody = ''
  const provider = createAnthropicCompatibleAiSdkProvider({
    provider: {
      providerID: 'minimax',
      displayName: 'MiniMax',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
    },
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      requestBody = String(init?.body ?? '')
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
    system: 'test',
    messages: toAiSdkMessages(
      [
        {
          type: 'user',
          message: { content: '查找 package.json' },
        },
        assistantToolUse('call_glob', 'Glob'),
        userToolResult(
          'call_glob',
          'apps\\desktop\\package.json\npackage.json',
        ),
      ] as any,
      [] as any,
    ),
    tools: {},
    maxOutputTokens: 128,
  })
  for await (const _part of result.fullStream) {
    // Consume the stream to force the request through the fake fetch.
  }

  const request = JSON.parse(requestBody) as {
    messages: Array<{ role: string; content: unknown }>
  }
  const contentParts = request.messages.flatMap(message =>
    Array.isArray(message.content) ? message.content : [],
  ) as Array<Record<string, unknown>>
  const toolUseIds = contentParts
    .filter(part => part.type === 'tool_use')
    .map(part => part.id)
  const toolResults = contentParts.filter(
    part =>
      part.type === 'tool_result' && part.tool_use_id === 'call_glob',
  )

  expect(toolUseIds.filter(id => id === 'call_glob')).toHaveLength(1)
  expect(toolResults).toHaveLength(1)
  expect(toolResults[0]!.tool_use_id).toBe('call_glob')
  expect(String(toolResults[0]!.content)).toContain(
    'Tool Glob completed successfully.',
  )
  expect(String(toolResults[0]!.content)).toContain('Tool call id: call_glob')
  expect(String(toolResults[0]!.content)).toContain(
    'apps\\desktop\\package.json',
  )
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

test('anthropic-compatible minimax provider normalizes official MiniMax Anthropic base URLs for AI SDK', async () => {
  for (const [baseURL, expectedURL] of [
    [
      'https://api.minimaxi.com/anthropic',
      'https://api.minimaxi.com/anthropic/v1/messages',
    ],
    [
      'https://api.minimax.io/anthropic',
      'https://api.minimax.io/anthropic/v1/messages',
    ],
  ] as const) {
    let seenURL = ''
    const provider = createAnthropicCompatibleAiSdkProvider({
      provider: {
        providerID: 'minimax',
        displayName: 'MiniMax',
        baseURL,
      },
      apiKey: 'test-key',
      fetch: async (input, _init) => {
        seenURL = String(input)
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
      messages: [{ role: 'user', content: 'ping' }],
      maxOutputTokens: 128,
    })
    for await (const _part of result.fullStream) {
      // Consume the stream to force the request through the fake fetch.
    }

    expect(seenURL).toBe(expectedURL)
  }
})

test('anthropic-compatible minimax provider falls back from minimaxi.com timeout to minimax.io', async () => {
  const seenUrls: string[] = []
  const provider = createAnthropicCompatibleAiSdkProvider({
    provider: {
      providerID: 'minimax',
      displayName: 'MiniMax',
      baseURL: 'https://api.minimaxi.com/anthropic/v1/',
    },
    apiKey: 'test-key',
    fetch: async (input, _init) => {
      const url = String(input)
      seenUrls.push(url)
      if (url.includes('api.minimaxi.com')) {
        throw new Error('Connect Timeout Error')
      }
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
    messages: [{ role: 'user', content: 'ping' }],
    tools: {},
    maxOutputTokens: 128,
  })
  for await (const _part of result.fullStream) {
    // Consume the stream to force the request through the fake fetch.
  }

  expect(seenUrls).toEqual([
    'https://api.minimaxi.com/anthropic/v1/messages',
    'https://api.minimax.io/anthropic/v1/messages',
  ])
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
