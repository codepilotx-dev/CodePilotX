import { expect, test } from 'bun:test'
import {
  buildOpenAICompatibleFetchInit,
  buildOpenAICompatibleProviderRequestParams,
  readOpenAIStream,
  toOpenAIMessages,
} from './openaiCompatible.js'
import { SYNTHETIC_TOOL_RESULT_PLACEHOLDER } from '../../utils/messages.js'

function openAIChunk(data: object): string {
  return `data: ${JSON.stringify(data)}`
}

test('readOpenAIStream handles CRLF frames and stops at DONE without EOF', async () => {
  const encoder = new TextEncoder()
  let canceled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          [
            openAIChunk({
              choices: [{ delta: { content: 'hello' } }],
            }),
            'data: [DONE]',
            '',
          ].join('\r\n\r\n'),
        ),
      )
    },
    cancel() {
      canceled = true
    },
  })

  const result = await Promise.race([
    readOpenAIStream(
      new Response(stream, { headers: { 'x-request-id': 'req_123' } }),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('stream did not stop at DONE')), 100),
    ),
  ])

  expect(result.content).toBe('hello')
  expect(result.requestID).toBe('req_123')
  expect(canceled).toBe(true)
})

test('readOpenAIStream flushes a final frame when the provider closes without DONE', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          openAIChunk({
            choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
        ),
      )
      controller.close()
    },
  })

  const result = await readOpenAIStream(new Response(stream))

  expect(result.content).toBe('done')
  expect(result.finishReason).toBe('stop')
  expect(result.usage.input_tokens).toBe(3)
  expect(result.usage.output_tokens).toBe(2)
})

test('zhipu enabled thinking uses native thinking and max reasoning effort', () => {
  expect(
    buildOpenAICompatibleProviderRequestParams({
      providerID: 'zhipu',
      model: 'glm-5.2',
      thinkingConfig: { type: 'enabled' },
    }),
  ).toEqual({
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
  })
})

test('zhipu disabled thinking omits reasoning effort', () => {
  expect(
    buildOpenAICompatibleProviderRequestParams({
      providerID: 'zhipu',
      model: 'glm-5.2',
      thinkingConfig: { type: 'disabled' },
    }),
  ).toEqual({
    thinking: { type: 'disabled' },
  })
})

test('zhipu zero temperature uses deterministic sampling flag', () => {
  expect(
    buildOpenAICompatibleProviderRequestParams({
      providerID: 'zhipu',
      model: 'glm-5.2',
      thinkingConfig: { type: 'disabled' },
      temperatureOverride: 0,
    }),
  ).toEqual({
    thinking: { type: 'disabled' },
    do_sample: false,
  })
})

test('zhipu chat request uses configured proxy fetch options', () => {
  const originalHTTPProxy = process.env.HTTP_PROXY
  const originalHttpProxy = process.env.http_proxy
  delete process.env.http_proxy
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890'
  try {
    const init = buildOpenAICompatibleFetchInit({
      apiKey: 'test-key',
      isDeepSeek: false,
      signal: new AbortController().signal,
    })

    expect(init).toMatchObject(
      typeof Bun !== 'undefined'
        ? { proxy: 'http://127.0.0.1:7890' }
        : { dispatcher: expect.anything() },
    )
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    })
  } finally {
    restoreEnv('HTTP_PROXY', originalHTTPProxy)
    restoreEnv('http_proxy', originalHttpProxy)
  }
})

test('readOpenAIStream accumulates zhipu reasoning, tool calls, and cached tokens', async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          [
            openAIChunk({
              choices: [
                {
                  delta: {
                    reasoning_content: 'think',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'read_file', arguments: '{"p"' },
                      },
                    ],
                  },
                },
              ],
            }),
            openAIChunk({
              choices: [
                {
                  delta: {
                    content: 'done',
                    tool_calls: [
                      {
                        index: 0,
                        function: { arguments: ':"x"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                prompt_tokens_details: { cached_tokens: 7 },
              },
            }),
            'data: [DONE]',
            '',
          ].join('\n\n'),
        ),
      )
    },
  })

  const result = await readOpenAIStream(new Response(stream))

  expect(result.reasoningContent).toBe('think')
  expect(result.content).toBe('done')
  expect(result.finishReason).toBe('tool_calls')
  expect(result.toolCalls).toEqual([
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"p":"x"}' },
    },
  ])
  expect(result.usage.input_tokens).toBe(10)
  expect(result.usage.cache_read_input_tokens).toBe(7)
})

test('toOpenAIMessages coalesces adjacent assistant tool calls before tool results', () => {
  const converted = toOpenAIMessages(
    [
      assistantToolUse('call_question', 'AskUserQuestion'),
      assistantToolUse('call_search', 'ToolSearch'),
      userToolResult('call_question', 'Question validation failed'),
      userToolResult('call_search', 'Tool loaded'),
    ] as any,
    'deepseek',
  )

  expect(converted.map(message => message.role)).toEqual([
    'assistant',
    'tool',
    'tool',
  ])
  expect(converted[0]).toMatchObject({
    role: 'assistant',
    tool_calls: [
      { id: 'call_question', function: { name: 'AskUserQuestion' } },
      { id: 'call_search', function: { name: 'ToolSearch' } },
    ],
  })
})

test('toOpenAIMessages keeps tool results before sibling user text', () => {
  const converted = toOpenAIMessages(
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
    'deepseek',
  )

  expect(converted.map(message => message.role)).toEqual([
    'assistant',
    'tool',
    'user',
  ])
})

test('toOpenAIMessages preserves real tool result content', () => {
  const converted = toOpenAIMessages(
    [
      assistantToolUse('call_glob', 'Glob'),
      userToolResult('call_glob', 'apps/tui/package.json'),
    ] as any,
    'deepseek',
  )
  const serialized = JSON.stringify(converted)

  expect(converted).toEqual([
    expect.objectContaining({
      role: 'assistant',
      tool_calls: [
        expect.objectContaining({
          id: 'call_glob',
          function: expect.objectContaining({ name: 'Glob' }),
        }),
      ],
    }),
    {
      role: 'tool',
      tool_call_id: 'call_glob',
      content: 'apps/tui/package.json',
    },
  ])
  expect(serialized).toContain('apps/tui/package.json')
  expect(serialized).not.toContain(SYNTHETIC_TOOL_RESULT_PLACEHOLDER)
  expect(serialized).not.toContain('missing tool result')
})

test('toOpenAIMessages maps image attachments to image_url data URLs', () => {
  const converted = toOpenAIMessages(
    [
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'inspect this' },
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
    ] as any,
    'deepseek',
  )

  expect(converted).toEqual([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'inspect this' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
        },
      ],
    },
  ])
})

test('toOpenAIMessages rejects document attachments explicitly', () => {
  expect(() =>
    toOpenAIMessages(
      [
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
      ] as any,
      'deepseek',
    ),
  ).toThrow('Document/PDF attachments are not supported')
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
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
