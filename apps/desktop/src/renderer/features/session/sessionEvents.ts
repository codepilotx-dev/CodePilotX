import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  DesktopAgentEvent,
  DesktopSessionStatus,
} from '../../../shared/types.js'
import type { Message, SessionListItem } from '../../uiTypes.js'
import type {
  AddToolLogEntry,
  UpdateSessionView,
} from './sessionViewState.js'
import { createIdleStreamState as idleStreamState } from './sessionViewState.js'

export type SessionEventContext = {
  activeSessionIdRef: MutableRefObject<string | null>
  setSessions: Dispatch<SetStateAction<SessionListItem[]>>
  setSessionStatus: Dispatch<SetStateAction<DesktopSessionStatus>>
  updateSessionView: UpdateSessionView
  addToolLogEntry: AddToolLogEntry
  onErrorRef: MutableRefObject<(message: string) => void>
  onDiffForActiveRef: MutableRefObject<(patch: string) => void>
  onRefreshActiveWorkspaceRef: MutableRefObject<(sessionId: string) => void>
  onOpenDrawerPermissionsRef: MutableRefObject<() => void>
}

export function handleSessionAgentEvent(
  event: DesktopAgentEvent,
  context: SessionEventContext,
): void {
  const {
    activeSessionIdRef,
    setSessions,
    setSessionStatus,
    updateSessionView,
    addToolLogEntry,
    onErrorRef,
    onDiffForActiveRef,
    onRefreshActiveWorkspaceRef,
    onOpenDrawerPermissionsRef,
  } = context

  if (event.type === 'status') {
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, status: event.status }
          : session,
      ),
    )
    if (event.sessionId === activeSessionIdRef.current) {
      setSessionStatus(event.status)
    }
    return
  }

  if (event.type === 'message') {
    const createdAt = event.createdAt ?? new Date().toISOString()
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, lastMessageAt: createdAt }
          : session,
      ),
    )
    updateSessionView(event.sessionId, view => {
      const streamingIndex =
        event.role === 'assistant'
          ? view.messages.findIndex(message => message.streaming)
          : -1
      const finalMessage: Message = {
        id:
          streamingIndex >= 0
            ? view.messages[streamingIndex]!.id
            : crypto.randomUUID(),
        role: event.role,
        text: event.text,
        createdAt,
      }
      if (streamingIndex >= 0) {
        return {
          ...view,
          messages: view.messages.map((message, index) =>
            index === streamingIndex ? finalMessage : message,
          ),
        }
      }
      return {
        ...view,
        messages: [
          ...view.messages.filter(message => !message.streaming),
          finalMessage,
        ],
      }
    })
    return
  }

  if (event.type === 'partial_message') {
    updateSessionView(event.sessionId, view => {
      const index = view.messages.findIndex(message => message.streaming)
      const createdAt =
        event.createdAt ??
        (index >= 0 ? view.messages[index]?.createdAt : undefined) ??
        new Date().toISOString()
      const nextMessage: Message = {
        id: index >= 0 ? view.messages[index]!.id : crypto.randomUUID(),
        role: 'assistant',
        text: event.text,
        createdAt,
        streaming: true,
      }
      if (index === -1) {
        return { ...view, messages: [...view.messages, nextMessage] }
      }
      return {
        ...view,
        messages: view.messages.map((message, messageIndex) =>
          messageIndex === index ? nextMessage : message,
        ),
      }
    })
    return
  }

  if (event.type === 'stream_state') {
    updateSessionView(event.sessionId, view => ({
      ...view,
      streamState: {
        ...view.streamState,
        mode: event.mode,
        thinkingRedacted:
          event.thinkingRedacted ?? view.streamState.thinkingRedacted,
        activeToolUseIds:
          event.activeToolUseIds ?? view.streamState.activeToolUseIds,
      },
    }))
    return
  }

  if (event.type === 'thinking_delta') {
    updateSessionView(event.sessionId, view => ({
      ...view,
      streamState: {
        ...view.streamState,
        mode: 'thinking',
        thinkingText: event.fullText,
        thinkingRedacted:
          event.redacted ?? view.streamState.thinkingRedacted,
      },
    }))
    return
  }

  if (event.type === 'context_usage') {
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, model: event.usage.model }
          : session,
      ),
    )
    updateSessionView(event.sessionId, view => ({
      ...view,
      contextUsage: event.usage,
    }))
    return
  }

  if (event.type === 'session_title') {
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, aiTitle: event.title }
          : session,
      ),
    )
    return
  }

  if (event.type === 'tool_start') {
    addToolLogEntry(event.sessionId, {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      summary: event.summary,
      kind: 'start',
      status: 'running',
      input: event.input,
      createdAtIso: event.createdAt,
    })
    return
  }

  if (event.type === 'tool_input_delta') {
    addToolLogEntry(event.sessionId, {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      summary: event.summary,
      kind: 'start',
      status: 'running',
      input: event.input ?? event.partialInput,
      createdAtIso: event.createdAt,
    })
    return
  }

  if (event.type === 'tool_result') {
    addToolLogEntry(event.sessionId, {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      summary: event.summary,
      kind: 'result',
      isError: event.isError,
      status: event.isError ? 'error' : 'success',
      content: event.content,
      createdAtIso: event.createdAt,
    })
    if (event.toolUseId) {
      updateSessionView(event.sessionId, view => ({
        ...view,
        streamState: {
          ...view.streamState,
          activeToolUseIds: view.streamState.activeToolUseIds.filter(
            id => id !== event.toolUseId,
          ),
        },
      }))
    }
    return
  }

  if (event.type === 'permission_request') {
    updateSessionView(event.sessionId, view => ({
      ...view,
      pendingPermissions: [event.request, ...view.pendingPermissions],
    }))
    if (event.sessionId === activeSessionIdRef.current) {
      onOpenDrawerPermissionsRef.current()
    }
    return
  }

  if (event.type === 'diff') {
    if (event.sessionId === activeSessionIdRef.current) {
      onDiffForActiveRef.current(event.patch)
    }
    return
  }

  if (event.type === 'error') {
    const createdAt = new Date().toISOString()
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, status: 'error', lastMessageAt: createdAt }
          : session,
      ),
    )
    if (event.sessionId === activeSessionIdRef.current) {
      onErrorRef.current(event.message)
      onRefreshActiveWorkspaceRef.current(event.sessionId)
    }
    updateSessionView(event.sessionId, view => ({
      ...view,
      pendingPermissions: [],
      streamState: idleStreamState(),
      messages: [
        ...view.messages.map(message =>
          message.streaming ? { ...message, streaming: false } : message,
        ),
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: event.message,
          createdAt,
        },
      ],
    }))
    return
  }

  if (event.type === 'done') {
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, status: 'done' }
          : session,
      ),
    )
    if (event.sessionId === activeSessionIdRef.current) {
      setSessionStatus('done')
      onRefreshActiveWorkspaceRef.current(event.sessionId)
    }
    updateSessionView(event.sessionId, view => ({
      ...view,
      pendingPermissions: [],
      streamState: idleStreamState(),
      messages: view.messages.map(message =>
        message.streaming ? { ...message, streaming: false } : message,
      ),
    }))
  }
}
