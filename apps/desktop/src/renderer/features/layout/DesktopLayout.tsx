import {
  desktopClient,
  readDesktopBrowserDebugMode,
  writeDesktopBrowserDebugMode,
} from '../../services/desktopClient.js'
import type React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  DesktopComposer,
  getDesktopComposerBranchName,
} from '../session/DesktopComposer.js'
import { DesktopAppShell } from './DesktopAppShell.js'
import { RightDock, DesktopWorkspaceFixedControls } from './RightDock.js'
import {
  applyRightDockAction,
  type RightDockState,
  type RightDockToolId,
} from './rightDockState.js'
import { rightDockTools, isRightDockToolEnabled, type RightDockPlan } from './rightDockTools.js'
import {
  createDefaultConversationUiState,
  saveConversationUiState,
  loadConversationUiState,
  validateConversationUiState,
  type ConversationUiState,
} from './conversationUiState.js'
import { DesktopSidebar } from './DesktopSidebar.js'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import {
  GitWorkflowModal,
  type GitWorkflowMode,
} from './GitWorkflowModal.js'
import { GithubRepositoryModal } from './GithubRepositoryModal.js'
import { SettingsSidebarContent } from '../settings/SettingsSidebarContent.js'
import { SidebarFrame } from './SidebarFrame.js'
import { MenuBar } from './MenuBar.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from './MenuBar.js'
import { QuickChatContext } from '../session/QuickChatContext.js'
import { SearchContext } from '../search/SearchContext.js'
import type { SessionListItem } from '../../uiTypes.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDesktopLayout,
} from './useDesktopLayout.js'
import {
  NO_WORKSPACE_DIFF,
  useWorkspaceState,
} from '../workspace/useWorkspaceState.js'
import { shouldRestoreLastWorkspace } from '../workspace/lastWorkspaceRestore.js'
import { useSessionState } from '../session/useSessionState.js'
import { useDesktopCommands } from '../session/useDesktopCommands.js'
import { useDesktopSearch } from '../search/useDesktopSearch.js'
import {
  useModelCatalogLoading,
  withModelCatalogLoading,
} from '../../hooks/useModelCatalogLoading.js'
import {
  buildModelPresets,
  resolveModelPresetId,
} from '../../modelPresets.js'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopModelProviderState,
  DesktopBrowserState,
  DesktopComposerAttachment,
  DesktopPermissionMode,
  DesktopRemovedWorkspace,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
  SidebarSectionId,
} from '../../../shared/types.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { upsertRecentWorkspace } from '../../../shared/settings.js'

const RUNTIME_WARNING_MESSAGE =
  '桌面端 agent 运行时缺失，发送消息前请先执行 `bun run desktop:agent:build`。'
const QUICK_CHAT_PATH = '/quick-chat'
const RIGHT_DOCK_WIDTH_STORAGE_KEY = 'codex.desktop.rightDockWidth'
const RIGHT_DOCK_MIN_WIDTH = 400
const RIGHT_DOCK_MAX_WIDTH = 850
const RIGHT_DOCK_DEFAULT_WIDTH = 680
const RIGHT_DOCK_MAIN_MIN_WIDTH = 520

