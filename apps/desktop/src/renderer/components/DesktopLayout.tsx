import { desktopClient } from '../services/desktopClient.js'
import type React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  DesktopComposer,
  getDesktopComposerBranchName,
} from './DesktopComposer.js'
import { DesktopAppShell } from './DesktopAppShell.js'
import { DesktopSidebar } from './DesktopSidebar.js'
import { GlobalErrorModal } from './GlobalErrorModal.js'
import {
  GitWorkflowModal,
  type GitWorkflowMode,
} from './GitWorkflowModal.js'
import { SettingsSidebarContent } from './SettingsSidebarContent.js'
import { SidebarFrame } from './SidebarFrame.js'
import { MenuBar } from './MenuBar.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from './MenuBar.js'
import { QuickChatContext } from '../context/QuickChatContext.js'
import { SearchContext } from '../context/SearchContext.js'
import type { SessionListItem } from '../uiTypes.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDesktopLayout,
} from '../features/layout/useDesktopLayout.js'
import {
  NO_WORKSPACE_DIFF,
  useWorkspaceState,
} from '../features/workspace/useWorkspaceState.js'
import { shouldRestoreLastWorkspace } from '../features/workspace/lastWorkspaceRestore.js'
import { useSessionState } from '../features/session/useSessionState.js'
import { useDesktopCommands } from '../features/session/useDesktopCommands.js'
import { useDesktopSearch } from '../features/search/useDesktopSearch.js'
import {
  CUSTOM_MODEL_PRESET_ID,
  buildModelPresets,
  resolveModelPresetId,
} from '../modelPresets.js'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopModelProviderState,
  DesktopWorkspace,
  ModelProviderID,
} from '../../shared/types.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const RUNTIME_WARNING_MESSAGE =
  '桌面端 agent 运行时缺失，发送消息前请先执行 `bun run desktop:agent:build`。'
const QUICK_CHAT_PATH = '/quick-chat'

