import { desktopClient } from '../../services/desktopClient.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopAgentEvent,
  DesktopContextUsage,
  DesktopSessionCatalogStatus,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopWorkflowEvent,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
} from '../../../shared/types.js'
import type {
  Message,
  SessionListItem,
  SessionViewState,
  ToolLogEntry,
} from '../../uiTypes.js'
import { sessionViewFallbackTitle } from '../../uiTypes.js'
import {
  activateSession,
  closeSessionAction,
  createSessionForWorkspaceAction,
  decidePermissionAction,
  interruptSessionAction,
  selectSessionAction,
  setSessionLocalRouterModeAction,
  setSessionPermissionModeAction,
  setSessionPlanModeActiveAction,
  submitSessionMessageAction,
  updateSessionMetadataAction,
  type CloseSessionResult,
  type SessionActionContext,
  type SessionSettingsSnapshot,
} from './sessionActions.js'
import { handleSessionAgentEvent } from './sessionEvents.js'
import {
  appendUniqueWorkflowEvent,
  dedupeWorkflowEvents,
} from './workflowEventDedup.js'
import { mergeSessionStoreSnapshotView } from './sessionStoreMerge.js'
import { deriveWorkflowViewPatch } from './workflowViewPatch.js'
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
import { sortSessionsByRecency } from './sessionSorting.js'

export type UseSessionStateOptions = {
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  localRouterMode: LocalRouterMode
  providerID: ModelProviderID
  providerBaseURL: string
  debugConversationDump: boolean
  model: string
  planExecutionModel: string
  reviewModel: string
  smallFastModel: string
  fastModel: string
  defaultModel: string
  deepModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  installCodePilotXDependencies: boolean
  enableMemory: boolean
  rustSearchAndDiffKernels: boolean
  onError: (message: string) => void
  onDiffForActive: (patch: string) => void
  onRefreshActiveWorkspace: (sessionId: string) => void
  onOpenDrawerPermissions: () => void
}

export type UseSessionStateResult = {
  sessionId: string | null
  sessionsHydrated: boolean
  catalogStatus: DesktopSessionCatalogStatus
  sessions: SessionListItem[]
  sessionFallbackTitles: Record<string, string>
  sessionStatus: DesktopSessionStatus
  messages: Message[]
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  pendingPermissionSessionIds: ReadonlySet<string>
  contextUsage: DesktopContextUsage | null
  activeSessionItem: SessionListItem | null
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  localRouterMode: LocalRouterMode
  canSubmit: boolean
  input: string
  setInput: (value: string) => void
  activateSessionById: (targetSessionId: string | null) => DesktopWorkspace | null
  createSessionForWorkspace: (target?: DesktopWorkspace | null, initialSessionName?: string) => Promise<string | null>
  submit: (target?: DesktopWorkspace | null) => Promise<void>
  submitToSession: (
    targetSessionId: string,
    value: DesktopUserMessageInput,
  ) => Promise<void>
  interrupt: () => Promise<void>
  decidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: {
      planExecutionModel?: string
      planExecutionProviderID?: string
      planExecutionProviderBaseURL?: string
      savePlanExecutionModel?: boolean
      rememberOptionId?: DesktopPermissionDecision['rememberOptionId']
    },
  ) => Promise<void>
  closeSession: (targetSessionId: string) => Promise<CloseSessionResult | null>
  updateSessionMetadata: (
    targetSessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => Promise<CloseSessionResult | null>
  setSessionPermissionMode: (
    targetSessionId: string,
    mode: DesktopPermissionMode,
  ) => Promise<SessionListItem | null>
  setSessionPlanModeActive: (
    targetSessionId: string,
    active: boolean,
  ) => Promise<SessionListItem | null>
  setSessionLocalRouterMode: (
    targetSessionId: string,
    mode: LocalRouterMode,
  ) => Promise<SessionListItem | null>
  selectSession: (session: SessionListItem) => DesktopWorkspace | null
  toggleToolLogEntry: (entryId: string) => void
}

