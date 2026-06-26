import { expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { ensureToolUseResultsForNextTurn } from './query.js'
import { createUserMessage } from './utils/messages.js'

test('adds synthetic error results for missing tool uses before the next turn', () => {
  const toolUses: ToolUseBlock[] = [
    {
      type: 'tool_use',
      id: 'call-question-1',
      name: 'AskUserQuestion',
      input: {},
    },
    {
      type: 'tool_use',
      id: 'call-search-1',
      name: 'ToolSearch',
      input: {},
    },
  ]
  const existingResult = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call-search-1',
        content: 'ToolSearch completed',
      },
    ],
  })

  const results = ensureToolUseResultsForNextTurn(toolUses, [existingResult])

  expect(results).toHaveLength(2)
  expect(results[0]).toBe(existingResult)
  expect(results[1]).toMatchObject({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-question-1',
          is_error: true,
          content: expect.stringContaining('AskUserQuestion'),
        },
      ],
    },
  })
})