export function DesktopLayout(): React.ReactNode {
  const settings = useDesktopSettings()
  const {
    permissionMode,
    model,
    smallFastModel,
    fastModel,
    defaultModel,
    deepModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    selectedModelPreset,
    providerID,
    showContextUsage,
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

  const workspace = useWorkspaceState({
    onError: (message: string) => setErrorMessage(message || null),
    onRecentWorkspacesChange: next => {
      setRecentWorkspaces(next)
    },
  })
  const {
    workspace: currentWorkspace,
    runtimeStatus,
    setActiveSessionId,
    refreshWorkspace,
    chooseWorkspace,
    openRecentWorkspace,
    setSelectedFile,
    setWorkspace: setWorkspaceState,
    setDiff: setDiffState,
    gitStatus,
  } = workspace

  const session = useSessionState({
    permissionMode,
    model,
    smallFastModel,
    fastModel,
    defaultModel,
    deepModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
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
    activeSessionItem,
  } = session

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
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      await refreshWorkspace(selected)
      return selected
    },
    [chooseWorkspace, navigate, refreshWorkspace, setWorkspaceState],
  )

  const handleOpenRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      const selected = await openRecentWorkspace(target)
      if (!selected) return null
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      await refreshWorkspace(selected)
      return selected
    },
    [navigate, openRecentWorkspace, refreshWorkspace, setWorkspaceState],
  )

  useEffect(() => {
    if (
      !shouldRestoreLastWorkspace({
        settingsLoaded,
        isQuickChatPage,
        hasCurrentWorkspace: Boolean(currentWorkspace),
        hasAttemptedRestore: lastWorkspaceRestoreAttemptedRef.current,
        recentWorkspaceCount: recentWorkspaces.length,
      })
    ) {
      return
    }
    const lastWorkspace = recentWorkspaces[0]
    if (!lastWorkspace) return
    lastWorkspaceRestoreAttemptedRef.current = true
    void handleOpenRecentWorkspace(lastWorkspace)
  }, [
    currentWorkspace,
    handleOpenRecentWorkspace,
    isQuickChatPage,
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
      }
    },
    [toggleSidebarCollapsed],
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
        case 'debug':
          void desktopClient.openDevTools()
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
  const providerModelOptions = useMemo(
    () => {
      const providers =
        modelProviders.length > 0
          ? modelProviders
          : providerState
            ? [providerState.provider]
            : []
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
        }
      })
    },
    [modelProviders, providerState],
  )
  const resolvedSelectedModelPreset = resolveModelPresetId(
    model,
    selectedModelPreset,
    modelPresets,
  )
  const selectedProviderID = providerState?.selectedProviderID ?? providerID
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
    if (!activeModel) return
    if (model !== activeModel) {
      setModel(activeModel)
    }
    const nextPreset = resolveModelPresetId(
      activeModel,
      undefined,
      modelPresets,
    )
    if (selectedModelPreset !== nextPreset) {
      setSelectedModelPreset(nextPreset)
    }
  }, [
    activeSessionItem?.id,
    activeSessionItem?.model,
    model,
    modelPresets,
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
      const activeModel = activeSessionItem?.model?.trim()
      if (!activeModel && next.model !== model) {
        setModel(next.model)
      }
      setProviderID(next.selectedProviderID)
      setProviderBaseURL(next.baseURL ?? '')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [
    activeSessionItem?.model,
    model,
    setModel,
    setProviderBaseURL,
    setProviderID,
  ])

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

      if (nextPresetId === CUSTOM_MODEL_PRESET_ID) {
        const customValue = window.prompt('输入自定义模型名称', model)
        if (!customValue) return
        const trimmed = customValue.trim()
        if (!trimmed) return
        setProviderID(providerID)
        setProviderBaseURL(baseURL ?? '')
        setModel(trimmed)
        setSelectedModelPreset(CUSTOM_MODEL_PRESET_ID)
        void desktopClient
          .saveModelProvider({
            providerID,
            modelID: trimmed,
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
        return
      }

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
      setRecentWorkspaces(current =>
        current.filter(workspaceItem => workspaceItem.path !== target.path),
      )
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
    ],
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
      sessions={sessions}
      workspace={currentWorkspace}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onCreateSession={workspaceItem => void handleCreateSession(workspaceItem)}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onRemoveWorkspace={handleRemoveWorkspace}
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
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID}
      selectedModelPreset={resolvedSelectedModelPreset}
      modelConfigured={modelConfigured}
      modelConfigurationMessage={modelConfigurationMessage}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={modelPresets}
      providerOptions={providerModelOptions}
      recentWorkspaces={recentWorkspaces}
      workspace={currentWorkspace}
      onChooseWorkspace={handleChooseWorkspace}
      onInputChange={setInput}
      onInterrupt={interrupt}
      onProviderModelChange={handleProviderModelChange}
      onOpenWorkspace={handleOpenRecentWorkspace}
      onBranchSelect={handleBranchSelect}
      onCreateBranch={() => setGitWorkflowMode('branch')}
      onPermissionChange={setPermissionMode}
      onThinkingChange={setThinkingMode}
      createSessionForWorkspace={createSessionForWorkspace}
      submitToSession={submitToSession}
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
            onArchiveSession: () => {
              if (!activeSessionItem) return
              void handleUpdateSessionMetadata(activeSessionItem.id, {
                archivedAt: new Date().toISOString(),
              })
            },
            onCreateBranch: () => setGitWorkflowMode('branch'),
            onOpenAutomation: () => navigate('/automation'),
            onOpenWorkspacePath: handleOpenWorkspacePath,
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
            onDecidePermission: (request, behavior, alwaysAllow, updatedInput) => {
              void decidePermission(request, behavior, alwaysAllow, updatedInput)
            },
            events: isQuickChatPage || isConversationLoading ? [] : events,
            workflowEvents:
              isQuickChatPage || isConversationLoading ? [] : workflowEvents,
            messages: isQuickChatPage || isConversationLoading ? [] : messages,
            pendingPermissions:
              isQuickChatPage || isConversationLoading ? [] : pendingPermissions,
            sessionStatus,
            composer: isConversationLoading ? null : composer,
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
            <Outlet />
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
