import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  DesktopAgentEvent,
  DesktopSessionStatus,
} from '../../../shared/types.js'
import {
  desktopAgentEventToSessionEvent,
  isInternalReviewerMessageText,
} from '../../../shared/sessionEventModel.js'
import type { Message, SessionListItem } from '../../uiTypes.js'
import { sortSessionsByRecency } from './sessionSorting.js'
import type {
  AddToolLogEntry,
  UpdateSessionView,
} from './sessionViewState.js'

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

  if (isInternalReviewerAgentEvent(event)) {
    return
  }

  const sessionEvent = desktopAgentEventToSessionEvent(event)
  if (sessionEvent) {
    updateSessionView(event.sessionId, view => ({
      ...view,
      events:
        view.eventModelVersion === 1
          ? event.type === 'partial_message'
            ? [
                ...view.events.filter(
                  existing => existing.type !== 'assistant_delta',
                ),
                sessionEvent,
              ]
            : [
                ...view.events.filter(
                  existing =>
                    !(
                      event.type === 'message' &&
                      event.role === 'assistant' &&
                      existing.type === 'assistant_delta'
                    ),
                ),
                sessionEvent,
              ]
          : view.events,
    }))
  }

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
      sortSessionsByRecency(
        current.map(session =>
          session.id === event.sessionId
            ? { ...session, lastMessageAt: createdAt }
            : session,
        ),
      ),
    )
    updateSessionView(event.sessionId, view => ({
      ...view,
      messages: [
        ...view.messages.filter(message => !message.streaming),
        {
          id: crypto.randomUUID(),
          role: event.role,
          text: event.text,
          createdAt,
        },
      ],
    }))
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
      toolName: event.toolName,
      summary: event.summary,
      kind: 'start',
    })
    return
  }

  if (event.type === 'tool_result') {
    addToolLogEntry(event.sessionId, {
      toolName: event.toolName,
      summary: event.summary,
      kind: 'result',
      isError: event.isError,
    })
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
      sortSessionsByRecency(
        current.map(session =>
          session.id === event.sessionId
            ? { ...session, status: 'error', lastMessageAt: createdAt }
            : session,
        ),
      ),
    )
    if (event.sessionId === activeSessionIdRef.current) {
      onErrorRef.current(event.message)
      onRefreshActiveWorkspaceRef.current(event.sessionId)
    }
    updateSessionView(event.sessionId, view => ({
      ...view,
      pendingPermissions: [],
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
    const createdAt = new Date().toISOString()
    setSessions(current =>
      current.map(session =>
        session.id === event.sessionId
          ? { ...session, status: 'done', lastMessageAt: createdAt }
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
      messages: view.messages.map(message =>
        message.streaming ? { ...message, streaming: false } : message,
      ),
    }))
  }
}

export function isDurableSessionAgentEvent(event: DesktopAgentEvent): boolean {
  return event.type !== 'partial_message'
}

function isInternalReviewerAgentEvent(event: DesktopAgentEvent): boolean {
  return (
    (event.type === 'message' ||
      event.type === 'partial_message' ||
      event.type === 'proposed_plan') &&
    isInternalReviewerMessageText(event.text)
  )
}
