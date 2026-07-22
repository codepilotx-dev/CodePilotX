import { describe, expect, test } from 'bun:test'
import { handleSessionAgentEvent, type SessionEventContext } from '../src/features/session/sessionEvents.js'
import { createEmptySessionView } from '../src/features/session/sessionViewState.js'

describe('Pi session event reconciliation', () => {
  test('accumulates text and reasoning independently, then replaces only the matching terminal item', () => {
    let view = { ...createEmptySessionView(), eventModelVersion: 1 as const }
    const context = contextFor(updater => { view = updater(view) })

    handleSessionAgentEvent(delta('text-1', 'text', '你'), context)
    handleSessionAgentEvent(delta('reasoning-1', 'reasoning', '分析'), context)
    handleSessionAgentEvent(delta('text-1', 'text', '好'), context)

    expect(view.messages).toMatchObject([
      { id: 'text-1', text: '你好', streaming: true, metadata: { itemId: 'text-1', kind: 'text' } },
      { id: 'reasoning-1', text: '分析', streaming: true, metadata: { itemId: 'reasoning-1', kind: 'reasoning' } },
    ])

    handleSessionAgentEvent({
      type: 'message', sessionId: 'thread-1', role: 'assistant', text: '你好',
      metadata: { itemId: 'text-1', kind: 'text' },
    }, context)

    expect(view.messages).toMatchObject([
      { id: 'reasoning-1', text: '分析', streaming: true },
      { id: 'text-1', text: '你好', metadata: { itemId: 'text-1', kind: 'text' } },
    ])
    expect(view.events.filter(event => event.metadata?.itemId === 'text-1')).toMatchObject([
      { id: 'text-1:message', type: 'message', content: '你好' },
    ])
  })

  test('keeps tool output chunks and terminal result on one tool call identity', () => {
    let view = { ...createEmptySessionView(), eventModelVersion: 1 as const }
    const context = contextFor(updater => { view = updater(view) })

    handleSessionAgentEvent({ type: 'tool_start', sessionId: 'thread-1', toolName: 'shell', toolUseId: 'call-1', summary: 'run', metadata: { itemId: 'call-1' } }, context)
    handleSessionAgentEvent({ type: 'tool_output_delta', sessionId: 'thread-1', toolName: 'shell', toolUseId: 'call-1', delta: '50%', metadata: { itemId: 'call-1' } }, context)
    handleSessionAgentEvent({ type: 'tool_output_delta', sessionId: 'thread-1', toolName: 'shell', toolUseId: 'call-1', delta: '100%', metadata: { itemId: 'call-1' } }, context)
    handleSessionAgentEvent({ type: 'tool_result', sessionId: 'thread-1', toolName: 'shell', toolUseId: 'call-1', summary: 'done', metadata: { itemId: 'call-1' } }, context)

    expect(view.events).toMatchObject([
      { id: 'call-1:tool-call', type: 'tool_call' },
      { id: 'call-1:tool-output', type: 'tool_output_delta', content: '50%100%' },
      { id: 'call-1:tool-result', type: 'tool_result', content: 'done' },
    ])
  })
})

function delta(itemId: string, kind: 'text' | 'reasoning', text: string) {
  return {
    type: 'partial_message', sessionId: 'thread-1', role: 'assistant', text,
    metadata: { itemId, kind },
  }
}

function contextFor(update: (updater: (view: ReturnType<typeof createEmptySessionView> & { eventModelVersion: 1 }) => ReturnType<typeof createEmptySessionView> & { eventModelVersion: 1 }) => void): SessionEventContext {
  return {
    activeSessionIdRef: { current: 'thread-1' },
    setSessions: () => undefined,
    setSessionStatus: () => undefined,
    updateSessionView: (_sessionId, updater) => update(updater as never),
    addToolLogEntry: () => undefined,
    onErrorRef: { current: () => undefined },
    onDiffForActiveRef: { current: () => undefined },
    onRefreshActiveWorkspaceRef: { current: () => undefined },
    onOpenDrawerPermissionsRef: { current: () => undefined },
  }
}
