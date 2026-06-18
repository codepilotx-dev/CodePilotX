import { expect, test } from 'bun:test'
import { readOpenAIStream } from './openaiCompatible.js'

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
