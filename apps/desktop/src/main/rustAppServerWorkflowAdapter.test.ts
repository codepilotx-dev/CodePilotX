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

  test('item/completed with commandExecution emits tool_result', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'item-2',
          command: 'ls',
          exitCode: 0,
          output: 'file1.txt\nfile2.txt',
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      sessionId: SESSION_ID,
      toolName: 'Bash',
    })
  })

  test('item/completed with unknown type is ignored', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'unknownCustomType',
          id: 'item-3',
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

  test('state resets for new turn after error', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    // Simulate: turn starts, error occurs, then a new turn starts
    handleServerNotification(
      'turn/started',
      { turn: { id: 'turn-1' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )
    state.assistantDeltaBuffer = 'partial text before error'

    handleServerNotification(
      'error',
      { error: { message: 'API error' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    // After error, state should be cleaned up
    expect(state.activeTurnId).toBeNull()
    expect(state.assistantDeltaBuffer).toBe('')

    // New turn starts
    handleServerNotification(
      'turn/started',
      { turn: { id: 'turn-2' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBe('turn-2')
    expect(state.assistantDeltaBuffer).toBe('')
    // Only the error event was emitted (turn/started doesn't emit events)
    expect(events).toHaveLength(1)
  })

  test('delta buffer is cleared by turn/completed', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'turn/started',
      { turn: { id: 'turn-abc' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )
    state.assistantDeltaBuffer = 'accumulated text'

    handleServerNotification(
      'turn/completed',
      { threadId: 'thread-abc', turn: { id: 'turn-abc' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBeNull()
    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'done', sessionId: SESSION_ID })
  })

  // ── New: item/started ──────────────────────────────────────────────

  test('item/started with dynamicToolCall emits tool_start', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/started',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'tool-item-1',
          tool_name: 'Bash',
          input: { command: 'ls' },
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'tool_start',
      sessionId: SESSION_ID,
      toolName: 'Bash',
      summary: expect.stringContaining('ls'),
      toolUseId: 'tool-item-1',
    })
  })

  test('item/started with commandExecution emits tool_start (Bash)', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/started',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-item-1',
          command: 'ls -la',
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'Bash',
      toolUseId: 'cmd-item-1',
    })
  })

  // ── New: item/agentMessage/delta ───────────────────────────────────

  test('item/agentMessage/delta emits partial_message', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/agentMessage/delta',
      { itemDelta: { text: 'Hello from agent delta' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.assistantDeltaBuffer).toBe('Hello from agent delta')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'Hello from agent delta',
    })
  })

  // ── New: item/completed with tool/permission types ────────────────

  test('item/completed with dynamicToolCall emits tool_result', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'tool-item-2',
          tool_name: 'Read',
          status: 'completed',
          result: { content: 'file contents' },
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'Read',
      toolUseId: 'tool-item-2',
      isError: false,
    })
  })

  test('item/completed with fileChange emits tool_result', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'fileChange',
          id: 'fc-item-1',
          status: 'completed',
          changes: [
            { path: 'src/index.ts', status: 'modified' },
          ],
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'ApplyPatch',
      toolUseId: 'fc-item-1',
      isError: false,
    })
  })
})