export function DesktopLayout(): React.ReactNode {
  const settings = useDesktopSettings()
  const {
    permissionMode,
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
    installCodexDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    enableParetoCodeRouter,
    enableFusionRouter,
    enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode,
    recentWorkspaces,
    selectedModelPreset,
    providerID,
    providerBaseURL,
    showContextUsage,
    diffMarkerStyle,
    reviewView,
    gitBranchPrefix,
    allowForcePush,
    commitMessagePrompt,
    pullRequestPrompt,
    settingsLoaded,
    setPermissionMode,
    setModel,
    setProviderBaseURL,
    setProviderID,
    setThinkingMode,
	    setRecentWorkspaces,
	    setDrawerTab,
	    setSelectedModelPreset,
	    setReviewView,
	    collapsedSidebarSections,
	    setCollapsedSidebarSections,
	    syncExternalSettingsPatch,
  } = settings
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [runtimeWarningDismissed, setRuntimeWarningDismissed] = useState(false)
  const [archiveNoticeVisible, setArchiveNoticeVisible] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [modelProviders, setModelProviders] = useState<
    DesktopModelProviderSummary[]
  >([])
  const [gitWorkflowMode, setGitWorkflowMode] =
    useState<GitWorkflowMode | null>(null)
  const [githubRepositoryModalOpen, setGithubRepositoryModalOpen] =
    useState(false)
  const [browserState, setBrowserState] = useState<DesktopBrowserState | null>(
    null,
  )
  const [composerAttachments, setComposerAttachments] = useState<
    DesktopComposerAttachment[]
  >([])
  const [rightDockState, setRightDockState] = useState<RightDockState>({
    open: false,
    activeTool: null,
    openTools: [],
  })
  const [rightDockPlan, setRightDockPlan] = useState<RightDockPlan | null>(null)
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false)
  const [sideChatInput, setSideChatInput] = useState('')
  const [sideChatFocusVersion, setSideChatFocusVersion] = useState(0)
  const [sideChatAttachments, setSideChatAttachments] = useState<
    DesktopComposerAttachment[]
  >([])
  const [menubarDebugMode, setMenubarDebugMode] = useState(() =>
    readDesktopBrowserDebugMode(),
  )
  const [rightDockWidth, setRightDockWidth] = useState(() =>
    getInitialRightDockWidth(),
  )
  const modelCatalogLoading = useModelCatalogLoading()

  const layout = useDesktopLayout()
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  } = layout

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const [unavailableWorkspacePaths, setUnavailableWorkspacePaths] = useState<
    Set<string>
  >(() => new Set())
  const [removedWorkspaces, setRemovedWorkspaces] = useState<
    DesktopRemovedWorkspace[]
  >(() => settings.draft.values.removedWorkspaces ?? [])
  const [lastActiveWorkspacePath, setLastActiveWorkspacePath] = useState(
    () => settings.draft.values.lastActiveWorkspacePath ?? '',
  )
  const markWorkspaceUnavailable = useCallback((target: DesktopWorkspace): void => {
    setErrorMessage(null)
    setUnavailableWorkspacePaths(current => {
      if (current.has(target.path)) return current
      const next = new Set(current)
      next.add(target.path)
      return next
    })
  }, [])
  const clearWorkspaceRemoved = useCallback(
    (target: DesktopWorkspace): void => {
      setRemovedWorkspaces(current => {
        const next = current.filter(r => r.path !== target.path)
        if (next.length === current.length) return current
        settings.syncExternalSettingsPatch({ removedWorkspaces: next })
        return next
      })
    },
    [settings],
  )
  const clearWorkspaceUnavailable = useCallback((target: DesktopWorkspace): void => {
    setUnavailableWorkspacePaths(current => {
      if (!current.has(target.path)) return current
      const next = new Set(current)
      next.delete(target.path)
      return next
    })
  }, [])

  const workspace = useWorkspaceState({
    onError: (message: string) => setErrorMessage(message || null),
    onWorkspaceUnavailable: markWorkspaceUnavailable,
    onRecentWorkspacesChange: next => {
      setRecentWorkspaces(next)
    },
  })
  const {
    workspace: currentWorkspace,
    files: workspaceFiles,
    selectedFile,
    runtimeStatus,
    setActiveSessionId,
    refreshWorkspace,
    chooseWorkspace,
    openRecentWorkspace,
    previewFile,
    setSelectedFile,
    setWorkspace: setWorkspaceState,
    setDiff: setDiffState,
    gitStatus,
  } = workspace

  const derivedDefaultBranch = useMemo(() => {
    if (!gitStatus?.upstream) return null
    const upstream = gitStatus.upstream
    const lastSlash = upstream.lastIndexOf('/')
    return lastSlash >= 0 ? upstream.slice(lastSlash + 1) : upstream
  }, [gitStatus?.upstream])
  const [homePlanModeActive, setHomePlanModeActive] = useState(false)
  const [homeLocalRouterMode, setHomeLocalRouterMode] = useState<'off'>('off')

  const session = useSessionState({
    permissionMode,
    planModeActive: homePlanModeActive,
    localRouterMode: homeLocalRouterMode,
    providerID,
    providerBaseURL,
    debugConversationDump: menubarDebugMode,
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
    installCodexDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    onError: (message: string) => setErrorMessage(message),
    onDiffForActive: (patch: string) => setDiffState(patch),
    onRefreshActiveWorkspace: (sessionId: string) => {
      const target = session.sessionId === sessionId ? currentWorkspace : null
      if (!target) return
      void refreshWorkspace(target, {
        clearSelectedFile: false,
        expectedSessionId: sessionId,
      })
    },
    onOpenDrawerPermissions: () => setDrawerTab('permissions'),
  })
  const {
    sessionId,
    sessionsHydrated,
    sessions,
    sessionStatus,
    events,
    workflowEvents,
    messages,
    contextUsage,
    pendingPermissions,
    input,
    setInput,
    activateSessionById,
    createSessionForWorkspace,
    submitToSession,
    interrupt,
    decidePermission,
    updateSessionMetadata,
    setSessionPermissionMode,
    setSessionPlanModeActive,
    setSessionLocalRouterMode,
    activeSessionItem,
    planModeActive,
  } = session

  const effectiveLocalRouterMode: LocalRouterMode =
    activeSessionItem?.localRouterMode ?? homeLocalRouterMode

  const location = useLocation()
  const navigate = useNavigate()
  const routedSessionId = getRoutedSessionId(location.pathname)
  const isQuickChatPage = location.pathname === QUICK_CHAT_PATH
  const isConversationRoute = routedSessionId !== null
  const isSettingsRoute = location.pathname === '/settings'
  const fullLocationPath = `${location.pathname}${location.search}${location.hash}`
  const settingsReturnPathRef = useRef(QUICK_CHAT_PATH)
  const lastWorkspaceRestoreAttemptedRef = useRef(false)
  const settingsActiveTab =
    new URLSearchParams(location.search).get('tab') ?? 'general'

  useEffect(() => {
    if (!settingsLoaded) return
    setRemovedWorkspaces(settings.draft.values.removedWorkspaces)
    setLastActiveWorkspacePath(settings.draft.values.lastActiveWorkspacePath)
  }, [
    settings.draft.values.lastActiveWorkspacePath,
    settings.draft.values.removedWorkspaces,
    settingsLoaded,
  ])

  useEffect(() => {
    if (!isSettingsRoute) {
      settingsReturnPathRef.current = fullLocationPath
    }
  }, [fullLocationPath, isSettingsRoute])

  useEffect(() => {
    setActiveSessionId(sessionId)
  }, [sessionId, setActiveSessionId])

  useLayoutEffect(() => {
    if (!sessionsHydrated) return
    if (!routedSessionId) {
      activateSessionById(null)
      return
    }

    const routedSession = sessions.find(item => item.id === routedSessionId)
    if (!routedSession) {
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      setErrorMessage(`找不到对话：${routedSessionId}`)
      navigate(QUICK_CHAT_PATH, { replace: true })
      return
    }

    if (routedSession.archivedAt) {
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState(NO_WORKSPACE_DIFF)
      setSelectedFile(null)
      navigate(QUICK_CHAT_PATH, { replace: true })
      return
    }

    if (sessionId === routedSessionId) return

    const nextWorkspace = activateSessionById(routedSessionId)
    if (!nextWorkspace) {
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      return
    }
    setWorkspaceState(nextWorkspace)
    void refreshWorkspace(nextWorkspace, {
      expectedSessionId: routedSessionId,
    })
  }, [
    activateSessionById,
    navigate,
    refreshWorkspace,
    routedSessionId,
    sessionId,
    sessions,
    sessionsHydrated,
    setDiffState,
    setSelectedFile,
    setWorkspaceState,
  ])

  const handleChooseWorkspace = useCallback(
    async (): Promise<DesktopWorkspace | null> => {
      const selected = await chooseWorkspace()
      if (!selected) return null
      clearWorkspaceUnavailable(selected)
      clearWorkspaceRemoved(selected)
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      setLastActiveWorkspacePath(selected.path)
      settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
      await refreshWorkspace(selected)
      return selected
    },
    [
      chooseWorkspace,
      clearWorkspaceUnavailable,
      clearWorkspaceRemoved,
      navigate,
      refreshWorkspace,
      setWorkspaceState,
      settings,
    ],
  )

  const handleOpenRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      if (unavailableWorkspacePaths.has(target.path)) return null
      const selected = await openRecentWorkspace(target)
      if (!selected) return null
      clearWorkspaceUnavailable(selected)
      clearWorkspaceRemoved(selected)
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      setLastActiveWorkspacePath(selected.path)
      settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
      await refreshWorkspace(selected)
      return selected
    },
    [
      clearWorkspaceUnavailable,
      clearWorkspaceRemoved,
      navigate,
      openRecentWorkspace,
      refreshWorkspace,
      setWorkspaceState,
      unavailableWorkspacePaths,
      settings,
    ],
  )

  const handleClearWorkspace = useCallback((): void => {
    navigate(QUICK_CHAT_PATH)
    activateSessionById(null)
    setWorkspaceState(null)
    setDiffState(NO_WORKSPACE_DIFF)
    setSelectedFile(null)
    setInput('')
    setComposerAttachments([])
  }, [
    activateSessionById,
    navigate,
    setDiffState,
    setInput,
    setSelectedFile,
    setWorkspaceState,
  ])

  const handleGithubWorkspaceCloned = useCallback(
    (selected: DesktopWorkspace): void => {
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      setLastActiveWorkspacePath(selected.path)
      settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
      void refreshWorkspace(selected)
    },
    [navigate, refreshWorkspace, setWorkspaceState, settings],
  )

  useEffect(() => {
    if (
      !shouldRestoreLastWorkspace({
        settingsLoaded,
        isQuickChatPage,
        hasCurrentWorkspace: Boolean(currentWorkspace),
        hasAttemptedRestore: lastWorkspaceRestoreAttemptedRef.current,
        hasLastActiveWorkspacePath: Boolean(lastActiveWorkspacePath),
      })
    ) {
      return
    }
    const lastWorkspace = recentWorkspaces.find(
      w => w.path === lastActiveWorkspacePath,
    ) ?? recentWorkspaces[0]
    if (!lastWorkspace) return
    lastWorkspaceRestoreAttemptedRef.current = true
    void handleOpenRecentWorkspace(lastWorkspace)
  }, [
    currentWorkspace,
    handleOpenRecentWorkspace,
    isQuickChatPage,
    lastActiveWorkspacePath,
    recentWorkspaces,
    settingsLoaded,
  ])

  const handleCreateSession = useCallback(async (
    target?: DesktopWorkspace | null,
  ): Promise<void> => {
    if (target === null) {
      navigate(QUICK_CHAT_PATH)
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      setInput('')
      setComposerAttachments([])
      return
    }
    const targetWorkspace = target === undefined ? currentWorkspace : target
    if (targetWorkspace && targetWorkspace.path !== currentWorkspace?.path) {
      const selected = await handleOpenRecentWorkspace(targetWorkspace)
      if (!selected) return
    } else {
      navigate(QUICK_CHAT_PATH)
    }
    activateSessionById(null)
    setInput('')
    setComposerAttachments([])
  }, [
    activateSessionById,
    currentWorkspace,
    handleOpenRecentWorkspace,
    navigate,
    setDiffState,
    setInput,
    setSelectedFile,
    setWorkspaceState,
  ])

  const handleBranchSelect = useCallback(
    async (branch: string): Promise<void> => {
      if (!currentWorkspace || currentWorkspace.branchName === branch) {
        return
      }
      try {
        const nextWorkspace = await desktopClient.checkoutWorkspaceBranch(
          currentWorkspace.path,
          branch,
        )
        setWorkspaceState(nextWorkspace)
        await refreshWorkspace(nextWorkspace, { clearSelectedFile: true })
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : String(error ?? '无法切换分支'),
        )
      }
    },
    [currentWorkspace, refreshWorkspace, setWorkspaceState],
  )

  const handleWorkspaceChanged = useCallback(
    async (nextWorkspace: DesktopWorkspace): Promise<void> => {
      setWorkspaceState(nextWorkspace)
      await refreshWorkspace(nextWorkspace, { clearSelectedFile: true })
    },
    [refreshWorkspace, setWorkspaceState],
  )

  const handleOpenWorkspacePath = useCallback((): void => {
    if (!currentWorkspace) return
    void desktopClient
      .openPathWithDefaultTarget(currentWorkspace.path)
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [currentWorkspace])

  const handleRefreshDiff = useCallback((): void => {
    if (!currentWorkspace) return
    void refreshWorkspace(currentWorkspace, { clearSelectedFile: false })
  }, [currentWorkspace, refreshWorkspace])

  useEffect(() => {
    writeDesktopBrowserDebugMode(undefined, menubarDebugMode)
    if (menubarDebugMode) {
      void desktopClient.openDevTools()
    }
  }, [menubarDebugMode])

  const refreshBrowserState = useCallback((): void => {
    void desktopClient
      .getBrowserState()
      .then(setBrowserState)
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [])

  const openRightDockTool = useCallback(
    (tool: RightDockToolId): void => {
      setRightDockState(current =>
        applyRightDockAction(
          current,
          { type: 'openTool', tool },
          { debugMode: menubarDebugMode },
        ),
      )
    },
    [menubarDebugMode],
  )

  const selectRightDockTool = useCallback(
    (tool: RightDockToolId): void => {
      setRightDockState(current =>
        applyRightDockAction(current, { type: 'selectTool', tool }),
      )
    },
    [],
  )

  const closeRightDockTool = useCallback(
    (tool: RightDockToolId): void => {
      setRightDockState(current =>
        applyRightDockAction(current, { type: 'closeTool', tool }),
      )
    },
    [],
  )

  const closeRightDock = useCallback((): void => {
    setRightDockState(current => applyRightDockAction(current, { type: 'close' }))
  }, [])

  const handleSetRightDockWidth = useCallback((nextWidth: number): void => {
    setRightDockWidth(clampRightDockWidth(nextWidth))
  }, [])

  const handleResetRightDockWidth = useCallback((): void => {
    setRightDockWidth(clampRightDockWidth(RIGHT_DOCK_DEFAULT_WIDTH))
  }, [])

  const handleOpenBrowser = useCallback((): void => {
    openRightDockTool('browser')
    void desktopClient
      .openBrowser()
      .then(setBrowserState)
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [openRightDockTool])

  const handleOpenFilesDock = useCallback((): void => {
    openRightDockTool('files')
  }, [openRightDockTool])

  const handleOpenPlanDock = useCallback(
    (plan: RightDockPlan): void => {
      setRightDockPlan(plan)
      openRightDockTool('plan')
    },
    [openRightDockTool],
  )

  const handleRightDockToolSelect = useCallback(
    (tool: RightDockToolId): void => {
      if (tool === 'browser') {
        handleOpenBrowser()
        return
      }
      openRightDockTool(tool)
    },
    [handleOpenBrowser, openRightDockTool],
  )

  const handleReloadBrowser = useCallback((): void => {
    void desktopClient
      .reloadBrowser()
      .then(setBrowserState)
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [])

  const handleBrowserAnnotation = useCallback(
    (annotation: string): void => {
      const separator = input.trim() ? '\n\n' : ''
      setInput(`${input}${separator}${annotation}`)
    },
    [input, setInput],
  )

  const handleAppendComposerText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      const separator = input.trim() ? '\n\n' : ''
      setInput(`${input}${separator}${trimmed}`)
    },
    [input, setInput],
  )

  const handleAppendSideChatText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSideChatInput(prev => {
        const existing = prev.trim()
        if (!existing) return trimmed
        return `${prev}\n\n${trimmed}`
      })
      setSideChatFocusVersion(v => v + 1)
      setRightDockState(current =>
        applyRightDockAction(
          current,
          { type: 'openTool', tool: 'sideChat' },
          { debugMode: menubarDebugMode },
        ),
      )
    },
    [menubarDebugMode],
  )

  const sideChatSubmitToSession = useCallback(
    async (
      sessionId: string,
      value: { text: string; attachments: DesktopComposerAttachment[] },
    ): Promise<void> => {
      await submitToSession(sessionId, value)
      setSideChatInput('')
      setSideChatAttachments([])
    },
    [submitToSession],
  )

  const handleSubmitEditedUserMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!activeSessionItem) return
      await submitToSession(activeSessionItem.id, {
        text,
        attachments: [],
      })
    },
    [activeSessionItem, submitToSession],
  )

  const handleAddComposerFiles = useCallback((filePaths: string[]): void => {
    if (filePaths.length === 0) return
    void desktopClient
      .authorizeComposerFilePaths(filePaths)
      .then(() => desktopClient.readComposerFiles(filePaths))
      .then(nextAttachments => {
        if (nextAttachments.length === 0) return
        setComposerAttachments(current => {
          const attachmentIds = new Set(
            current.map(attachment => attachment.id),
          )
          return [
            ...current,
            ...nextAttachments.filter(
              attachment => !attachmentIds.has(attachment.id),
            ),
          ]
        })
      })
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [])

  const handleNewConversation = useCallback(async (): Promise<void> => {
    activateSessionById(null)
    setInput('')
    navigate(QUICK_CHAT_PATH)
  }, [
    activateSessionById,
    navigate,
    setInput,
  ])

  useDesktopCommands({
    onNewConversation: () => {
      void handleNewConversation()
    },
    onChooseWorkspace: () => {
      void handleChooseWorkspace()
    },
    onRefreshWorkspace: () => {
      void refreshWorkspace()
    },
    onOpenSettings: () => {
      navigate('/settings')
    },
    onLogOut: () => {
      setErrorMessage('已退出登录。本地桌面端暂无持久账号切换，请重启应用。')
    },
  })

  useEffect(() => {
    refreshBrowserState()
  }, [refreshBrowserState])

  useEffect(() => {
    if (!browserState?.open) return
    const id = window.setInterval(refreshBrowserState, 1000)
    return () => window.clearInterval(id)
  }, [browserState?.open, refreshBrowserState])

  useEffect(() => {
    window.localStorage.setItem(
      RIGHT_DOCK_WIDTH_STORAGE_KEY,
      String(rightDockWidth),
    )
  }, [rightDockWidth])

  const prevSessionIdRef = useRef<string | null>(null)
  const uiSnapshotRef = useRef<ConversationUiState>(
    createDefaultConversationUiState(),
  )
  uiSnapshotRef.current = {
    rightDock: {
      open: rightDockState.open,
      activeTool: rightDockState.activeTool,
      openTools: rightDockState.openTools,
    },
    plan: rightDockPlan,
    mainScrollTop: 0,
    sideChatInput,
    sideChatAttachments,
  }

  useEffect(() => {
    const prevId = prevSessionIdRef.current
    const currentId = sessionId

    if (prevId && prevId !== currentId) {
      saveConversationUiState(prevId, uiSnapshotRef.current)
    }

    prevSessionIdRef.current = currentId

    const flags = { debugMode: menubarDebugMode }
    const enabledTools = rightDockTools
      .filter(tool => isRightDockToolEnabled(tool.id, flags))
      .map(tool => tool.id)

    if (currentId) {
      const saved = loadConversationUiState(currentId)
      if (saved) {
        const validated = validateConversationUiState(saved, enabledTools)
        setRightDockState({
          open: validated.rightDock.open,
          activeTool: validated.rightDock.activeTool,
          openTools: validated.rightDock.openTools,
        })
        setRightDockPlan(validated.plan)
        setSideChatInput(validated.sideChatInput)
        setSideChatAttachments(validated.sideChatAttachments)
      } else {
        /* No saved state — force defaults */
        setRightDockState({
          open: false,
          activeTool: null,
          openTools: [],
        })
        setRightDockPlan(null)
        setSideChatInput('')
        setSideChatAttachments([])
      }
    } else {
      /* Quick-chat — force defaults */
      setRightDockState({
        open: false,
        activeTool: null,
        openTools: [],
      })
      setRightDockPlan(null)
      setSideChatInput('')
      setSideChatAttachments([])
    }
  }, [sessionId, menubarDebugMode])

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      const currentSessionId = sessionId
      if (currentSessionId) {
        saveConversationUiState(currentSessionId, uiSnapshotRef.current)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sessionId])

  useEffect(() => {
    const onResize = (): void => {
      setRightDockWidth(current => clampRightDockWidth(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'b') {
        return
      }
      event.preventDefault()
      handleOpenBrowser()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpenBrowser])

  const handleFileMenuAction = useCallback(
    (action: FileMenuAction): void => {
      switch (action) {
        case 'close':
          void desktopClient.closeWindow()
          break
        case 'newWindow':
          void desktopClient.newWindow()
          break
        case 'newChat':
          void handleNewConversation()
          break
        case 'quickChat':
          navigate(QUICK_CHAT_PATH)
          break
        case 'openFolder':
          void handleChooseWorkspace()
          break
        case 'openSettings':
          void desktopClient.openSettings()
          break
        case 'logOut':
          void desktopClient.logOut()
          break
        case 'exit':
          void desktopClient.exitApp()
          break
      }
    },
    [handleChooseWorkspace, handleNewConversation, navigate],
  )

  const handleEditMenuAction = useCallback(
    (_action: EditMenuAction): void => {},
    [],
  )

  const handleViewMenuAction = useCallback(
    (action: ViewMenuAction): void => {
      if (action === 'toggleSidebar') {
        toggleSidebarCollapsed()
        return
      }
      if (action === 'openBrowserTab') {
        handleOpenBrowser()
        return
      }
      if (action === 'toggleFileTree') {
        handleOpenFilesDock()
        return
      }
      if (action === 'toggleSidePanel') {
        setRightDockState(current => {
          if (current.open) {
            return applyRightDockAction(current, { type: 'close' })
          }
          if (current.openTools.length > 0) {
            return { ...current, open: true }
          }
          return current
        })
        return
      }
      if (action === 'reloadBrowserPage') {
        handleReloadBrowser()
        return
      }
    },
    [
      handleOpenBrowser,
      handleOpenFilesDock,
      handleReloadBrowser,
      toggleSidebarCollapsed,
    ],
  )

  const handleWindowMenuAction = useCallback(
    (action: WindowMenuAction): void => {
      switch (action) {
        case 'minimize':
          void desktopClient.minimizeWindow()
          break
        case 'zoom':
          void desktopClient
            .toggleWindowMaximized()
            .then(next => setIsWindowMaximized(next))
          break
        case 'close':
          void desktopClient.closeWindow()
          break
      }
    },
    [setIsWindowMaximized],
  )

  const handleHelpMenuAction = useCallback(
    (_action: HelpMenuAction): void => {},
    [],
  )

  const modelPresets = useMemo(
    () =>
      buildModelPresets(
        providerState?.models ?? providerState?.provider.defaultModels ?? [],
      ),
    [providerState],
  )
  const syncedSessionModelRef = useRef<string | null>(null)
  const modelRef = useRef(model)
  const activeSessionModelRef = useRef<string | null>(null)
  const fetchedModelCatalogKeysRef = useRef<Set<string>>(new Set())
  const pendingModelCatalogKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    modelRef.current = model
  }, [model])
  useEffect(() => {
    activeSessionModelRef.current = activeSessionItem?.model?.trim() || null
  }, [activeSessionItem?.model])
  const providerModelOptions = useMemo(
    () => {
      const providers = [...modelProviders]
      if (
        providerState &&
        !providers.some(
          provider => provider.providerID === providerState.provider.providerID,
        )
      ) {
        providers.unshift(providerState.provider)
      }
      return providers.filter(provider => provider.apiKeyConfigured).map(provider => {
        const isSelected =
          provider.providerID === providerState?.selectedProviderID
        const models = isSelected
          ? providerState?.models ?? provider.defaultModels
          : provider.defaultModels
        return {
          providerID: provider.providerID,
          displayName: provider.displayName,
          modelPresets: buildModelPresets(models),
          baseURL: provider.baseURL,
        }
      })
    },
    [modelProviders, providerState],
  )
  const selectedProviderID = providerState?.selectedProviderID ?? providerID
  const selectedProviderModelPresets =
    providerModelOptions.find(
      provider => provider.providerID === selectedProviderID,
    )?.modelPresets ?? modelPresets
  const resolvedSelectedModelPreset = resolveModelPresetId(
    model,
    selectedModelPreset,
    selectedProviderModelPresets,
  )
  const selectedProviderSummary =
    modelProviders.find(provider => provider.providerID === selectedProviderID) ??
    (providerState?.provider.providerID === selectedProviderID
      ? providerState.provider
      : undefined)
  const selectedModelMetadata =
    model && selectedProviderSummary?.modelMetadata
      ? selectedProviderSummary.modelMetadata[model]
      : model && providerState?.modelMetadata
        ? providerState.modelMetadata[model]
        : undefined
  const deepSeekThinkingControls = isDeepSeekThinkingModel({
    providerID: selectedProviderID,
    model,
    metadata: selectedModelMetadata,
  })
  const showThinkingOptions =
    deepSeekThinkingControls ||
    selectedProviderSummary?.kind === 'anthropic' ||
    selectedModelMetadata?.reasoning === true
  const modelConfigured = providerState?.modelConfigured === true
  const modelConfigurationMessage =
    providerState?.configurationMessage ?? '未配置模型，请先在设置中配置模型。'

  useEffect(() => {
    const activeModel = activeSessionItem?.model?.trim()
    const syncKey =
      activeSessionItem?.id && activeModel
        ? `${activeSessionItem.id}:${activeModel}`
        : null
    if (!activeModel || !syncKey || syncedSessionModelRef.current === syncKey) {
      return
    }
    syncedSessionModelRef.current = syncKey
    if (model !== activeModel) {
      setModel(activeModel)
    }
    const nextPreset = resolveModelPresetId(
      activeModel,
      undefined,
      selectedProviderModelPresets,
    )
    if (selectedModelPreset !== nextPreset) {
      setSelectedModelPreset(nextPreset)
    }
  }, [
    activeSessionItem?.id,
    activeSessionItem?.model,
    model,
    selectedProviderModelPresets,
    selectedModelPreset,
    setModel,
    setSelectedModelPreset,
  ])

  const refreshProviderState = useCallback(async (): Promise<void> => {
    try {
      const [next, providers] = await Promise.all([
        desktopClient.getModelProviderState(),
        desktopClient.listModelProviders(),
      ])
      setProviderState(next)
      setModelProviders(providers)
      const activeModel = activeSessionModelRef.current
      const shouldSyncModel = !activeModel && next.model !== modelRef.current
      if (shouldSyncModel) {
        setModel(next.model)
      }
      syncExternalSettingsPatch({
        providerID: next.selectedProviderID,
        providerBaseURL: next.baseURL ?? '',
        ...(shouldSyncModel ? { model: next.model } : {}),
      })
      if (
        next.selectedProviderID &&
        next.apiKeyConfigured &&
        (!next.provider.requiresBaseURL || next.baseURL?.trim())
      ) {
        const catalogKey = [
          next.selectedProviderID,
          next.baseURL ?? '',
          next.apiKeyConfigured ? 'key' : 'no-key',
        ].join('\0')
        if (
          fetchedModelCatalogKeysRef.current.has(catalogKey) ||
          pendingModelCatalogKeysRef.current.has(catalogKey)
        ) {
          return
        }
        pendingModelCatalogKeysRef.current.add(catalogKey)
        void withModelCatalogLoading(() =>
          desktopClient.fetchProviderModels({
            providerID: next.selectedProviderID,
            baseURL: next.baseURL,
          }),
        )
          .then(result => {
            setProviderState(current => {
              if (current?.selectedProviderID !== next.selectedProviderID) {
                return current
              }
              return {
                ...current,
                models: result.models,
                error: result.error,
              }
            })
            fetchedModelCatalogKeysRef.current.add(catalogKey)
          })
          .catch(error =>
            setErrorMessage(
              error instanceof Error ? error.message : String(error),
            ),
          )
          .finally(() => {
            pendingModelCatalogKeysRef.current.delete(catalogKey)
          })
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [setModel, syncExternalSettingsPatch])

  useEffect(() => {
    void refreshProviderState()
    const listener = () => {
      void refreshProviderState()
    }
    window.addEventListener('desktop:model-provider-changed', listener)
    return () => {
      window.removeEventListener('desktop:model-provider-changed', listener)
    }
  }, [refreshProviderState])

  useEffect(() => {
    if (deepSeekThinkingControls && thinkingMode === 'adaptive') {
      setThinkingMode('default')
      return
    }
    if (showThinkingOptions || thinkingMode === 'default') return
    setThinkingMode('default')
  }, [
    deepSeekThinkingControls,
    showThinkingOptions,
    thinkingMode,
    setThinkingMode,
  ])

  const handleProviderModelChange = useCallback(
    (providerID: ModelProviderID, nextPresetId: string): void => {
      const providerOption = providerModelOptions.find(
        provider => provider.providerID === providerID,
      )
      if (!providerOption) return

      const providerSummary =
        modelProviders.find(provider => provider.providerID === providerID) ??
        (providerState?.provider.providerID === providerID
          ? providerState.provider
          : undefined)
      const baseURL =
        providerState?.selectedProviderID === providerID
          ? providerState.baseURL
          : providerSummary?.baseURL

      const preset = providerOption.modelPresets.find(
        item => item.id === nextPresetId,
      )
      if (!preset) return
      setProviderID(providerID)
      setProviderBaseURL(baseURL ?? '')
      setSelectedModelPreset(nextPresetId)
      setModel(preset.value)
      void desktopClient
        .saveModelProvider({
          providerID,
          modelID: preset.value,
          baseURL,
        })
        .then(next => {
          setProviderState(next)
          setProviderID(next.selectedProviderID)
          setProviderBaseURL(next.baseURL ?? '')
          setModel(next.model)
        })
        .catch(error =>
          setErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
        )
    },
    [
      model,
      modelProviders,
      providerModelOptions,
      providerState,
      setModel,
      setProviderBaseURL,
      setProviderID,
      setSelectedModelPreset,
    ],
  )

  const handlePermissionChange = useCallback(
    (value: DesktopPermissionMode): void => {
      setPermissionMode(value)
      if (!sessionId) return
      void setSessionPermissionMode(sessionId, value)
    },
    [sessionId, setPermissionMode, setSessionPermissionMode],
  )

  const handlePlanModeChange = useCallback(
    (active: boolean): void => {
      if (!sessionId) {
        setHomePlanModeActive(active)
        return
      }
      void setSessionPlanModeActive(sessionId, active)
    },
    [sessionId, setSessionPlanModeActive],
  )

  const handleLocalRouterModeChange = useCallback(
    (mode: LocalRouterMode): void => {
      if (!sessionId) return
      void setSessionLocalRouterMode(sessionId, mode)
    },
    [sessionId, setSessionLocalRouterMode],
  )

  const handleSelectSession = useCallback(
    (sessionItem: SessionListItem): void => {
      const nextWorkspace = activateSessionById(sessionItem.id)
      navigate(sessionPath(sessionItem.id))
      if (!nextWorkspace) {
        setWorkspaceState(null)
        setDiffState('未选择项目。')
        setSelectedFile(null)
        return
      }
      setWorkspaceState(nextWorkspace)
      void refreshWorkspace(nextWorkspace, { expectedSessionId: sessionItem.id })
    },
    [
      activateSessionById,
      navigate,
      refreshWorkspace,
      routedSessionId,
      sessionId,
      setDiffState,
      setSelectedFile,
      setWorkspaceState,
    ],
  )

  const handleUpdateSessionMetadata = useCallback(
    async (
      targetSessionId: string,
      patch: { pinnedAt?: string | null; archivedAt?: string | null },
    ): Promise<void> => {
      const archivingSession = Boolean(patch.archivedAt)
      const archivingActiveSession =
        targetSessionId === routedSessionId && archivingSession
      const result = await updateSessionMetadata(targetSessionId, patch)
      if (!result) return
      if (archivingSession) {
        setArchiveNoticeVisible(true)
      }
      if (!archivingActiveSession) return
      navigate(
        result.nextActiveSession
          ? sessionPath(result.nextActiveSession.id)
          : QUICK_CHAT_PATH,
        { replace: true },
      )
      if (result.nextActiveSession && result.nextWorkspace) {
        setWorkspaceState(result.nextWorkspace)
        void refreshWorkspace(result.nextWorkspace, {
          expectedSessionId: result.nextActiveSession.id,
        })
      } else {
        setWorkspaceState(null)
        setDiffState('未选择项目。')
        setSelectedFile(null)
      }
    },
    [
      navigate,
      refreshWorkspace,
      routedSessionId,
      setDiffState,
      setSelectedFile,
      setWorkspaceState,
      updateSessionMetadata,
      setArchiveNoticeVisible,
    ],
  )

  const isConversationLoading =
    isConversationRoute && (!sessionsHydrated || sessionId !== routedSessionId)
  const runtimeMissing =
    runtimeStatus?.runtimeKind === 'subprocess' &&
    runtimeStatus.agentExecutableExists === false
  const runtimeWarningMessage =
    !currentWorkspace && runtimeMissing && !runtimeWarningDismissed
      ? RUNTIME_WARNING_MESSAGE
      : null
  const visibleErrorMessage = errorMessage ?? runtimeWarningMessage
  const branchName = getDesktopComposerBranchName(currentWorkspace)

  const search = useDesktopSearch({
    query: searchQuery,
    recentWorkspaces,
    sessions,
  })
  const quickChatSessionTitle =
    activeSessionItem?.sessionName ??
    activeSessionItem?.customTitle ??
    activeSessionItem?.aiTitle ??
    null
  const quickChatSessionTitleSource =
    activeSessionItem?.sessionName
      ? 'sessionName'
      : activeSessionItem?.customTitle
        ? 'customTitle'
        : activeSessionItem?.aiTitle
          ? 'aiTitle'
          : null

  const handleRemoveWorkspace = useCallback(
    (target: DesktopWorkspace): void => {
      // Record removal so the project doesn't reappear from sessions
      setRemovedWorkspaces(current => {
        const next = current.filter(r => r.path !== target.path)
        next.push({
          path: target.path,
          name: target.name,
          removedAt: new Date().toISOString(),
        })
        settings.syncExternalSettingsPatch({ removedWorkspaces: next })
        return next
      })
      setRecentWorkspaces(current =>
        current.filter(workspaceItem => workspaceItem.path !== target.path),
      )
      setUnavailableWorkspacePaths(current => {
        if (!current.has(target.path)) return current
        const next = new Set(current)
        next.delete(target.path)
        return next
      })
      if (currentWorkspace?.path !== target.path) return
      setWorkspaceState(null)
      setDiffState(NO_WORKSPACE_DIFF)
      setSelectedFile(null)
      if (!isConversationRoute) {
        navigate(QUICK_CHAT_PATH)
      }
    },
    [
      currentWorkspace?.path,
      isConversationRoute,
      navigate,
      setDiffState,
      setRecentWorkspaces,
      setSelectedFile,
      setWorkspaceState,
      settings,
	    ],
	  )

	  const handlePinWorkspace = useCallback(
	    (target: DesktopWorkspace): void => {
	      setRecentWorkspaces(current =>
	        upsertRecentWorkspace(current, { ...target, pinnedAt: new Date().toISOString() }),
	      )
	    },
	    [setRecentWorkspaces],
	  )

	  const handleUnpinWorkspace = useCallback(
	    (target: DesktopWorkspace): void => {
	      setRecentWorkspaces(current =>
	        upsertRecentWorkspace(current, { ...target, pinnedAt: null }),
	      )
	    },
    [setRecentWorkspaces],
  )

  const handleToggleSidebarSection = useCallback(
    (section: SidebarSectionId): void => {
      setCollapsedSidebarSections(current => {
        const next = current.includes(section)
          ? current.filter(s => s !== section)
          : [...current, section]
        syncExternalSettingsPatch({ collapsedSidebarSections: next })
        return next
      })
    },
    [setCollapsedSidebarSections, syncExternalSettingsPatch],
  )

  useEffect(() => {
    if (!runtimeMissing) {
	      setRuntimeWarningDismissed(false)
	    }
	  }, [runtimeMissing])

  useEffect(() => {
    let mounted = true
    void desktopClient
      .isWindowMaximized()
      .then(next => {
        if (mounted) {
          setIsWindowMaximized(next)
        }
      })
      .catch(() => {
        if (mounted) {
          setIsWindowMaximized(false)
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  const menuBar = (
    <MenuBar
      sidebarCollapsed={sidebarCollapsed}
      isMaximized={isWindowMaximized}
      onToggleSidebar={toggleSidebarCollapsed}
      isDebugMode={menubarDebugMode}
      onDebugModeChange={setMenubarDebugMode}
      onClose={() => {
        void desktopClient.closeWindow()
      }}
      onMinimize={() => {
        void desktopClient.minimizeWindow()
      }}
      onToggleMaximize={() => {
        void desktopClient
          .toggleWindowMaximized()
          .then(next => setIsWindowMaximized(next))
      }}
      onFileMenuAction={handleFileMenuAction}
      onEditMenuAction={handleEditMenuAction}
      onViewMenuAction={handleViewMenuAction}
      onWindowMenuAction={handleWindowMenuAction}
      onHelpMenuAction={handleHelpMenuAction}
    />
  )

  function handleSettingsTabChange(tab: string): void {
    navigate(
      tab === 'general'
        ? '/settings'
        : `/settings?tab=${encodeURIComponent(tab)}`,
    )
  }

  function handleSettingsBack(): void {
    navigate(settingsReturnPathRef.current || QUICK_CHAT_PATH)
  }

  const appSidebarContent = (
    <DesktopSidebar
      activeSessionId={sessionId}
      recentWorkspaces={recentWorkspaces}
      removedWorkspaces={removedWorkspaces}
      sessions={sessions}
      unavailableWorkspacePaths={unavailableWorkspacePaths}
      workspace={currentWorkspace}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onCreateSession={workspaceItem => void handleCreateSession(workspaceItem)}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onRemoveWorkspace={handleRemoveWorkspace}
      onPinWorkspace={handlePinWorkspace}
      onUnpinWorkspace={handleUnpinWorkspace}
      collapsedSidebarSections={collapsedSidebarSections}
      onToggleSidebarSection={handleToggleSidebarSection}
      onSelectSession={handleSelectSession}
      onUpdateSessionMetadata={(targetSessionId, patch) =>
        void handleUpdateSessionMetadata(targetSessionId, patch)
      }
    />
  )

  const settingsSidebarContent = (
    <SettingsSidebarContent
      activeTab={settingsActiveTab}
      onBack={handleSettingsBack}
      onTabChange={handleSettingsTabChange}
    />
  )

  const sidebar = (
    <SidebarFrame
      collapsed={sidebarCollapsed}
      maxWidth={SIDEBAR_MAX_WIDTH}
      minWidth={SIDEBAR_MIN_WIDTH}
      width={sidebarWidth}
      onCollapse={collapseSidebar}
      onSetWidth={setSidebarWidth}
    >
      {isSettingsRoute ? settingsSidebarContent : appSidebarContent}
    </SidebarFrame>
  )

  const composer = isQuickChatPage || isConversationRoute ? (
    <DesktopComposer
      input={input}
      messages={messages}
      isQuickChatPage={isQuickChatPage}
      routedSessionId={routedSessionId}
      sessionStatus={sessionStatus}
      permissionMode={permissionMode}
      planModeActive={planModeActive}
      localRouterMode={effectiveLocalRouterMode}
      enableParetoCodeRouter={enableParetoCodeRouter ?? false}
      enableFusionRouter={enableFusionRouter ?? false}
      enableAutoReviewPermissionMode={enableAutoReviewPermissionMode ?? false}
      enableFullAccessPermissionMode={enableFullAccessPermissionMode ?? false}
      planExecutionModel={planExecutionModel}
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID}
      selectedModelPreset={resolvedSelectedModelPreset}
      modelConfigured={modelConfigured}
      modelCatalogLoading={modelCatalogLoading}
      modelConfigurationMessage={modelConfigurationMessage}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      debugMode={menubarDebugMode}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={selectedProviderModelPresets}
      providerOptions={providerModelOptions}
      recentWorkspaces={recentWorkspaces}
      workspace={currentWorkspace}
      attachments={composerAttachments}
      onAttachmentsChange={setComposerAttachments}
      onChooseWorkspace={handleChooseWorkspace}
      onInputChange={setInput}
      onInterrupt={interrupt}
      onProviderModelChange={handleProviderModelChange}
      onOpenWorkspace={handleOpenRecentWorkspace}
      onCloneGithub={() => setGithubRepositoryModalOpen(true)}
      onClearWorkspace={handleClearWorkspace}
      onOpenBrowser={handleOpenBrowser}
      onBranchSelect={handleBranchSelect}
      onCreateBranch={() => setGitWorkflowMode('branch')}
      onPermissionChange={handlePermissionChange}
      onPlanModeChange={handlePlanModeChange}
      onLocalRouterModeChange={handleLocalRouterModeChange}
      onThinkingChange={setThinkingMode}
      createSessionForWorkspace={createSessionForWorkspace}
      submitToSession={submitToSession}
    />
  ) : null
  const sideChatComposer =
    isQuickChatPage || isConversationRoute ? (
      <DesktopComposer
        input={sideChatInput}
        messages={messages}
        isQuickChatPage={isQuickChatPage}
        routedSessionId={activeSessionItem?.id ?? null}
        sessionStatus={sessionStatus}
        permissionMode={permissionMode}
        planModeActive={planModeActive}
        localRouterMode={effectiveLocalRouterMode}
        enableParetoCodeRouter={enableParetoCodeRouter ?? false}
        enableFusionRouter={enableFusionRouter ?? false}
        enableAutoReviewPermissionMode={enableAutoReviewPermissionMode ?? false}
        enableFullAccessPermissionMode={enableFullAccessPermissionMode ?? false}
        planExecutionModel={planExecutionModel}
        thinkingMode={thinkingMode}
        selectedProviderID={selectedProviderID}
        selectedModelPreset={resolvedSelectedModelPreset}
        modelConfigured={modelConfigured}
        modelCatalogLoading={modelCatalogLoading}
        modelConfigurationMessage={modelConfigurationMessage}
        showThinkingOptions={showThinkingOptions}
        deepSeekThinkingControls={deepSeekThinkingControls}
        debugMode={menubarDebugMode}
        showContextUsage={showContextUsage}
        contextUsage={contextUsage}
        modelPresets={selectedProviderModelPresets}
        providerOptions={providerModelOptions}
        recentWorkspaces={recentWorkspaces}
        workspace={currentWorkspace}
        attachments={sideChatAttachments}
        onAttachmentsChange={setSideChatAttachments}
        onChooseWorkspace={handleChooseWorkspace}
        onInputChange={setSideChatInput}
        onInterrupt={interrupt}
        onProviderModelChange={handleProviderModelChange}
        onOpenWorkspace={handleOpenRecentWorkspace}
        onCloneGithub={() => setGithubRepositoryModalOpen(true)}
        onClearWorkspace={handleClearWorkspace}
        onOpenBrowser={handleOpenBrowser}
        onBranchSelect={handleBranchSelect}
        onCreateBranch={() => setGitWorkflowMode('branch')}
        onPermissionChange={handlePermissionChange}
        onPlanModeChange={handlePlanModeChange}
        onLocalRouterModeChange={handleLocalRouterModeChange}
        onThinkingChange={setThinkingMode}
        createSessionForWorkspace={createSessionForWorkspace}
        submitToSession={sideChatSubmitToSession}
      />
    ) : null
  const toggleBottomPanelVisible = useCallback((): void => {
    setBottomPanelVisible(current => !current)
  }, [])

  const fixedControlsRef = useRef<HTMLDivElement>(null)
  const [fixedControlsWidth, setFixedControlsWidth] = useState(0)
  useEffect(() => {
    const el = fixedControlsRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width
        if (Number.isFinite(width)) {
          setFixedControlsWidth(Math.ceil(width))
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rightDockNode: React.ReactNode | null = rightDockState.open ? (
    <RightDock
      state={rightDockState}
      browserState={browserState}
      debugMode={menubarDebugMode}
      defaultBranch={derivedDefaultBranch}
      files={workspaceFiles}
      gitStatus={gitStatus}
      isRefreshingReview={false}
      diffMarkerStyle={diffMarkerStyle}
      maxWidth={RIGHT_DOCK_MAX_WIDTH}
      minWidth={RIGHT_DOCK_MIN_WIDTH}
      reviewView={reviewView}
      plan={rightDockPlan}
      selectedFile={selectedFile}
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      width={rightDockWidth}
      workspace={currentWorkspace}
      quickChatOnly={isQuickChatPage}
      onAppendBrowserAnnotation={handleBrowserAnnotation}
      onAppendComposerText={handleAppendComposerText}
      onAddComposerFiles={handleAddComposerFiles}
      onBrowserStateChange={setBrowserState}
      onClose={closeRightDock}
      onCloseTool={closeRightDockTool}
      onCreateBranch={() => setGitWorkflowMode('branch')}
      onOpenTool={handleRightDockToolSelect}
      onOpenWorkspacePath={handleOpenWorkspacePath}
      onPreviewFile={file => void previewFile(file)}
      onRefreshReview={handleRefreshDiff}
      onResetWidth={handleResetRightDockWidth}
      onSelectTool={selectRightDockTool}
      onSetWidth={handleSetRightDockWidth}
      onToggleReviewView={() =>
        setReviewView(reviewView === 'inline' ? 'split' : 'inline')
      }
      sideChatComposer={sideChatComposer}
      sideChatFocusVersion={sideChatFocusVersion}
    />
  ) : null

  return (
    <div className="desktop-frame">
      <GlobalErrorModal
        message={visibleErrorMessage}
        onDismiss={() => {
          if (errorMessage) {
            setErrorMessage(null)
            return
          }
          setRuntimeWarningDismissed(true)
        }}
      />
      <GitWorkflowModal
        allowForcePush={allowForcePush}
        commitMessagePrompt={commitMessagePrompt}
        gitBranchPrefix={gitBranchPrefix}
        gitStatus={gitStatus}
        mode={gitWorkflowMode}
        pullRequestPrompt={pullRequestPrompt}
        workspace={currentWorkspace}
        onClose={() => setGitWorkflowMode(null)}
        onError={message => setErrorMessage(message)}
        onRefreshWorkspace={async () => {
          if (currentWorkspace) {
            await refreshWorkspace(currentWorkspace, { clearSelectedFile: false })
          }
        }}
        onWorkspaceChanged={handleWorkspaceChanged}
      />
      <GithubRepositoryModal
        open={githubRepositoryModalOpen}
        onClose={() => setGithubRepositoryModalOpen(false)}
        onError={message => setErrorMessage(message)}
        onWorkspaceCloned={handleGithubWorkspaceCloned}
      />
      {archiveNoticeVisible ? (
        <ArchiveConversationNotice
          onClose={() => setArchiveNoticeVisible(false)}
          onOpenSettings={() => {
            setArchiveNoticeVisible(false)
            navigate('/settings?tab=archived')
          }}
        />
      ) : null}

      <DesktopAppShell
        menuBar={menuBar}
        sidebar={sidebar}
        menubarDebugMode={menubarDebugMode}
      >
        <QuickChatContext.Provider
            value={{
            isConversationRoute,
            isConversationLoading,
            sidebarCollapsed,
            activeSessionId: activeSessionItem?.id ?? null,
            activeSessionPinnedAt: activeSessionItem?.pinnedAt ?? null,
            sessionTitle: quickChatSessionTitle,
            workspaceName: currentWorkspace?.name ?? null,
            workspacePath: currentWorkspace?.path ?? null,
            branchName,
            diff: workspace.diff,
            gitStatus,
            recentWorkspaces,
            onArchiveSession: () => {
              if (!activeSessionItem) return
              void handleUpdateSessionMetadata(activeSessionItem.id, {
                archivedAt: new Date().toISOString(),
              })
            },
            onCreateBranch: () => setGitWorkflowMode('branch'),
            onOpenAutomation: () => navigate('/automation'),
            onOpenWorkspacePath: handleOpenWorkspacePath,
            onOpenRightDock: openRightDockTool,
            onOpenPlanInRightDock: handleOpenPlanDock,
            onSubmitEditedUserMessage: handleSubmitEditedUserMessage,
            onAppendComposerText: handleAppendComposerText,
            onAppendSideChatText: handleAppendSideChatText,
            onAddComposerFiles: handleAddComposerFiles,
            onRefreshDiff: handleRefreshDiff,
            onToggleSidebar: toggleSidebarCollapsed,
            onToggleSessionPinned: () => {
              if (!activeSessionItem) return
              void handleUpdateSessionMetadata(activeSessionItem.id, {
                pinnedAt: activeSessionItem.pinnedAt
                  ? null
                  : new Date().toISOString(),
              })
            },
            onCommitOrPush: () => setGitWorkflowMode('commitPush'),
            onCreatePullRequest: () => setGitWorkflowMode('pullRequest'),
            onChooseWorkspace: handleChooseWorkspace,
            onCloneGithub: () => setGithubRepositoryModalOpen(true),
            onOpenWorkspace: handleOpenRecentWorkspace,
            onClearWorkspace: handleClearWorkspace,
            onDecidePermission: (
              request,
              behavior,
              alwaysAllow,
              updatedInput,
              decisionExtras,
            ) => {
              void decidePermission(
                request,
                behavior,
                alwaysAllow,
                updatedInput,
                decisionExtras,
              )
            },
            onAcceptExitPlanMode: (request, options) => {
              handlePlanModeChange(false)
              void decidePermission(
                request,
                'allow',
                false,
                options?.note ? { feedback: options.note } : undefined,
                {
                  planExecutionModel: options?.planExecutionModel,
                  planExecutionProviderID: options?.planExecutionProviderID,
                  planExecutionProviderBaseURL: options?.planExecutionProviderBaseURL,
                  savePlanExecutionModel: options?.savePlanExecutionModel,
                },
              )
            },
            permissionMode,
            planModeActive,
            providerModelOptions,
            events: isQuickChatPage || isConversationLoading ? [] : events,
            workflowEvents:
              isQuickChatPage || isConversationLoading ? [] : workflowEvents,
            messages: isQuickChatPage || isConversationLoading ? [] : messages,
            pendingPermissions:
              isQuickChatPage || isConversationLoading ? [] : pendingPermissions,
            sessionStatus,
            composer: isConversationLoading ? null : composer,
            bottomPanelVisible,
            onToggleBottomPanel: toggleBottomPanelVisible,
            rightDockOpen: rightDockState.open,
            rightDockTool: rightDockState.activeTool,
            rightDockPlanContent: rightDockPlan?.content ?? null,
            rightDockNode,
            rightDockWidth,
            debugMode: menubarDebugMode,
            }}
          >
            <SearchContext.Provider
              value={{
              query: searchQuery,
              workspaces: search.filteredWorkspaces,
              sessions: search.filteredSessions,
              onQueryChange: setSearchQuery,
              onOpenWorkspace: handleOpenRecentWorkspace,
              onSelectSession: handleSelectSession,
              }}
            >
              <div
                className="desktop-workspace"
                style={
                  {
                    '--sidebar-w': sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
                    ...(fixedControlsWidth > 0 ? { '--desktop-workspace-fixed-controls-w': `${fixedControlsWidth}px` } : {}),
                  } as React.CSSProperties
                }
              >
                <DesktopWorkspaceFixedControls
                  ref={fixedControlsRef}
                  rightDockState={rightDockState}
                  bottomPanelVisible={bottomPanelVisible}
                  showBottomPanel={isQuickChatPage || isConversationRoute}
                  onToggleBottomPanel={toggleBottomPanelVisible}
                  onOpenRightDockTool={handleRightDockToolSelect}
                  onCloseRightDock={closeRightDock}
                />
                <div
                  className={
                    rightDockState.open
                      ? 'desktop-main-browser-layout'
                      : 'desktop-main-browser-layout browser-closed'
                  }
                >
                  <div className="desktop-main-route">
                    <Outlet />
                  </div>
                </div>
              </div>
            </SearchContext.Provider>
          </QuickChatContext.Provider>
      </DesktopAppShell>
    </div>
  )
}

function ArchiveConversationNotice({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void
  onOpenSettings: () => void
}): React.ReactNode {
  return (
    <div aria-live="polite" className="archive-session-toast" role="status">
      <span>查看已归档的聊天：</span>
      <button
        className="archive-session-toast-link"
        onClick={onOpenSettings}
        type="button"
      >
        设置
      </button>
      <button
        aria-label="关闭归档提示"
        className="archive-session-toast-close"
        onClick={onClose}
        type="button"
      >
        x
      </button>
    </div>
  )
}

function getRoutedSessionId(pathname: string): string | null {
  const match = /^\/sessions\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]!) : null
}

function sessionPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`
}

function getInitialRightDockWidth(): number {
  const stored = Number(window.localStorage.getItem(RIGHT_DOCK_WIDTH_STORAGE_KEY))
  return clampRightDockWidth(stored || RIGHT_DOCK_DEFAULT_WIDTH)
}

function clampRightDockWidth(width: number): number {
  const viewportMax = Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    window.innerWidth - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
  const maxWidth = Math.min(RIGHT_DOCK_MAX_WIDTH, viewportMax)
  const safeWidth = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return Math.min(maxWidth, Math.max(RIGHT_DOCK_MIN_WIDTH, Math.round(safeWidth)))
}

function isDeepSeekThinkingModel({
  providerID,
  model,
  metadata,
}: {
  providerID?: ModelProviderID
  model: string
  metadata?: DesktopModelMetadata
}): boolean {
  if (providerID === 'deepseek') {
    return true
  }
  if (providerID !== 'openrouter') {
    return false
  }
  return model.toLowerCase().includes('deepseek') && metadata?.reasoning === true
}
