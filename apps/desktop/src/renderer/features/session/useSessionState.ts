import { desktopClient } from '../../services/desktopClient.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopAgentEvent,
  DesktopAgentPickerEntry,
  DesktopBackgroundTerminal,
  DesktopContextUsage,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionMetadataPatch,
  DesktopSessionStatus,
  DesktopThreadGoal,
  DesktopThreadGoalStatus,
  DesktopThinkingMode,
  DesktopUserMessageInput,
  DesktopWorkflowEvent,
  DesktopWorkspace,
  ModelProviderID,
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

export type UseSessionStateOptions = {
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  providerID: ModelProviderID
  providerBaseURL: string
  debugConversationDump: boolean
  model: string
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
  rustSearchAndDiffKernels: boolean
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
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  goal: DesktopThreadGoal | null
  backgroundTerminals: DesktopBackgroundTerminal[]
  agentEntries: DesktopAgentPickerEntry[]
  activeAgentThreadId: string | null
  activeSessionItem: SessionListItem | null
  planModeActive: boolean
  canSubmit: boolean
  input: string
  setInput: (value: string) => void
  activateSessionById: (targetSessionId: string | null) => DesktopWorkspace | null
  createSessionForWorkspace: (target?: DesktopWorkspace | null) => Promise<string | null>
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
  refreshThreadGoal: () => Promise<void>
  saveThreadGoal: (input: {
    objective?: string | null
    status?: DesktopThreadGoalStatus | null
    tokenBudget?: number | null
  }) => Promise<void>
  clearThreadGoal: () => Promise<void>
  refreshBackgroundTerminals: () => Promise<void>
  terminateBackgroundTerminal: (processId: string) => Promise<void>
  cleanBackgroundTerminals: () => Promise<void>
  refreshAgentEntries: () => Promise<void>
  selectAgentThread: (threadId: string | null) => void
  selectSession: (session: SessionListItem) => DesktopWorkspace | null
  toggleToolLogEntry: (entryId: string) => void
}

