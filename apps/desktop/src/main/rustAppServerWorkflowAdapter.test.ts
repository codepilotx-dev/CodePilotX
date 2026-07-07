import { describe, expect, test } from 'bun:test'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import type { DesktopAgentEvent } from '../shared/types.js'

const SESSION_ID = 'test-session-1'

describe('rustAppServerWorkflowAdapter', () => {
  test('thread/started saves thread id', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'thread/started',
      { thread: { id: 'thread-abc' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.threadId).toBe('thread-abc')
    expect(events).toHaveLength(0)
  })

  test('turn/started saves turn id and clears delta buffer', () => {
    const state = createRustAppServerWorkflowState()
    state.assistantDeltaBuffer = 'stale text'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'turn/started',
      { turn: { id: 'turn-xyz' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBe('turn-xyz')
    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toHaveLength(0)
  })

  test('item/delta with text emits partial_message', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/delta',
      {
        threadId: 'thread-abc',
        turnId: 'turn-xyz',
        itemId: 'item-1',
        itemDelta: { text: 'Hello, ' },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.assistantDeltaBuffer).toBe('Hello, ')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'Hello, ',
    })
  })

  test('item/delta accumulates text across multiple deltas', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/delta',
      { itemDelta: { text: 'Hello, ' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )
    handleServerNotification(
      'item/delta',
      { itemDelta: { text: 'world!' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.assistantDeltaBuffer).toBe('Hello, world!')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'Hello, ',
    })
    expect(events[1]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'Hello, world!',
    })
  })

  test('item/completed with agentMessage emits final message', () => {
    const state = createRustAppServerWorkflowState()
    state.assistantDeltaBuffer = 'Hello, world!'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        threadId: 'thread-abc',
        turnId: 'turn-xyz',
        item: {
          type: 'agentMessage',
          id: 'item-1',
          text: 'Hello, world!',
          phase: 'final_answer',
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'message',
      sessionId: SESSION_ID,
      role: 'assistant',
      text: 'Hello, world!',
    })
  })

  test('item/completed with non-agentMessage type is ignored', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'item-2',
          command: 'ls',
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(0)
  })

  test('turn/completed emits done and clears active turn', () => {
    const state = createRustAppServerWorkflowState()
    state.activeTurnId = 'turn-xyz'
    state.assistantDeltaBuffer = 'buffered text'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'turn/completed',
      { threadId: 'thread-abc', turn: { id: 'turn-xyz' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBeNull()
    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'done',
      sessionId: SESSION_ID,
    })
  })

  test('error notification emits error event', () => {
    const state = createRustAppServerWorkflowState()
    state.activeTurnId = 'turn-xyz'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'error',
      {
        error: {
          message: 'Context window exceeded',
          codexErrorInfo: null,
          additionalDetails: null,
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'error',
      sessionId: SESSION_ID,
      message: 'Context window exceeded',
    })
  })

  test('fallback message when error has no message', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'error',
      { error: {} },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events[0]).toEqual({
      type: 'error',
      sessionId: SESSION_ID,
      message: 'Rust app-server error',
    })
  })

  test('unhandled notifications are silently ignored (debug logged)', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/tool/call',
      { some: 'data' },
      e => events.push(e),
      state,
      SESSION_ID,
    )
    handleServerNotification(
      'item/fileChange/started',
      { file: 'test.txt' },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(0)
  })
})
