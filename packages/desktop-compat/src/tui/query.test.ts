import { expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  collectToolResultsForNextTurn,
  ensureToolUseResultsForNextTurn,
} from './query.js'
import {
  SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
  createAssistantMessage,
  createUserMessage,
} from './utils/messages.js'

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

test('preserves standalone tool result messages while collecting next turn context', () => {
  const toolUses: ToolUseBlock[] = [
    {
      type: 'tool_use',
      id: 'call-glob-1',
      name: 'Glob',
      input: { pattern: '**/package.json' },
    },
  ]
  const toolResult = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call-glob-1',
        content: 'apps/tui/package.json',
      },
    ],
  })

  const results = collectToolResultsForNextTurn(toolResult, [])

  expect(results).toEqual([toolResult])
  expect(ensureToolUseResultsForNextTurn(toolUses, results)).toEqual([toolResult])
})

test('returns a distinct result array so callers can replace tool results safely', () => {
  const toolUses: ToolUseBlock[] = [
    {
      type: 'tool_use',
      id: 'call-glob-1',
      name: 'Glob',
      input: { pattern: '**/package.json' },
    },
  ]
  const toolResult = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call-glob-1',
        content: 'apps/tui/package.json',
      },
    ],
  })
  const results = [toolResult]

  const pairedResults = ensureToolUseResultsForNextTurn(toolUses, results)
  results.length = 0
  results.push(...pairedResults)

  expect(results).toEqual([toolResult])
})

test('keeps real tool results in assembled next-turn messages', () => {
  const toolUses: ToolUseBlock[] = [
    {
      type: 'tool_use',
      id: 'call-glob-1',
      name: 'Glob',
      input: { pattern: '**/package.json' },
    },
  ]
  const messagesForQuery = [
    createUserMessage({ content: 'Find package manifests.' }),
  ]
  const assistantMessage = createAssistantMessage({
    content: [
      {
        type: 'tool_use',
        id: 'call-glob-1',
        name: 'Glob',
        input: { pattern: '**/package.json' },
      },
    ],
  })
  const toolResult = createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'call-glob-1',
        content: 'apps/tui/package.json',
      },
    ],
  })
  const toolResults = [toolResult]

  const pairedResults = ensureToolUseResultsForNextTurn(
    toolUses,
    toolResults,
    [assistantMessage],
  )
  toolResults.length = 0
  toolResults.push(...pairedResults)

  const nextTurnMessages = [
    ...messagesForQuery,
    assistantMessage,
    ...toolResults,
  ]
  const serialized = JSON.stringify(nextTurnMessages)

  expect(nextTurnMessages).toEqual([
    messagesForQuery[0],
    assistantMessage,
    toolResult,
  ])
  expect(serialized).toContain('apps/tui/package.json')
  expect(serialized).not.toContain(SYNTHETIC_TOOL_RESULT_PLACEHOLDER)
  expect(serialized).not.toContain('missing tool result')
})
