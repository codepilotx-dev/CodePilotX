import { describe, expect, test } from 'bun:test'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import type { DesktopAgentEvent } from '../shared/types.js'

const SESSION_ID = 'test-session-1'

describe('rustAppServerWorkflowAdapter', () => {
  test('10k assistant deltas use one chunk buffer and bounded partial updates', () => {
    const scheduled: Array<() => void> = []
    let lastScheduled: (() => void) | null = null
    const state = createRustAppServerWorkflowState({
      schedule: callback => {
        lastScheduled = callback
        scheduled.push(callback)
        return callback
      },
      cancelSchedule: callback => {
        const index = scheduled.indexOf(callback as () => void)
        if (index >= 0) scheduled.splice(index, 1)
      },
    })
    const events: DesktopAgentEvent[] = []
    const delta = '12345678901234567890'

    for (let index = 0; index < 10_000; index += 1) {
      handleServerNotification(
        'item/agentMessage/delta',
        { delta },
        event => events.push(event),
        state,
        SESSION_ID,
      )
    }

    expect(state.assistantDeltaChunks).toHaveLength(10_000)
    expect(
      state.assistantDeltaChunks.reduce((total, chunk) => total + chunk.length, 0),
    ).toBe(200_000)
    expect(events.filter(event => event.type === 'partial_message').length).toBeLessThanOrEqual(1)
    expect(scheduled).toHaveLength(1)

    handleServerNotification(
      'item/completed',
      { item: { type: 'agentMessage', id: 'item-stress' } },
      event => events.push(event),
      state,
      SESSION_ID,
    )

    expect(scheduled).toHaveLength(0)
    const final = [...events].reverse().find(event => event.type === 'message')
    expect(final?.type === 'message' ? final.text : '').toBe(delta.repeat(10_000))
    lastScheduled?.()
    expect(events.at(-1)).toBe(final)
  })

  test('time-spread streaming processes each delta character once across 250 timer ticks', () => {
    let scheduled: (() => void) | null = null
    const state = createRustAppServerWorkflowState({
      schedule: callback => {
        scheduled = callback
        return callback
      },
    })
    const events: DesktopAgentEvent[] = []
    for (let tick = 0; tick < 250; tick += 1) {
      for (let index = 0; index < 40; index += 1) {
        handleServerNotification(
          'item/agentMessage/delta',
          { itemId: 'agent-1', delta: '12345678901234567890' },
          event => events.push(event),
          state,
          SESSION_ID,
        )
      }
      scheduled?.()
      scheduled = null
    }
    expect(state.assistantProcessedChars).toBe(200_000)
    expect(events.filter(event => event.type === 'partial_message')).toHaveLength(251)
  })

  test('final item and terminal turn ignore late deltas and stale timer callbacks', () => {
    const callbacks: Array<() => void> = []
    const state = createRustAppServerWorkflowState({
      schedule: callback => {
        callbacks.push(callback)
        return callback
      },
    })
    const events: DesktopAgentEvent[] = []
    handleServerNotification('turn/started', { turn: { id: 'turn-1' } }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('item/agentMessage/delta', { itemId: 'agent-1', delta: 'a' }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('item/agentMessage/delta', { itemId: 'agent-1', delta: 'b' }, e => events.push(e), state, SESSION_ID)
    const stale = callbacks[0]!
    handleServerNotification('item/completed', { item: { type: 'agentMessage', id: 'agent-1' } }, e => events.push(e), state, SESSION_ID)
    stale()
    handleServerNotification('item/agentMessage/delta', { itemId: 'agent-1', delta: 'late' }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('turn/completed', { turn: { status: 'completed' } }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('item/agentMessage/delta', { itemId: 'agent-2', delta: 'after-turn' }, e => events.push(e), state, SESSION_ID)
    expect(events.filter(event => event.type === 'partial_message')).toHaveLength(1)
    expect(events.filter(event => event.type === 'message')).toHaveLength(1)
  })

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

  test('turn/started saves turn id, clears delta buffer, and reports server-started work as running', () => {
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
    expect(events).toEqual([
      { type: 'status', sessionId: SESSION_ID, status: 'running' },
    ])
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
      delta: true,
      streamId: 'item-1',
    })
  })

  test('item/delta accumulates text across multiple deltas', () => {
    let scheduled: (() => void) | null = null
    const state = createRustAppServerWorkflowState({
      schedule: callback => {
        scheduled = callback
        return callback
      },
    })
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
    scheduled?.()

    expect(state.assistantDeltaBuffer).toBe('world!')
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'Hello, ',
      delta: true,
      streamId: 'agent-message',
    })
    expect(events[1]).toEqual({
      type: 'partial_message',
      sessionId: SESSION_ID,
      text: 'world!',
      delta: true,
      streamId: 'agent-message',
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
      streamId: 'item-1',
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
      { threadId: 'thread-abc', turn: { id: 'turn-xyz', status: 'completed' } },
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

  test.each(['item/delta', 'item/agentMessage/delta'] as const)(
    '%s accepts v2 top-level delta text',
    method => {
      const state = createRustAppServerWorkflowState()
      const events: DesktopAgentEvent[] = []

      handleServerNotification(method, { delta: 'v2 text' }, e => events.push(e), state, SESSION_ID)

      expect(state.assistantDeltaBuffer).toBe('v2 text')
      expect(events).toEqual([
        {
          type: 'partial_message',
          sessionId: SESSION_ID,
          text: 'v2 text',
          delta: true,
          streamId: 'agent-message',
        },
      ])
    },
  )

  test('turn/completed with failed status emits error from turn error', () => {
    const state = createRustAppServerWorkflowState()
    state.activeTurnId = 'turn-failed'
    state.assistantDeltaBuffer = 'partial failure'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'turn/completed',
      {
        threadId: 'thread-abc',
        turn: {
          id: 'turn-failed',
          status: 'failed',
          error: { message: 'Command failed' },
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBeNull()
    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toEqual([
      { type: 'error', sessionId: SESSION_ID, message: 'Command failed' },
    ])
  })

  test.each(['completed', 'interrupted'] as const)(
    'turn/completed with %s status emits done',
    status => {
      const state = createRustAppServerWorkflowState()
      const events: DesktopAgentEvent[] = []

      handleServerNotification(
        'turn/completed',
        { turn: { id: 'turn-done', status } },
        e => events.push(e),
        state,
        SESSION_ID,
      )

      expect(events).toEqual([{ type: 'done', sessionId: SESSION_ID }])
    },
  )

  test.each([undefined, 'inProgress', 'unknown'] as const)(
    'turn/completed with %s status does not end the active turn',
    status => {
      const state = createRustAppServerWorkflowState()
      state.activeTurnId = 'turn-active'
      state.assistantDeltaBuffer = 'still streaming'
      const events: DesktopAgentEvent[] = []

      handleServerNotification(
        'turn/completed',
        { turn: { id: 'turn-active', ...(status ? { status } : {}) } },
        e => events.push(e),
        state,
        SESSION_ID,
      )

      expect(state.activeTurnId).toBe('turn-active')
      expect(state.assistantDeltaBuffer).toBe('still streaming')
      expect(events).toHaveLength(0)
    },
  )

  test('error notification emits error event', () => {
    const state = createRustAppServerWorkflowState()
    state.activeTurnId = 'turn-xyz'
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'error',
      {
          error: {
            message: 'Context window exceeded',
            codepilotxErrorInfo: null,
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
    expect(events.map(event => event.type)).toEqual(['status', 'error', 'status'])
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
      { threadId: 'thread-abc', turn: { id: 'turn-abc', status: 'completed' } },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(state.activeTurnId).toBeNull()
    expect(state.assistantDeltaBuffer).toBe('')
    expect(events).toEqual([
      { type: 'status', sessionId: SESSION_ID, status: 'running' },
      { type: 'done', sessionId: SESSION_ID },
    ])
  })

  // ── New: item/started ──────────────────────────────────────────────

  test('item/started with dynamicToolCall emits tool_start (v2 fields)', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/started',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'tool-item-1',
          tool: 'Bash',
          arguments: { command: 'ls' },
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
      delta: true,
      streamId: 'agent-message',
    })
  })

  // ── New: item/completed with tool/permission types ────────────────

  test('item/completed with dynamicToolCall emits tool_result (v2 fields)', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'tool-item-2',
          tool: 'Read',
          status: 'completed',
          success: true,
          contentItems: [{ type: 'inputText', text: 'file contents' }],
          durationMs: 150,
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
      metadata: {
        contentItems: [{ type: 'inputText', text: 'file contents' }],
        success: true,
        durationMs: 150,
      },
    })
  })

  test('item/completed with dynamicToolCall marks isError when success=false', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/completed',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'tool-item-3',
          tool: 'Bash',
          status: 'completed',
          success: false,
          contentItems: [{ type: 'inputText', text: 'Tool not available on desktop client' }],
          durationMs: 5,
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('tool_result')
    expect(events[0]).toMatchObject({
      toolName: 'Bash',
      isError: true,
      metadata: {
        success: false,
        durationMs: 5,
      },
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

	  // ── Plan notification ────────────────────────────────────────────

	  test('turn/plan/updated emits proposed_plan with formatted plan text', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'turn/plan/updated',
	      {
	        threadId: 'thread-abc',
	        turnId: 'turn-xyz',
	        explanation: 'I will modify the file.',
	        plan: [
	          { step: 'Read the file', status: 'completed' },
	          { step: 'Apply the edit', status: 'inProgress' },
	        ],
	      },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'proposed_plan',
	      sessionId: SESSION_ID,
	      text: 'I will modify the file.\n1. Read the file [completed]\n2. Apply the edit [inProgress]',
	      streaming: true,
	    })
	  })

	  test('item/plan/delta emits proposed_plan with streaming true', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/plan/delta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'Step 1: Analyze' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'proposed_plan',
	      sessionId: SESSION_ID,
	      text: 'Step 1: Analyze',
	      streaming: true,
	    })
	  })

	  // ── Command output delta ─────────────────────────────────────────

	  test('item/commandExecution/outputDelta emits tool_output_delta with accumulated state', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/commandExecution/outputDelta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'file1.txt\n' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'tool_output_delta',
	      sessionId: SESSION_ID,
	      toolUseId: 'item-1',
	      toolName: 'Bash',
	      delta: 'file1.txt\n',
	    })
	    // State should track aggregated output
	    expect(state.aggregatedOutputByItem.get('item-1')).toBe('file1.txt\n')
	  })

	  test('item/commandExecution/outputDelta accumulates multiple deltas', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/commandExecution/outputDelta',
	      { itemId: 'item-1', delta: 'file1.txt\n' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )
	    handleServerNotification(
	      'item/commandExecution/outputDelta',
	      { itemId: 'item-1', delta: 'file2.txt\n' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(2)
	    expect(events[0]).toMatchObject({ type: 'tool_output_delta', delta: 'file1.txt\n' })
	    expect(events[1]).toMatchObject({ type: 'tool_output_delta', delta: 'file2.txt\n' })
	    expect(state.aggregatedOutputByItem.get('item-1')).toBe('file1.txt\nfile2.txt\n')
	  })

	  test('item/commandExecution/outputDelta without itemId is safely ignored', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/commandExecution/outputDelta',
	      { delta: 'some output' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'tool_output_delta',
	      sessionId: SESSION_ID,
	      toolUseId: '',
	      toolName: 'Bash',
	      delta: 'some output',
	    })
	  })

	  test('item/completed.commandExecution uses aggregatedOutput from state', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/commandExecution/outputDelta',
	      { itemId: 'cmd-1', delta: 'line1\nline2\n' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    handleServerNotification(
	      'item/completed',
	      {
	        item: {
	          type: 'commandExecution',
	          id: 'cmd-1',
	          command: 'ls',
	          exitCode: 0,
	        },
	      },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(2)
	    expect(events[1]).toMatchObject({
	      type: 'tool_result',
	      toolName: 'Bash',
	      toolUseId: 'cmd-1',
	      summary: 'line1\nline2\n',
	      isError: false,
	    })
	    // aggregated state should be cleaned up
	    expect(state.aggregatedOutputByItem.has('cmd-1')).toBe(false)
	  })

	  // ── Server request resolved ──────────────────────────────────────

	  test('serverRequest/resolved for permission emits status running', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'serverRequest/resolved',
	      {
	        requestId: 'req-1',
	        method: 'item/commandExecution/requestApproval',
	        itemId: 'cmd-1',
	      },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'status',
	      sessionId: SESSION_ID,
	      status: 'running',
	    })
	  })

	  test('serverRequest/resolved for unknown method is still recognized', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'serverRequest/resolved',
	      {
	        requestId: 'req-2',
	        method: 'item/tool/call',
	      },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    // Still recognized and logged, but no status emitted for unknown methods
	    expect(events).toHaveLength(0)
	  })

	  // ── File change patch updated ────────────────────────────────────

	  test('item/fileChange/patchUpdated emits diff events for each file', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/fileChange/patchUpdated',
	      {
	        threadId: 'thread-abc',
	        turnId: 'turn-xyz',
	        itemId: 'item-1',
	        files: [
	          { path: 'src/index.ts', patch: 'diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-old\n+new' },
	        ],
	      },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'diff',
	      sessionId: SESSION_ID,
	      filePath: 'src/index.ts',
	      patch: 'diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-old\n+new',
	      metadata: { itemId: 'item-1' },
	    })
	  })

  test('item/fileChange/patchUpdated accepts v2 changes field', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'item/fileChange/patchUpdated',
      { itemId: 'item-2', changes: [{ path: 'src/app.ts', patch: '+new line' }] },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toEqual([
      {
        type: 'diff',
        sessionId: SESSION_ID,
        filePath: 'src/app.ts',
        patch: '+new line',
        metadata: { itemId: 'item-2' },
      },
    ])
  })

	  // ── Turn diff updated ────────────────────────────────────────────

	  test('turn/diff/updated emits aggregated diff event', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'turn/diff/updated',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', diff: 'diff --git a/file.ts b/file.ts\n@@ -1,3 +1,4 @@\n-old\n+new' },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0]).toEqual({
	      type: 'diff',
	      sessionId: SESSION_ID,
	      filePath: '(aggregated)',
	      patch: 'diff --git a/file.ts b/file.ts\n@@ -1,3 +1,4 @@\n-old\n+new',
	    })
	  })

	  // ── Reasoning delta ──────────────────────────────────────────────

	  test('reasoning/textDelta emits partial_message with reasoning prefix', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'reasoning/textDelta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'Step 1: think...', contentIndex: 0 },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0].type).toBe('partial_message')
	    expect((events[0] as { text: string }).text).toContain('推理...')
	  })

	  test('item/reasoning/textDelta emits partial_message with reasoning prefix', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/reasoning/textDelta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'Step 1: think...', contentIndex: 0 },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0].type).toBe('partial_message')
	    expect((events[0] as { text: string }).text).toContain('推理...')
	  })

	  test('reasoning/summaryTextDelta emits partial_message with summary prefix', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'reasoning/summaryTextDelta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'Summary: analyzed', summaryIndex: 0 },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0].type).toBe('partial_message')
	    expect((events[0] as { text: string }).text).toContain('推理摘要')
	  })

	  test('item/reasoning/summaryTextDelta emits partial_message with summary prefix', () => {
	    const state = createRustAppServerWorkflowState()
	    const events: DesktopAgentEvent[] = []

	    handleServerNotification(
	      'item/reasoning/summaryTextDelta',
	      { threadId: 'thread-abc', turnId: 'turn-xyz', itemId: 'item-1', delta: 'Summary: analyzed', summaryIndex: 0 },
	      e => events.push(e),
	      state,
	      SESSION_ID,
	    )

	    expect(events).toHaveLength(1)
	    expect(events[0].type).toBe('partial_message')
	    expect((events[0] as { text: string }).text).toContain('推理摘要')
	  })

  test('reasoning text and summary deltas emit complete accumulated buffers', () => {
    const callbacks: Array<() => void> = []
    const state = createRustAppServerWorkflowState({
      schedule: callback => {
        callbacks.push(callback)
        return callback
      },
    })
    const events: DesktopAgentEvent[] = []

    handleServerNotification('reasoning/textDelta', { delta: 'first ' }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('reasoning/textDelta', { delta: 'second' }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('reasoning/summaryTextDelta', { delta: 'summary one ' }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('reasoning/summaryTextDelta', { delta: 'summary two' }, e => events.push(e), state, SESSION_ID)
    callbacks.forEach(callback => callback())

    expect(
      events.filter((event): event is Extract<DesktopAgentEvent, { type: 'partial_message' }> =>
        event.type === 'partial_message' && event.streamId?.startsWith('reasoning:') === true)
        .map(event => event.text).join(''),
    ).toContain('first second')
    expect(
      events.filter((event): event is Extract<DesktopAgentEvent, { type: 'partial_message' }> =>
        event.type === 'partial_message' && event.streamId?.startsWith('reasoning-summary:') === true)
        .map(event => event.text).join(''),
    ).toContain('summary one summary two')
  })

  test('reasoning deltas share the 40ms buffer and stale callbacks cannot emit after terminal turn', () => {
    const callbacks: Array<{ callback: () => void; delayMs: number }> = []
    const state = createRustAppServerWorkflowState({
      schedule: (callback, delayMs) => {
        callbacks.push({ callback, delayMs })
        return callback
      },
    })
    const events: DesktopAgentEvent[] = []
    handleServerNotification('turn/started', { turn: { id: 'turn-1' } }, e => events.push(e), state, SESSION_ID)
    handleServerNotification('reasoning/textDelta', { itemId: 'reason-1', delta: 'first' }, e => events.push(e), state, SESSION_ID)
    for (let index = 0; index < 100; index += 1) {
      handleServerNotification('reasoning/textDelta', { itemId: 'reason-1', delta: 'x' }, e => events.push(e), state, SESSION_ID)
    }
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]?.delayMs).toBe(40)
    const stale = callbacks[0]!.callback
    handleServerNotification('turn/completed', { turn: { status: 'completed' } }, e => events.push(e), state, SESSION_ID)
    stale()
    handleServerNotification('reasoning/textDelta', { itemId: 'reason-1', delta: 'late' }, e => events.push(e), state, SESSION_ID)
    expect(events.filter(event => event.type === 'partial_message')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('done')
  })

  // ── Token usage ──────────────────────────────────────────────────

  test('thread/tokenUsage/updated emits context_usage with mapped fields', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 'thread-abc',
        turnId: 'turn-xyz',
        tokenUsage: {
          total: { totalTokens: 150, inputTokens: 100, cachedInputTokens: 30, outputTokens: 50, reasoningOutputTokens: 10 },
          last: { totalTokens: 150, inputTokens: 100, cachedInputTokens: 30, outputTokens: 50, reasoningOutputTokens: 10 },
          modelContextWindow: 1_000_000,
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
      { model: 'deepseek-v4-flash', providerID: 'deepseek' },
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('context_usage')

    const usage = (events[0] as { usage: Record<string, unknown> }).usage
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.promptCacheHitTokens).toBe(30)
    expect(usage.cacheReadInputTokens).toBe(30)
    expect(usage.promptCacheMissTokens).toBe(70)
    expect(usage.reasoningTokens).toBe(10)
    expect(usage.usedTokens).toBe(150)
    expect(usage.contextWindow).toBe(1_000_000)
    expect(usage.model).toBe('deepseek-v4-flash')
    expect(usage.provider).toBe('deepseek')
  })

  test('thread/tokenUsage/updated with all-zero usage does not emit', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 'thread-abc',
        turnId: 'turn-xyz',
        tokenUsage: {
          total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          last: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          modelContextWindow: null,
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
      { model: 'deepseek-v4-flash', providerID: 'deepseek' },
    )

    expect(events).toHaveLength(0)
  })

  test('thread/tokenUsage/updated without notificationContext uses fallback model', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 'thread-abc',
        turnId: 'turn-xyz',
        tokenUsage: {
          total: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 20, outputTokens: 20, reasoningOutputTokens: 0 },
          last: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 20, outputTokens: 20, reasoningOutputTokens: 0 },
          modelContextWindow: null,
        },
      },
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(1)
    const usage = (events[0] as { usage: Record<string, unknown> }).usage
    expect(usage.model).toBe('unknown')
    expect(usage.inputTokens).toBe(80)
    expect(usage.usedTokens).toBe(100)
  })

  test('thread/tokenUsage/updated with null params is safely ignored', () => {
    const state = createRustAppServerWorkflowState()
    const events: DesktopAgentEvent[] = []

    handleServerNotification(
      'thread/tokenUsage/updated',
      null,
      e => events.push(e),
      state,
      SESSION_ID,
    )

    expect(events).toHaveLength(0)
  })
		})
