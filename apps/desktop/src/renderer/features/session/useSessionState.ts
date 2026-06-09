import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopWorkspace,
} from '../../../shared/types.js'
import { normalizeOptionalText, parseAdditionalDirectories } from '../settings/settingsStorage.js'
import {
  type Message,
  type SessionListItem,
  type SessionViewState,
  type ToolLogEntry,
} from '../../uiTypes.js'

export type UseSessionStateOptions = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  onError: (message: string) => void
  onDiffForActive: (patch: string) => void
  onRefreshActiveWorkspace: (sessionId: string) => void
  onOpenDrawerPermissions: () => void
}

export type UseSessionStateResult = {
  sessionId: string | null
  sessions: SessionListItem[]
  sessionStatus: DesktopSessionStatus
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  activeSessionItem: SessionListItem | null
  canSubmit: boolean
  input: string
  setInput: (value: string) => void
  createSessionForWorkspace: (target?: DesktopWorkspace | null) => Promise<void>
  submit: () => Promise<void>
  interrupt: () => Promise<void>
  decidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ) => Promise<void>
  closeSession: (targetSessionId: string) => Promise<{
    nextActiveSession: SessionListItem | null
    nextWorkspace: DesktopWorkspace | null
  } | null>
  selectSession: (session: SessionListItem) => DesktopWorkspace
  toggleToolLogEntry: (entryId: string) => void
}

function createEmptySessionView(): SessionViewState {
  return {
    messages: [],
    toolLog: [],
    pendingPermissions: [],
    selectedFile: null,
  }
}

