import { expect, test } from 'bun:test'
import { appendStreamingText } from './MarkdownMessage.js'

test('streaming text appends only new chunks to one CharacterData node', () => {
  const chunks: string[] = []
  const appended: string[] = []
  const node = { appendData: (text: string) => appended.push(text) }
  const state = { processed: 0 }
  for (let tick = 0; tick < 250; tick += 1) {
    for (let index = 0; index < 40; index += 1) chunks.push('12345678901234567890')
    appendStreamingText(node, chunks, state)
  }
  expect(state.processed).toBe(10_000)
  expect(appended).toHaveLength(250)
  expect(appended.reduce((total, text) => total + text.length, 0)).toBe(200_000)
})
