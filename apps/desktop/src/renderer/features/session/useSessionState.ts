import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopAgentEvent,
  DesktopContextUsage,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopStreamState,
  DesktopThinkingMode,
  DesktopWorkspace,
} from '../../../shared/types.js'
import type {
  Message,
  SessionListItem,
  SessionViewState,
  ToolLogEntry,
} from '../../uiTypes.js'
import {
  activateSession,
  closeSessionAction,
  createSessionForWorkspaceAction,
  decidePermissionAction,
  interruptSessionAction,
  selectSessionAction,
  submitSessionMessageAction,
  updateSessionMetadataAction,
  type CloseSessionResult,
  type SessionActionContext,
  type SessionSettingsSnapshot,
} from './sessionActions.js'
import { handleSessionAgentEvent } from './sessionEvents.js'
import {
  applySessionView,
  addToolLogEntry as addToolLogEntryToView,
  createEmptySessionView,
  toggleToolLogEntry as toggleToolLogEntryInView,
  updateSessionView as updateSessionViewState,
  type AddToolLogEntry,
  type SessionViewRefs,
  type SessionViewStateSetters,
  type UpdateSessionView,
} from './sessionViewState.js'

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
  sessionsHydrated: boolean
  sessions: SessionListItem[]
  sessionStatus: DesktopSessionStatus
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  streamState: DesktopStreamState
  activeSessionItem: SessionListItem | null
  canSubmit: boolean
  input: string
  setInput: (value: string) => void
  activateSessionById: (targetSessionId: string | null) => DesktopWorkspace | null
  createSessionForWorkspace: (target?: DesktopWorkspace | null) => Promise<string | null>
  submit: (target?: DesktopWorkspace | null) => Promise<void>
  submitToSession: (targetSessionId: string, value: string) => Promise<void>
  interrupt: () => Promise<void>
  decidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    feedback?: string,
  ) => Promise<void>
  closeSession: (targetSessionId: string) => Promise<CloseSessionResult | null>
  updateSessionMetadata: (
    targetSessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => Promise<CloseSessionResult | null>
  selectSession: (session: SessionListItem) => DesktopWorkspace | null
  toggleToolLogEntry: (entryId: string) => void
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
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [contextUsage, setContextUsage] =
    useState<DesktopContextUsage | null>(null)
  const [streamState, setStreamState] = useState<DesktopStreamState>({
    mode: 'idle',
    thinkingText: '',
    activeToolUseIds: [],
  })
  const [input, setInput] = useState('')

  const activeSessionIdRef = useRef<string | null>(null)
  const sessionsRef = useRef<SessionListItem[]>([])
  const sessionStatusRef = useRef<DesktopSessionStatus>('idle')
  const sessionViewsRef = useRef<Record<string, SessionViewState>>({})
  const sessionWorkspacesRef = useRef<Record<string, DesktopWorkspace>>({})
  const inputBySessionRef = useRef<Record<string, string>>({})

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onDiffForActiveRef = useRef(onDiffForActive)
  onDiffForActiveRef.current = onDiffForActive
  const onRefreshActiveWorkspaceRef = useRef(onRefreshActiveWorkspace)
  onRefreshActiveWorkspaceRef.current = onRefreshActiveWorkspace
  const onOpenDrawerPermissionsRef = useRef(onOpenDrawerPermissions)
  onOpenDrawerPermissionsRef.current = onOpenDrawerPermissions

  const viewSetters = useMemo<SessionViewStateSetters>(
    () => ({
      setMessages,
      setToolLog,
      setPendingPermissions,
      setContextUsage,
      setStreamState,
    }),
    [],
  )
  const viewRefs = useMemo<SessionViewRefs>(
    () => ({ activeSessionIdRef, sessionViewsRef }),
    [],
  )
  const actionContext = useMemo<SessionActionContext>(
    () => ({
      activeSessionIdRef,
      sessionViewsRef,
      sessionWorkspacesRef,
      onErrorRef,
      viewSetters,
      setSessions,
      setSessionId,
      setSessionStatus,
    }),
    [viewSetters],
  )

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    sessionStatusRef.current = sessionStatus
  }, [sessionStatus])

  const setScopedInput = useCallback((value: string): void => {
    const key = activeSessionIdRef.current ?? HOME_INPUT_KEY
    inputBySessionRef.current = {
      ...inputBySessionRef.current,
      [key]: value,
    }
    setInput(value)
  }, [])

  const updateSessionView = useCallback<UpdateSessionView>(
    (targetSessionId, updater) => {
      updateSessionViewState(
        viewRefs,
        viewSetters,
        targetSessionId,
        updater,
      )
    },
    [viewRefs, viewSetters],
  )

  const addToolLogEntry = useCallback<AddToolLogEntry>(
    (targetSessionId, entry) => {
      addToolLogEntryToView(updateSessionView, targetSessionId, entry)
    },
    [updateSessionView],
  )

  const toggleToolLogEntry = useCallback(
    (entryId: string): void => {
      toggleToolLogEntryInView(viewRefs, updateSessionView, entryId)
    },
    [updateSessionView, viewRefs],
  )

  const handleAgentEvent = useCallback(
    (event: DesktopAgentEvent): void => {
      handleSessionAgentEvent(event, {
        activeSessionIdRef,
        setSessions,
        setSessionStatus,
        updateSessionView,
        addToolLogEntry,
        onErrorRef,
        onDiffForActiveRef,
        onRefreshActiveWorkspaceRef,
        onOpenDrawerPermissionsRef,
      })
    },
    [addToolLogEntry, updateSessionView],
  )

  useEffect(() => {
    const unsubscribeAgent = window.desktopApi.onAgentEvent(handleAgentEvent)
    return () => {
      unsubscribeAgent()
    }
  }, [handleAgentEvent])

  useEffect(() => {
    let disposed = false
    async function hydrateSessions(): Promise<void> {
      try {
        const sessionSnapshots = await window.desktopApi.listSessions()
        if (disposed) return

        const nextSessions = sessionSnapshots.map(snapshot => snapshot.item)
        const nextViews: Record<string, SessionViewState> = {}
        const nextWorkspaces: Record<string, DesktopWorkspace> = {}
        for (const snapshot of sessionSnapshots) {
          nextViews[snapshot.item.id] = {
            ...snapshot.view,
            contextUsage: snapshot.view.contextUsage ?? null,
            streamState: snapshot.view.streamState ?? {
              mode: 'idle',
              thinkingText: '',
              activeToolUseIds: [],
            },
            selectedFile: null,
          }
          nextWorkspaces[snapshot.item.id] = snapshot.workspace
        }

        sessionViewsRef.current = nextViews
        sessionWorkspacesRef.current = nextWorkspaces
        sessionsRef.current = nextSessions
        setSessions(nextSessions)

        activeSessionIdRef.current = null
        setSessionId(null)
        setSessionStatus('idle')
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        setSessionsHydrated(true)
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
        setSessionsHydrated(true)
      }
    }
    void hydrateSessions()
    return () => {
      disposed = true
    }
  }, [viewSetters])

  const settingsSnapshot = useMemo<SessionSettingsSnapshot>(
    () => ({
      permissionMode,
      model,
      fallbackModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
    }),
    [
      additionalDirectories,
      appendSystemPrompt,
      fallbackModel,
      model,
      permissionMode,
      sessionName,
      systemPrompt,
      thinkingMode,
    ],
  )

  const createSessionForWorkspace = useCallback(
    async (target: DesktopWorkspace | null): Promise<string | null> =>
      createSessionForWorkspaceAction(
        actionContext,
        settingsSnapshot,
        target,
      ),
    [actionContext, settingsSnapshot],
  )

  const activateSessionById = useCallback(
    (targetSessionId: string | null): DesktopWorkspace | null => {
      if (!targetSessionId) {
        activateSession(actionContext, null)
        setSessionStatus('idle')
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        return null
      }

      const targetSession = sessionsRef.current.find(
        session => session.id === targetSessionId,
      )
      if (!targetSession) {
        return null
      }

      activateSession(actionContext, targetSessionId)
      setSessionStatus(targetSession.status)
      applySessionView(
        sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
        viewSetters,
      )
      setInput(inputBySessionRef.current[targetSessionId] ?? '')
      if (targetSession.standalone) {
        return null
      }
      return sessionWorkspacesRef.current[targetSessionId] ?? {
        name: targetSession.workspaceName,
        path: targetSession.workspacePath,
      }
    },
    [actionContext, viewSetters],
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

  const submitToSession = useCallback(async (
    targetSessionId: string,
    value: string,
  ): Promise<void> => {
    const targetStatus =
      sessionsRef.current.find(session => session.id === targetSessionId)
        ?.status ??
      (activeSessionIdRef.current === targetSessionId
        ? sessionStatusRef.current
        : 'idle')
    await submitSessionMessageAction(
      onErrorRef,
      targetSessionId,
      value,
      Boolean(
        targetSessionId &&
          value.trim() &&
          targetStatus !== 'running' &&
          targetStatus !== 'waiting',
      ),
      model,
      nextValue => {
        inputBySessionRef.current = {
          ...inputBySessionRef.current,
          [targetSessionId]: nextValue,
        }
        if (activeSessionIdRef.current === targetSessionId) {
          setInput(nextValue)
        }
      },
    )
  }, [model])

  const submit = useCallback(async (target?: DesktopWorkspace | null): Promise<void> => {
    const targetSessionId =
      sessionId ??
      (await createSessionForWorkspaceAction(
        actionContext,
        settingsSnapshot,
        target ?? null,
      ))
    if (!targetSessionId) return
    await submitToSession(targetSessionId, input)
  }, [actionContext, input, sessionId, settingsSnapshot, submitToSession])

  const interrupt = useCallback(async (): Promise<void> => {
    await interruptSessionAction(onErrorRef, sessionId)
  }, [sessionId])

  const decidePermission = useCallback(
    async (
      request: DesktopPermissionRequest,
      behavior: 'allow' | 'deny',
      alwaysAllow = false,
      feedback?: string,
    ): Promise<void> => {
      await decidePermissionAction(
        onErrorRef,
        updateSessionView,
        sessionId,
        request,
        behavior,
        alwaysAllow,
        feedback,
      )
    },
    [sessionId, updateSessionView],
  )

  const closeSession = useCallback(
    async (targetSessionId: string): Promise<CloseSessionResult | null> =>
      closeSessionAction(actionContext, sessions, targetSessionId),
    [actionContext, sessions],
  )

  const updateSessionMetadata = useCallback(
    async (
      targetSessionId: string,
      patch: DesktopSessionMetadataPatch,
    ): Promise<CloseSessionResult | null> =>
      updateSessionMetadataAction(
        actionContext,
        sessions,
        targetSessionId,
        patch,
      ),
    [actionContext, sessions],
  )

  const selectSession = useCallback(
    (session: SessionListItem): DesktopWorkspace | null =>
      selectSessionAction(actionContext, session),
    [actionContext],
  )

  const activeSessionItem = useMemo(
    () => sessions.find(session => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )

  return {
    sessionId,
    sessionsHydrated,
    sessions,
    sessionStatus,
    messages,
    toolLog,
    pendingPermissions,
    contextUsage,
    streamState,
    activeSessionItem,
    canSubmit,
    input,
    setInput: setScopedInput,
    activateSessionById,
    createSessionForWorkspace,
    submit,
    submitToSession,
    interrupt,
    decidePermission,
    closeSession,
    updateSessionMetadata,
    selectSession,
    toggleToolLogEntry,
  }
}

const HOME_INPUT_KEY = '__home__'

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
