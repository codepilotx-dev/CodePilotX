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
	})