export function useSessionState(
  options: UseSessionStateOptions,
): UseSessionStateResult {
  const {
    permissionMode,
    planModeActive,
    localRouterMode,
    providerID,
    providerBaseURL,
    debugConversationDump,
    model,
    planExecutionModel,
    reviewModel,
    smallFastModel,
    fastModel,
    defaultModel,
    deepModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    installCodePilotXDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    onError,
    onDiffForActive,
    onRefreshActiveWorkspace,
    onOpenDrawerPermissions,
  } = options

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  const [catalogStatus, setCatalogStatus] = useState<DesktopSessionCatalogStatus>({
    state: 'loading',
    error: null,
  })
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [sessionFallbackTitles, setSessionFallbackTitles] = useState<
    Record<string, string>
  >({})
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<DesktopSessionEvent[]>([])
  const [workflowEvents, setWorkflowEvents] = useState<DesktopWorkflowEvent[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [pendingPermissionSessionIds, setPendingPermissionSessionIds] =
    useState<Set<string>>(() => new Set())
  const [contextUsage, setContextUsage] =
    useState<DesktopContextUsage | null>(null)
  const [input, setInput] = useState('')
  const activeSessionItem = useMemo(
    () => sessions.find(session => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )
  const effectivePermissionMode =
    activeSessionItem?.permissionMode ?? permissionMode
  const effectivePlanModeActive =
    activeSessionItem?.planModeActive ?? planModeActive
  const effectiveLocalRouterMode = activeSessionItem?.id.startsWith('browser-mock-')
    ? activeSessionItem.localRouterMode ?? localRouterMode
    : 'off'

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
      setEvents,
      setWorkflowEvents,
      setMessages,
      setToolLog,
      setPendingPermissions,
      setContextUsage,
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

  const syncPendingPermissionSessionIds = useCallback((): void => {
    const next = buildPendingPermissionSessionIds(sessionViewsRef.current)
    setPendingPermissionSessionIds(current =>
      sameSessionIdSet(current, next) ? current : next,
    )
  }, [])

  const updateSessionView = useCallback<UpdateSessionView>(
    (targetSessionId, updater) => {
      updateSessionViewState(
        viewRefs,
        viewSetters,
        targetSessionId,
        updater,
      )
      syncPendingPermissionSessionIds()
      setSessionFallbackTitles(current =>
        updateSessionFallbackTitle(
          current,
          targetSessionId,
          sessionViewsRef.current[targetSessionId],
        ),
      )
    },
    [syncPendingPermissionSessionIds, viewRefs, viewSetters],
  )

  const addToolLogEntry = useCallback<AddToolLogEntry>(
    (targetSessionId, entry) => {
      addToolLogEntryToView(updateSessionView, targetSessionId, entry)
    },
    [updateSessionView],
  )

  const applyHydratedSessionSnapshot = useCallback(
    (snapshot: Awaited<ReturnType<typeof desktopClient.getSession>>): void => {
      const currentItem = sessionsRef.current.find(
        session => session.id === snapshot.item.id,
      )
      const nextItem: SessionListItem = {
        ...snapshot.item,
        sessionName:
          snapshot.item.sessionName ?? currentItem?.sessionName ?? null,
        customTitle:
          snapshot.item.customTitle ?? currentItem?.customTitle ?? null,
        aiTitle: snapshot.item.aiTitle ?? currentItem?.aiTitle ?? null,
        firstPrompt:
          snapshot.item.firstPrompt ?? currentItem?.firstPrompt ?? null,
      }
      const snapshotView: SessionViewState = {
        ...snapshot.view,
        eventModelVersion: snapshot.eventModelVersion,
        events: snapshot.events ?? [],
        workflowEvents: dedupeWorkflowEvents(
          sessionViewsRef.current[snapshot.item.id]?.workflowEvents ??
            snapshot.workflowEvents ??
            [],
        ),
        contextUsage: snapshot.view.contextUsage ?? null,
        selectedFile:
          sessionViewsRef.current[snapshot.item.id]?.selectedFile ?? null,
      }
      const nextView: SessionViewState = {
        ...snapshotView,
        ...deriveWorkflowViewPatch(
          snapshotView.workflowEvents,
          snapshotView,
          snapshot.item.id,
        ),
      }
      sessionViewsRef.current = {
        ...sessionViewsRef.current,
        [snapshot.item.id]: nextView,
      }
      syncPendingPermissionSessionIds()
      setSessionFallbackTitles(current =>
        updateSessionFallbackTitle(current, snapshot.item.id, nextView),
      )
      sessionWorkspacesRef.current = {
        ...sessionWorkspacesRef.current,
        [snapshot.item.id]: snapshot.workspace,
      }
      sessionsRef.current = sortSessionsByRecency(
        sessionsRef.current.map(session =>
          session.id === snapshot.item.id ? nextItem : session,
        ),
      )
      setSessions(current =>
        sortSessionsByRecency(
          current.map(session =>
            session.id === snapshot.item.id ? nextItem : session,
          ),
        ),
      )
      if (activeSessionIdRef.current === snapshot.item.id) {
        setSessionStatus(nextItem.status)
        applySessionView(nextView, viewSetters)
      }
    },
    [syncPendingPermissionSessionIds, viewSetters],
  )

  const hydrateSessionDetails = useCallback(
    async (targetSessionId: string): Promise<void> => {
      const target = sessionsRef.current.find(
        session => session.id === targetSessionId,
      )
      const currentView = sessionViewsRef.current[targetSessionId]
      const hasHydratedContent = Boolean(
        currentView &&
          (currentView.messages.length > 0 ||
            currentView.toolLog.length > 0 ||
            currentView.events.length > 0),
      )
      if (
        hasHydratedContent ||
        target?.status === 'running' ||
        target?.status === 'waiting'
      ) {
        return
      }
      try {
        const snapshot = await desktopClient.getSession(targetSessionId)
        applyHydratedSessionSnapshot(snapshot)
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [applyHydratedSessionSnapshot],
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

  const handleWorkflowEvent = useCallback(
    (event: DesktopWorkflowEvent): void => {
      if (!sessionsRef.current.some(session => session.id === event.threadId)) {
        return
      }
      const shouldOpenPermissions =
        event.threadId === activeSessionIdRef.current &&
        'item' in event &&
        event.item.type === 'permission_request' &&
        event.item.status === 'in_progress'
      updateSessionView(event.threadId, view => ({
        ...view,
        ...deriveWorkflowViewPatch(
          appendUniqueWorkflowEvent(view.workflowEvents, event),
          view,
          event.threadId,
        ),
      }))
      if (shouldOpenPermissions) {
        onOpenDrawerPermissionsRef.current()
      }
    },
    [updateSessionView],
  )

  useEffect(() => {
    const unsubscribeAgent = desktopClient.onAgentEvent(handleAgentEvent)
    return () => {
      unsubscribeAgent()
    }
  }, [handleAgentEvent])

  useEffect(() => {
    const unsubscribeWorkflow =
      desktopClient.onWorkflowEvent(handleWorkflowEvent)
    return () => {
      unsubscribeWorkflow()
    }
  }, [handleWorkflowEvent])

  useEffect(() => {
    const unsubscribe = desktopClient.onSessionStoreChange(change => {
      const nextSessions = sortSessionsByRecency(
        change.sessions.map(snapshot => snapshot.item),
      )
      const nextViews = { ...sessionViewsRef.current }
      const nextWorkspaces = { ...sessionWorkspacesRef.current }
      for (const snapshot of change.sessions) {
        const snapshotView = mergeSessionStoreSnapshotView(
          nextViews[snapshot.item.id],
          snapshot,
        )
        nextViews[snapshot.item.id] = {
          ...snapshotView,
          ...deriveWorkflowViewPatch(
            snapshotView.workflowEvents,
            snapshotView,
            snapshot.item.id,
          ),
        }
        nextWorkspaces[snapshot.item.id] = snapshot.workspace
      }
      const knownIds = new Set(change.sessions.map(snapshot => snapshot.item.id))
      for (const id of Object.keys(nextViews)) {
        if (!knownIds.has(id)) {
          delete nextViews[id]
        }
      }
      for (const id of Object.keys(nextWorkspaces)) {
        if (!knownIds.has(id)) {
          delete nextWorkspaces[id]
        }
      }
      sessionViewsRef.current = nextViews
      sessionWorkspacesRef.current = nextWorkspaces
      sessionsRef.current = nextSessions
      setPendingPermissionSessionIds(buildPendingPermissionSessionIds(nextViews))
      setSessions(nextSessions)
      setSessionFallbackTitles(buildSessionFallbackTitles(nextViews))

      const currentId = activeSessionIdRef.current
      if (!currentId) return
      const currentSession = nextSessions.find(session => session.id === currentId)
      if (!currentSession || currentSession.archivedAt) {
        activeSessionIdRef.current = null
        setSessionId(null)
        setSessionStatus('idle')
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        return
      }
      setSessionStatus(currentSession.status)
      applySessionView(nextViews[currentId] ?? createEmptySessionView(), viewSetters)
    })
    return () => {
      unsubscribe()
    }
  }, [viewSetters])

  useEffect(() => {
    let disposed = false
    async function hydrateSessions(): Promise<void> {
      try {
        const sessionSnapshots = await desktopClient.listSessions()
        const nextCatalogStatus = await desktopClient.getSessionCatalogStatus()
        if (disposed) return

        setCatalogStatus(nextCatalogStatus)

        const nextSessions = sortSessionsByRecency(
          sessionSnapshots.map(snapshot => snapshot.item),
        )
        const nextViews: Record<string, SessionViewState> = {}
        const nextWorkspaces: Record<string, DesktopWorkspace> = {}
        for (const snapshot of sessionSnapshots) {
          const snapshotView: SessionViewState = {
            ...snapshot.view,
            eventModelVersion: snapshot.eventModelVersion,
            events: snapshot.events ?? [],
            workflowEvents: dedupeWorkflowEvents(snapshot.workflowEvents ?? []),
            contextUsage: snapshot.view.contextUsage ?? null,
            selectedFile: null,
          }
          nextViews[snapshot.item.id] = {
            ...snapshotView,
            ...deriveWorkflowViewPatch(
              snapshotView.workflowEvents,
              snapshotView,
              snapshot.item.id,
            ),
          }
          nextWorkspaces[snapshot.item.id] = snapshot.workspace
        }

        sessionViewsRef.current = nextViews
        sessionWorkspacesRef.current = nextWorkspaces
        sessionsRef.current = nextSessions
        setPendingPermissionSessionIds(
          buildPendingPermissionSessionIds(nextViews),
        )
        setSessions(nextSessions)
        setSessionFallbackTitles(buildSessionFallbackTitles(nextViews))

        activeSessionIdRef.current = null
        setSessionId(null)
        setSessionStatus('idle')
        applySessionView(createEmptySessionView(), viewSetters)
        setInput(inputBySessionRef.current[HOME_INPUT_KEY] ?? '')
        setSessionsHydrated(true)
      } catch (error) {
        setCatalogStatus({
          state: 'unavailable',
          error: 'The app-server is unavailable. Please try again.',
        })
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
      permissionMode: effectivePermissionMode,
      planModeActive: effectivePlanModeActive,
      localRouterMode: effectiveLocalRouterMode,
      providerID,
      providerBaseURL,
      debugConversationDump,
      model,
      planExecutionModel,
      reviewModel,
      smallFastModel,
      fastModel,
      defaultModel,
      deepModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      installCodePilotXDependencies,
      enableMemory,
      rustSearchAndDiffKernels,
    }),
    [
      additionalDirectories,
      appendSystemPrompt,
      installCodePilotXDependencies,
      enableMemory,
      rustSearchAndDiffKernels,
      debugConversationDump,
      fastModel,
      planExecutionModel,
      model,
      reviewModel,
      deepModel,
      effectiveLocalRouterMode,
      effectivePermissionMode,
      effectivePlanModeActive,
      providerBaseURL,
      providerID,
      sessionName,
      smallFastModel,
      defaultModel,
      systemPrompt,
      thinkingMode,
    ],
  )

  const createSessionForWorkspace = useCallback(
    async (target: DesktopWorkspace | null, initialSessionName?: string): Promise<string | null> =>
      createSessionForWorkspaceAction(
        actionContext,
        settingsSnapshot,
        target,
        initialSessionName,
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
      void hydrateSessionDetails(targetSessionId)
      setInput(inputBySessionRef.current[targetSessionId] ?? '')
      if (targetSession.standalone) {
        return null
      }
      return sessionWorkspacesRef.current[targetSessionId] ?? {
        name: targetSession.workspaceName,
        path: targetSession.workspacePath,
      }
    },
    [actionContext, hydrateSessionDetails, viewSetters],
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
    value: DesktopUserMessageInput,
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
          (value.text.trim() || (value.attachments?.length ?? 0) > 0) &&
          targetStatus !== 'running' &&
          targetStatus !== 'waiting',
      ),
      settingsSnapshot,
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
  }, [settingsSnapshot])

  const submit = useCallback(async (target?: DesktopWorkspace | null): Promise<void> => {
    const targetSessionId =
      sessionId ??
      (await createSessionForWorkspaceAction(
        actionContext,
        settingsSnapshot,
        target ?? null,
      ))
    if (!targetSessionId) return
    await submitToSession(targetSessionId, { text: input })
  }, [actionContext, input, sessionId, settingsSnapshot, submitToSession])

  const interrupt = useCallback(async (): Promise<void> => {
    await interruptSessionAction(onErrorRef, sessionId)
  }, [sessionId])

  const decidePermission = useCallback(
    async (
      request: DesktopPermissionRequest,
      behavior: 'allow' | 'deny',
      alwaysAllow = false,
      updatedInput?: Record<string, unknown>,
      decisionExtras?: {
        planExecutionModel?: string
        planExecutionProviderID?: string
        planExecutionProviderBaseURL?: string
        savePlanExecutionModel?: boolean
        rememberOptionId?: DesktopPermissionDecision['rememberOptionId']
      },
    ): Promise<void> => {
      await decidePermissionAction(
        onErrorRef,
        updateSessionView,
        sessionId,
        request,
        behavior,
        alwaysAllow,
        updatedInput,
        decisionExtras,
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

  const setSessionPermissionMode = useCallback(
    async (
      targetSessionId: string,
      mode: DesktopPermissionMode,
    ): Promise<SessionListItem | null> =>
      setSessionPermissionModeAction(
        actionContext,
        sessions,
        targetSessionId,
        mode,
      ),
    [actionContext, sessions],
  )

  const setSessionPlanModeActive = useCallback(
    async (
      targetSessionId: string,
      active: boolean,
    ): Promise<SessionListItem | null> =>
      setSessionPlanModeActiveAction(
        actionContext,
        sessions,
        targetSessionId,
        active,
      ),
    [actionContext, sessions],
  )

  const setSessionLocalRouterMode = useCallback(
    async (
      targetSessionId: string,
      mode: LocalRouterMode,
    ): Promise<SessionListItem | null> =>
      setSessionLocalRouterModeAction(
        actionContext,
        sessions,
        targetSessionId,
        mode,
      ),
    [actionContext, sessions],
  )

  const selectSession = useCallback(
    (session: SessionListItem): DesktopWorkspace | null => {
      const workspace = selectSessionAction(actionContext, session)
      void hydrateSessionDetails(session.id)
      return workspace
    },
    [actionContext, hydrateSessionDetails],
  )

  return {
    sessionId,
    sessionsHydrated,
    catalogStatus,
    sessions,
    sessionFallbackTitles,
    sessionStatus,
    messages,
    events,
    workflowEvents,
    toolLog,
    pendingPermissions,
    pendingPermissionSessionIds,
    contextUsage,
    activeSessionItem,
    permissionMode: effectivePermissionMode,
    planModeActive: effectivePlanModeActive,
    localRouterMode: effectiveLocalRouterMode,
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
    setSessionPermissionMode,
    setSessionPlanModeActive,
    setSessionLocalRouterMode,
    selectSession,
    toggleToolLogEntry,
  }
}

const HOME_INPUT_KEY = '__home__'

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildSessionFallbackTitles(
  views: Record<string, SessionViewState>,
): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const [sessionId, view] of Object.entries(views)) {
    const title = sessionViewFallbackTitle(view)
    if (title) {
      titles[sessionId] = title
    }
  }
  return titles
}

function buildPendingPermissionSessionIds(
  views: Record<string, SessionViewState>,
): Set<string> {
  const ids = new Set<string>()
  for (const [sessionId, view] of Object.entries(views)) {
    if (view.pendingPermissions.length > 0) {
      ids.add(sessionId)
    }
  }
  return ids
}

function sameSessionIdSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false
  for (const id of left) {
    if (!right.has(id)) return false
  }
  return true
}

function updateSessionFallbackTitle(
  current: Record<string, string>,
  sessionId: string,
  view: SessionViewState | undefined,
): Record<string, string> {
  const title = view ? sessionViewFallbackTitle(view) : null
  if (title) {
    if (current[sessionId] === title) return current
    return { ...current, [sessionId]: title }
  }
  if (!(sessionId in current)) return current
  const next = { ...current }
  delete next[sessionId]
  return next
}
