import { expect, test } from 'bun:test'
import {
  buildOpenAICompatibleProviderRequestParams,
  readOpenAIStream,
} from './openaiCompatible.js'

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
