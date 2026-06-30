import { expect, test } from 'bun:test'
import { desktopAgentEventToSessionEvent } from './sessionEventModel.js'

test('tool events preserve upstream tool use ids in metadata', () => {
  const call = desktopAgentEventToSessionEvent({
    type: 'tool_start',
    sessionId: 'session-1',
    toolName: 'AskUserQuestion',
    summary: 'AskUserQuestion',
    toolUseId: 'call-question-1',
  })
  const result = desktopAgentEventToSessionEvent({
    type: 'tool_result',
    sessionId: 'session-1',
    toolName: 'AskUserQuestion',
    summary: 'InputValidationError',
    toolUseId: 'call-question-1',
    isError: true,
  })

  expect(call?.metadata).toMatchObject({
    toolName: 'AskUserQuestion',
    toolUseId: 'call-question-1',
  })
  expect(result?.metadata).toMatchObject({
    toolName: 'AskUserQuestion',
    toolUseId: 'call-question-1',
    isError: true,
  })
})

test('proposed plan events preserve plan text as a session event', () => {
  const event = desktopAgentEventToSessionEvent({
    type: 'proposed_plan',
    sessionId: 'session-1',
    text: '# Plan\n\n- Step',
    streaming: false,
  })

  expect(event).toMatchObject({
    sessionId: 'session-1',
    type: 'proposed_plan',
    role: 'assistant',
    content: '# Plan\n\n- Step',
    metadata: { streaming: false },
  })
})
