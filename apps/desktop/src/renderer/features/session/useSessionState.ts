import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
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
  sessions: SessionListItem[]
  sessionStatus: DesktopSessionStatus
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  activeSessionItem: SessionListItem | null
  canSubmit: boolean
  input: string
  setInput: (value: string) => void
  createSessionForWorkspace: (target?: DesktopWorkspace | null) => Promise<string | null>
  submit: (target?: DesktopWorkspace | null) => Promise<void>
  interrupt: () => Promise<void>
  decidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
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

  const viewSetters = useMemo<SessionViewStateSetters>(
    () => ({ setMessages, setToolLog, setPendingPermissions }),
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
        const [sessionSnapshots, persistedActiveSessionId] = await Promise.all([
          window.desktopApi.listSessions(),
          window.desktopApi.getActiveSessionId(),
        ])
        if (disposed) return

        const nextSessions = sessionSnapshots.map(snapshot => snapshot.item)
        const nextViews: Record<string, SessionViewState> = {}
        const nextWorkspaces: Record<string, DesktopWorkspace> = {}
        for (const snapshot of sessionSnapshots) {
          nextViews[snapshot.item.id] = {
            ...snapshot.view,
            selectedFile: null,
          }
          nextWorkspaces[snapshot.item.id] = snapshot.workspace
        }

        sessionViewsRef.current = nextViews
        sessionWorkspacesRef.current = nextWorkspaces
        setSessions(nextSessions)

        const nextSessionId =
          persistedActiveSessionId && nextViews[persistedActiveSessionId]
            ? persistedActiveSessionId
            : nextSessions[0]?.id ?? null
        activeSessionIdRef.current = nextSessionId
        setSessionId(nextSessionId)

        const activeSession = nextSessions.find(
          session => session.id === nextSessionId,
        )
        setSessionStatus(activeSession?.status ?? 'idle')
        applySessionView(
          nextSessionId
            ? nextViews[nextSessionId] ?? createEmptySessionView()
            : createEmptySessionView(),
          viewSetters,
        )
        if (nextSessionId !== persistedActiveSessionId) {
          void window.desktopApi.setActiveSession(nextSessionId)
        }
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
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

  const submit = useCallback(async (target?: DesktopWorkspace | null): Promise<void> => {
    const targetSessionId =
      sessionId ??
      (await createSessionForWorkspaceAction(
        actionContext,
        settingsSnapshot,
        target ?? null,
      ))
    await submitSessionMessageAction(
      onErrorRef,
      targetSessionId,
      input,
      Boolean(
        targetSessionId &&
          input.trim() &&
          sessionStatus !== 'running' &&
          sessionStatus !== 'waiting',
      ),
      setInput,
    )
  }, [actionContext, input, sessionId, sessionStatus, settingsSnapshot])

  const interrupt = useCallback(async (): Promise<void> => {
    await interruptSessionAction(onErrorRef, sessionId)
  }, [sessionId])

  const decidePermission = useCallback(
    async (
      request: DesktopPermissionRequest,
      behavior: 'allow' | 'deny',
      alwaysAllow = false,
    ): Promise<void> => {
      await decidePermissionAction(
        onErrorRef,
        updateSessionView,
        sessionId,
        request,
        behavior,
        alwaysAllow,
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
    updateSessionMetadata,
    selectSession,
    toggleToolLogEntry,
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