export function useSessionState(
  options: UseSessionStateOptions,
): UseSessionStateResult {
  const {
    permissionMode,
    planModeActive,
    providerID,
    providerBaseURL,
    debugConversationDump,
    model,
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
    rustSearchAndDiffKernels,
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
  const [events, setEvents] = useState<DesktopSessionEvent[]>([])
  const [workflowEvents, setWorkflowEvents] = useState<DesktopWorkflowEvent[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [contextUsage, setContextUsage] =
    useState<DesktopContextUsage | null>(null)
  const [goal, setGoal] = useState<DesktopThreadGoal | null>(null)
  const [backgroundTerminals, setBackgroundTerminals] = useState<
    DesktopBackgroundTerminal[]
  >([])
  const [agentEntries, setAgentEntries] = useState<DesktopAgentPickerEntry[]>([])
  const [activeAgentThreadId, setActiveAgentThreadId] = useState<string | null>(
    null,
  )
  const [input, setInput] = useState('')
  const activeSessionItem = useMemo(
    () => sessions.find(session => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )
  const effectivePlanModeActive =
    activeSessionItem?.planModeActive ?? planModeActive

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
      setGoal,
      setBackgroundTerminals,
      setAgentEntries,
      setActiveAgentThreadId,
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
        goal:
          sessionViewsRef.current[snapshot.item.id]?.goal ??
          createEmptySessionView().goal,
        backgroundTerminals:
          sessionViewsRef.current[snapshot.item.id]?.backgroundTerminals ?? [],
        agentEntries:
          sessionViewsRef.current[snapshot.item.id]?.agentEntries ?? [],
        activeAgentThreadId:
          sessionViewsRef.current[snapshot.item.id]?.activeAgentThreadId ??
          null,
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
      sessionWorkspacesRef.current = {
        ...sessionWorkspacesRef.current,
        [snapshot.item.id]: snapshot.workspace,
      }
      sessionsRef.current = sessionsRef.current.map(session =>
        session.id === snapshot.item.id ? nextItem : session,
      )
      setSessions(current =>
        current.map(session =>
          session.id === snapshot.item.id ? nextItem : session,
        ),
      )
      if (activeSessionIdRef.current === snapshot.item.id) {
        setSessionStatus(nextItem.status)
        applySessionView(nextView, viewSetters)
      }
    },
    [viewSetters],
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
    let disposed = false
    async function hydrateSessions(): Promise<void> {
      try {
        const sessionSnapshots = await desktopClient.listSessions()
        if (disposed) return

        const nextSessions = sessionSnapshots.map(snapshot => snapshot.item)
        const nextViews: Record<string, SessionViewState> = {}
        const nextWorkspaces: Record<string, DesktopWorkspace> = {}
        for (const snapshot of sessionSnapshots) {
          const snapshotView: SessionViewState = {
            ...snapshot.view,
            eventModelVersion: snapshot.eventModelVersion,
            events: snapshot.events ?? [],
            workflowEvents: dedupeWorkflowEvents(snapshot.workflowEvents ?? []),
            contextUsage: snapshot.view.contextUsage ?? null,
            goal: null,
            backgroundTerminals: [],
            agentEntries: [],
            activeAgentThreadId: null,
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
      planModeActive: effectivePlanModeActive,
      providerID,
      providerBaseURL,
      debugConversationDump,
      model,
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
      rustSearchAndDiffKernels,
    }),
    [
      additionalDirectories,
      appendSystemPrompt,
      rustSearchAndDiffKernels,
      debugConversationDump,
      fastModel,
      model,
      reviewModel,
      deepModel,
      effectivePlanModeActive,
      permissionMode,
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

  const refreshThreadGoalForSession = useCallback(
    async (targetSessionId: string): Promise<void> => {
      try {
        const nextGoal = await desktopClient.getThreadGoal(targetSessionId)
        updateSessionView(targetSessionId, view => ({
          ...view,
          goal: nextGoal,
        }))
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [updateSessionView],
  )

  const refreshBackgroundTerminalsForSession = useCallback(
    async (targetSessionId: string): Promise<void> => {
      try {
        const nextTerminals =
          await desktopClient.listBackgroundTerminals(targetSessionId)
        updateSessionView(targetSessionId, view => ({
          ...view,
          backgroundTerminals: nextTerminals,
        }))
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [updateSessionView],
  )

  const refreshAgentEntriesForSession = useCallback(
    async (targetSessionId: string): Promise<void> => {
      const listAgentPickerEntries = (
        desktopClient as typeof desktopClient & {
          listAgentPickerEntries?: (
            sessionId: string,
          ) => Promise<DesktopAgentPickerEntry[]>
        }
      ).listAgentPickerEntries
      if (typeof listAgentPickerEntries !== 'function') return
      try {
        const nextAgents = await listAgentPickerEntries(targetSessionId)
        updateSessionView(targetSessionId, view => ({
          ...view,
          agentEntries: nextAgents,
          activeAgentThreadId:
            view.activeAgentThreadId ??
            nextAgents.find(agent => agent.isPrimary)?.sourceThreadId ??
            null,
        }))
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [updateSessionView],
  )

  const refreshLiveSessionState = useCallback(
    async (targetSessionId: string): Promise<void> => {
      await Promise.all([
        refreshThreadGoalForSession(targetSessionId),
        refreshBackgroundTerminalsForSession(targetSessionId),
        refreshAgentEntriesForSession(targetSessionId),
      ])
    },
    [
      refreshAgentEntriesForSession,
      refreshBackgroundTerminalsForSession,
      refreshThreadGoalForSession,
    ],
  )

  useEffect(() => {
    if (!sessionId) return
    void refreshLiveSessionState(sessionId)
  }, [refreshLiveSessionState, sessionId])

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
    ): Promise<void> => {
      await decidePermissionAction(
        onErrorRef,
        updateSessionView,
        sessionId,
        request,
        behavior,
        alwaysAllow,
        updatedInput,
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

  const refreshThreadGoal = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    await refreshThreadGoalForSession(sessionId)
  }, [refreshThreadGoalForSession, sessionId])

  const saveThreadGoal = useCallback(
    async (input: {
      objective?: string | null
      status?: DesktopThreadGoalStatus | null
      tokenBudget?: number | null
    }): Promise<void> => {
      if (!sessionId) return
      try {
        const nextGoal = await desktopClient.setThreadGoal(sessionId, input)
        updateSessionView(sessionId, view => ({ ...view, goal: nextGoal }))
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [sessionId, updateSessionView],
  )

  const clearThreadGoal = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await desktopClient.clearThreadGoal(sessionId)
      updateSessionView(sessionId, view => ({ ...view, goal: null }))
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
    }
  }, [sessionId, updateSessionView])

  const refreshBackgroundTerminals = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    await refreshBackgroundTerminalsForSession(sessionId)
  }, [refreshBackgroundTerminalsForSession, sessionId])

  const terminateBackgroundTerminal = useCallback(
    async (processId: string): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.terminateBackgroundTerminal(sessionId, processId)
        await refreshBackgroundTerminalsForSession(sessionId)
      } catch (error) {
        onErrorRef.current(errorMessageOf(error))
      }
    },
    [refreshBackgroundTerminalsForSession, sessionId],
  )

  const cleanBackgroundTerminals = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await desktopClient.cleanBackgroundTerminals(sessionId)
      await refreshBackgroundTerminalsForSession(sessionId)
    } catch (error) {
      onErrorRef.current(errorMessageOf(error))
    }
  }, [refreshBackgroundTerminalsForSession, sessionId])

  const refreshAgentEntries = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    await refreshAgentEntriesForSession(sessionId)
  }, [refreshAgentEntriesForSession, sessionId])

  const selectAgentThread = useCallback(
    (threadId: string | null): void => {
      if (!sessionId) return
      updateSessionView(sessionId, view => ({
        ...view,
        activeAgentThreadId: threadId,
      }))
    },
    [sessionId, updateSessionView],
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
    sessions,
    sessionStatus,
    messages,
    events,
    workflowEvents,
    toolLog,
    pendingPermissions,
    contextUsage,
    goal,
    backgroundTerminals,
    agentEntries,
    activeAgentThreadId,
    activeSessionItem,
    planModeActive: effectivePlanModeActive,
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
    refreshThreadGoal,
    saveThreadGoal,
    clearThreadGoal,
    refreshBackgroundTerminals,
    terminateBackgroundTerminal,
    cleanBackgroundTerminals,
    refreshAgentEntries,
    selectAgentThread,
    selectSession,
    toggleToolLogEntry,
  }
}

const HOME_INPUT_KEY = '__home__'

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