export function useSessionState(
  options: UseSessionStateOptions,
): UseSessionStateResult {
  const {
    permissionMode,
    model,
    fallbackModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    onError,
    onDiffForActive,
    onRefreshActiveWorkspace,
    onOpenDrawerPermissions,
  } = options

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [input, setInput] = useState('')

  const activeSessionIdRef = useRef<string | null>(null)
  const sessionViewsRef = useRef<Record<string, SessionViewState>>({})
  const sessionWorkspacesRef = useRef<Record<string, DesktopWorkspace>>({})

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onDiffForActiveRef = useRef(onDiffForActive)
  onDiffForActiveRef.current = onDiffForActive
  const onRefreshActiveWorkspaceRef = useRef(onRefreshActiveWorkspace)
  onRefreshActiveWorkspaceRef.current = onRefreshActiveWorkspace
  const onOpenDrawerPermissionsRef = useRef(onOpenDrawerPermissions)
  onOpenDrawerPermissionsRef.current = onOpenDrawerPermissions

  const setSessionView = useCallback(
    (targetSessionId: string, view: SessionViewState): void => {
      sessionViewsRef.current = {
        ...sessionViewsRef.current,
        [targetSessionId]: view,
      }
    },
    [],
  )

  const applySessionView = useCallback((view: SessionViewState): void => {
    setMessages(view.messages)
    setToolLog(view.toolLog)
    setPendingPermissions(view.pendingPermissions)
  }, [])

  const updateSessionView = useCallback(
    (
      targetSessionId: string,
      updater: (view: SessionViewState) => SessionViewState,
    ): void => {
      const nextView = updater(
        sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
      )
      setSessionView(targetSessionId, nextView)
      if (targetSessionId === activeSessionIdRef.current) {
        applySessionView(nextView)
      }
    },
    [applySessionView, setSessionView],
  )

  const addToolLogEntry = useCallback(
    (
      targetSessionId: string,
      entry: Omit<ToolLogEntry, 'id' | 'createdAt' | 'expanded'>,
    ): void => {
      updateSessionView(targetSessionId, view => ({
        ...view,
        toolLog: [
          {
            ...entry,
            id: crypto.randomUUID(),
            createdAt: new Date().toLocaleTimeString(),
            expanded: entry.isError === true,
          },
          ...view.toolLog,
        ],
      }))
    },
    [updateSessionView],
  )

  const toggleToolLogEntry = useCallback(
    (entryId: string): void => {
      const activeId = activeSessionIdRef.current
      if (!activeId) return
      updateSessionView(activeId, view => ({
        ...view,
        toolLog: view.toolLog.map(entry =>
          entry.id === entryId ? { ...entry, expanded: !entry.expanded } : entry,
        ),
      }))
    },
    [updateSessionView],
  )

  const handleAgentEvent = useCallback(
    (event: DesktopAgentEvent): void => {
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
        updateSessionView(event.sessionId, view => ({
          ...view,
          messages: [
            ...view.messages.filter(message => !message.streaming),
            {
              id: crypto.randomUUID(),
              role: event.role,
              text: event.text,
            },
          ],
        }))
        return
      }
      if (event.type === 'partial_message') {
        updateSessionView(event.sessionId, view => {
          const index = view.messages.findIndex(message => message.streaming)
          const nextMessage: Message = {
            id: index >= 0 ? view.messages[index]!.id : crypto.randomUUID(),
            role: 'assistant',
            text: event.text,
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
          messages: view.messages.map(message =>
            message.streaming ? { ...message, streaming: false } : message,
          ),
        }))
      }
    },
    [addToolLogEntry, updateSessionView],
  )

  useEffect(() => {
    const unsubscribeAgent = window.desktopApi.onAgentEvent(handleAgentEvent)
    return () => {
      unsubscribeAgent()
    }
  }, [handleAgentEvent])

  const activateSession = useCallback((nextSessionId: string | null): void => {
    activeSessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
  }, [])

  const createSessionForWorkspace = useCallback(
    async (target: DesktopWorkspace | null): Promise<void> => {
      if (!target) return
      try {
        const session = await window.desktopApi.createSession({
          workspacePath: target.path,
          permissionMode,
          model: normalizeOptionalText(model),
          fallbackModel: normalizeOptionalText(fallbackModel),
          sessionName: normalizeOptionalText(sessionName),
          thinkingMode,
          systemPrompt: normalizeOptionalText(systemPrompt),
          appendSystemPrompt: normalizeOptionalText(appendSystemPrompt),
          additionalDirectories: parseAdditionalDirectories(additionalDirectories),
        })
        const nextView =
          sessionViewsRef.current[session.sessionId] ?? createEmptySessionView()
        sessionWorkspacesRef.current = {
          ...sessionWorkspacesRef.current,
          [session.sessionId]: target,
        }
        setSessionView(session.sessionId, nextView)
        activateSession(session.sessionId)
        setSessionStatus('idle')
        applySessionView(nextView)
        setSessions(current => [
          {
            id: session.sessionId,
            sessionName: normalizeOptionalText(sessionName) ?? null,
            workspaceName: target.name,
            workspacePath: target.path,
            permissionMode,
            model: normalizeOptionalText(model) ?? null,
            fallbackModel: normalizeOptionalText(fallbackModel) ?? null,
            thinkingMode,
            hasSystemPrompt: Boolean(normalizeOptionalText(systemPrompt)),
            hasAppendSystemPrompt: Boolean(
              normalizeOptionalText(appendSystemPrompt),
            ),
            additionalDirectoryCount:
              parseAdditionalDirectories(additionalDirectories).length,
            status: 'idle',
            createdAt: new Date().toLocaleTimeString(),
          },
          ...current,
        ])
      } catch (error) {
        onErrorRef.current(
          error instanceof Error ? error.message : String(error),
        )
      }
    },
    [
      activateSession,
      additionalDirectories,
      applySessionView,
      appendSystemPrompt,
      fallbackModel,
      model,
      permissionMode,
      sessionName,
      setSessionView,
      systemPrompt,
      thinkingMode,
    ],
  )

  const canSubmit = useMemo(
    () =>
      Boolean(
        sessionId &&
          input.trim() &&
          sessionStatus !== 'running' &&
          sessionStatus !== 'waiting',
      ),
    [input, sessionId, sessionStatus],
  )

  const submit = useCallback(async (): Promise<void> => {
    const trimmed = input.trim()
    const activeSessionId = sessionId
    if (!canSubmit || !activeSessionId) return
    setInput('')
    try {
      await window.desktopApi.sendUserMessage(activeSessionId, trimmed)
    } catch (error) {
      onErrorRef.current(
        error instanceof Error ? error.message : String(error),
      )
    }
  }, [canSubmit, input, sessionId])

  const interrupt = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await window.desktopApi.interruptSession(sessionId)
    } catch (error) {
      onErrorRef.current(
        error instanceof Error ? error.message : String(error),
      )
    }
  }, [sessionId])

  const decidePermission = useCallback(
    async (
      request: DesktopPermissionRequest,
      behavior: 'allow' | 'deny',
      alwaysAllow = false,
    ): Promise<void> => {
      if (!sessionId) return
      updateSessionView(sessionId, view => ({
        ...view,
        pendingPermissions: view.pendingPermissions.filter(
          item => item.requestId !== request.requestId,
        ),
      }))
      try {
        await window.desktopApi.respondToPermission(
          sessionId,
          request.requestId,
          {
            behavior,
            message: behavior === 'deny' ? '在桌面端界面中拒绝' : undefined,
            alwaysAllow,
          },
        )
      } catch (error) {
        onErrorRef.current(
          error instanceof Error ? error.message : String(error),
        )
      }
    },
    [sessionId, updateSessionView],
  )

  const closeSession = useCallback(
    async (
      targetSessionId: string,
    ): Promise<{
      nextActiveSession: SessionListItem | null
      nextWorkspace: DesktopWorkspace | null
    } | null> => {
      try {
        const disposed = await window.desktopApi.disposeSession(targetSessionId)
        if (disposed === null) return null
      } catch (error) {
        onErrorRef.current(
          error instanceof Error ? error.message : String(error),
        )
        return null
      }
      const remaining = sessions.filter(session => session.id !== targetSessionId)
      const {
        [targetSessionId]: _removedSessionView,
        ...remainingSessionViews
      } = sessionViewsRef.current
      const {
        [targetSessionId]: _removedWorkspace,
        ...remainingSessionWorkspaces
      } = sessionWorkspacesRef.current
      sessionViewsRef.current = remainingSessionViews
      sessionWorkspacesRef.current = remainingSessionWorkspaces
      setSessions(remaining)

      if (targetSessionId !== activeSessionIdRef.current) {
        return { nextActiveSession: null, nextWorkspace: null }
      }

      const next = remaining[0]
      activateSession(next?.id ?? null)
      setSessionStatus(next?.status ?? 'idle')
      if (next) {
        applySessionView(
          sessionViewsRef.current[next.id] ?? createEmptySessionView(),
        )
        const nextWorkspace = remainingSessionWorkspaces[next.id] ?? {
          name: next.workspaceName,
          path: next.workspacePath,
        }
        return { nextActiveSession: next, nextWorkspace }
      }
      applySessionView(createEmptySessionView())
      return { nextActiveSession: null, nextWorkspace: null }
    },
    [activateSession, applySessionView, sessions],
  )

  const selectSession = useCallback(
    (session: SessionListItem): DesktopWorkspace => {
      activateSession(session.id)
      setSessionStatus(session.status)
      applySessionView(
        sessionViewsRef.current[session.id] ?? createEmptySessionView(),
      )
      const nextWorkspace = sessionWorkspacesRef.current[session.id] ?? {
        name: session.workspaceName,
        path: session.workspacePath,
      }
      return nextWorkspace
    },
    [activateSession, applySessionView],
  )

  const activeSessionItem = useMemo(
    () => sessions.find(session => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )

  return {
    sessionId,
    sessions,
    sessionStatus,
    messages,
    toolLog,
    pendingPermissions,
    activeSessionItem,
    canSubmit,
    input,
    setInput,
    createSessionForWorkspace,
    submit,
    interrupt,
    decidePermission,
    closeSession,
    selectSession,
    toggleToolLogEntry,
  }
}
