import { expect, test } from 'bun:test'
import {
  handleSessionAgentEvent,
  isDurableSessionAgentEvent,
  transientStreamRetainedChars,
  appendTransientStreamChunk,
} from './sessionEvents.js'
import { createEmptySessionView } from './sessionViewState.js'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
} from '../../../main/rustAppServerWorkflowAdapter.js'
import type { DesktopAgentEvent } from '../../../shared/types.js'
import type { SessionViewState } from '../../uiTypes.js'

test('partial assistant updates stay outside renderer event history', () => {
  const partial: DesktopAgentEvent = {
    type: 'partial_message',
    sessionId: 'session-1',
    text: 'streaming',
  }
  const final: DesktopAgentEvent = {
    type: 'message',
    sessionId: 'session-1',
    role: 'assistant',
    text: 'final',
  }

  expect(isDurableSessionAgentEvent(partial)).toBe(false)
  expect(isDurableSessionAgentEvent(final)).toBe(true)
})

test('renderer retains time-spread deltas as linear chunks without cumulative text copies', () => {
  let chunks: string[] = []
  for (let tick = 0; tick < 250; tick += 1) {
    for (let index = 0; index < 40; index += 1) {
      chunks = appendTransientStreamChunk(
        chunks,
        '12345678901234567890',
        true,
      )
    }
  }
  expect(chunks).toHaveLength(10_000)
  expect(transientStreamRetainedChars(chunks)).toBe(200_000)
  expect(chunks.every(chunk => chunk.length === 20)).toBe(true)
})

test('assistant and reasoning streams are removed at terminal and a new generation can stream', () => {
  const sessionId = 'session-integration'
  const views: Record<string, SessionViewState> = {
    [sessionId]: createEmptySessionView(),
  }
  const apply = (event: DesktopAgentEvent) => {
    handleSessionAgentEvent(event, {
      activeSessionIdRef: { current: sessionId },
      setSessions: () => {},
      setSessionStatus: () => {},
      updateSessionView: (id, updater) => { views[id] = updater(views[id] ?? createEmptySessionView()) },
      addToolLogEntry: () => {},
      onErrorRef: { current: () => {} },
      onDiffForActiveRef: { current: () => {} },
      onRefreshActiveWorkspaceRef: { current: () => {} },
      onOpenDrawerPermissionsRef: { current: () => {} },
    })
  }
  const state = createRustAppServerWorkflowState()
  handleServerNotification('turn/started', { turn: { id: 'turn-1' } }, apply, state, sessionId)
  handleServerNotification('item/agentMessage/delta', { itemId: 'assistant-1', delta: 'answer' }, apply, state, sessionId)
  handleServerNotification('reasoning/textDelta', { itemId: 'reason-1', delta: 'thought' }, apply, state, sessionId)
  expect(views[sessionId]!.messages.filter(message => message.streaming)).toHaveLength(2)

  handleServerNotification('turn/completed', { turn: { status: 'completed' } }, apply, state, sessionId)
  expect(views[sessionId]!.messages).toEqual([])
  expect(views[sessionId]!.events.some(event => event.type === 'assistant_delta')).toBe(false)
  apply({ type: 'partial_message', sessionId, streamId: 'assistant-1', text: 'late', delta: true })
  expect(views[sessionId]!.messages).toEqual([])

  apply({ type: 'status', sessionId, status: 'running' })
  apply({ type: 'partial_message', sessionId, streamId: 'assistant-2', text: 'new', delta: true })
  expect(views[sessionId]!.messages[0]?.streamingChunks).toEqual(['new'])
  apply({ type: 'error', sessionId, message: 'failed' })
  expect(views[sessionId]!.messages.some(message => message.streaming)).toBe(false)
  expect(views[sessionId]!.messages.some(message => message.streamingChunks)).toBe(false)
  expect(views[sessionId]!.events.some(event => event.type === 'assistant_delta')).toBe(false)
  apply({ type: 'partial_message', sessionId, streamId: 'assistant-2', text: 'late-error', delta: true })
  expect(views[sessionId]!.messages.map(message => message.text)).toEqual(['failed'])

  delete views[sessionId]
  expect(views[sessionId]).toBeUndefined()
  views[sessionId] = createEmptySessionView()
  expect(views[sessionId]!.messages).toEqual([])
  expect(views[sessionId]!.closedStreamIds?.size).toBe(0)
})
