import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  Message,
  SessionViewState,
  ToolLogEntry,
} from '../../uiTypes.js'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

type ToolLogEntryInput = Omit<
  ToolLogEntry,
  'id' | 'createdAt' | 'expanded'
> & {
  createdAt?: string
}

export type SessionViewStateSetters = {
  setMessages: Dispatch<SetStateAction<Message[]>>
  setToolLog: Dispatch<SetStateAction<ToolLogEntry[]>>
  setPendingPermissions: Dispatch<SetStateAction<DesktopPermissionRequest[]>>
  setContextUsage: Dispatch<
    SetStateAction<SessionViewState['contextUsage']>
  >
  setStreamState: Dispatch<SetStateAction<SessionViewState['streamState']>>
}

export type SessionViewRefs = {
  activeSessionIdRef: MutableRefObject<string | null>
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>
}

export type UpdateSessionView = (
  targetSessionId: string,
  updater: (view: SessionViewState) => SessionViewState,
) => void

export type AddToolLogEntry = (
  targetSessionId: string,
  entry: ToolLogEntryInput,
) => void

export function createEmptySessionView(): SessionViewState {
  return {
    messages: [],
    toolLog: [],
    pendingPermissions: [],
    contextUsage: null,
    streamState: createIdleStreamState(),
    selectedFile: null,
  }
}

export function applySessionView(
  view: SessionViewState,
  setters: SessionViewStateSetters,
): void {
  setters.setMessages(view.messages)
  setters.setToolLog(view.toolLog)
  setters.setPendingPermissions(view.pendingPermissions)
  setters.setContextUsage(view.contextUsage)
  setters.setStreamState(view.streamState)
}

export function setSessionView(
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>,
  targetSessionId: string,
  view: SessionViewState,
): void {
  sessionViewsRef.current = {
    ...sessionViewsRef.current,
    [targetSessionId]: view,
  }
}

export function updateSessionView(
  refs: SessionViewRefs,
  setters: SessionViewStateSetters,
  targetSessionId: string,
  updater: (view: SessionViewState) => SessionViewState,
): void {
  const nextView = updater(
    refs.sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
  )
  setSessionView(refs.sessionViewsRef, targetSessionId, nextView)
  if (targetSessionId === refs.activeSessionIdRef.current) {
    applySessionView(nextView, setters)
  }
}

export function addToolLogEntry(
  updateView: UpdateSessionView,
  targetSessionId: string,
  entry: ToolLogEntryInput,
): void {
  updateView(targetSessionId, view => ({
    ...view,
    toolLog: upsertToolLogEntry(view.toolLog, entry),
  }))
}

export function toggleToolLogEntry(
  refs: SessionViewRefs,
  updateView: UpdateSessionView,
  entryId: string,
): void {
  const activeId = refs.activeSessionIdRef.current
  if (!activeId) return
  updateView(activeId, view => ({
    ...view,
    toolLog: view.toolLog.map(entry =>
      entry.id === entryId ? { ...entry, expanded: !entry.expanded } : entry,
    ),
  }))
}

export function createIdleStreamState(): SessionViewState['streamState'] {
  return {
    mode: 'idle',
    thinkingText: '',
    activeToolUseIds: [],
  }
}

function upsertToolLogEntry(
  current: ToolLogEntry[],
  entry: ToolLogEntryInput,
): ToolLogEntry[] {
  const createdAtIso = entry.createdAtIso ?? new Date().toISOString()
  const createdAt = entry.createdAt ?? new Date(createdAtIso).toLocaleTimeString()
  if (entry.toolUseId) {
    const index = current.findIndex(
      item => item.toolUseId === entry.toolUseId && item.kind === entry.kind,
    )
    if (index >= 0) {
      return current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...entry,
              createdAt: item.createdAt,
              createdAtIso: item.createdAtIso ?? createdAtIso,
              expanded: item.expanded || entry.isError === true,
            }
          : item,
      )
    }
  }
  return [
    {
      ...entry,
      id: crypto.randomUUID(),
      createdAt,
      createdAtIso,
      expanded: entry.isError === true,
    },
    ...current,
  ]
}
