import { desktopClient } from '../services/desktopClient.js'
import type React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ComposerCard } from './ComposerCard.js'
import { DesktopShell } from './DesktopShell.js'
import { DesktopSidebar } from './DesktopSidebar.js'
import { GlobalErrorModal } from './GlobalErrorModal.js'
import { PermissionRequestModal } from './PermissionRequestModal.js'
import { WindowChrome } from './WindowChrome.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from './WindowChrome.js'
import { QuickChatContext } from '../context/QuickChatContext.js'
import { SearchContext } from '../context/SearchContext.js'
import type { SessionListItem } from '../uiTypes.js'
import { PERMISSION_MODE_OPTIONS, THINKING_MODE_OPTIONS } from '../features/settings/settingsStorage.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { useDesktopLayout } from '../features/layout/useDesktopLayout.js'
import { useWorkspaceState } from '../features/workspace/useWorkspaceState.js'
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
  DesktopPermissionRequest,
  DesktopWorkspace,
  ModelProviderID,
} from '../../shared/types.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const RUNTIME_WARNING_MESSAGE =
  '桌面端 agent 运行时缺失，发送消息前请先执行 `bun run desktop:agent:build`。'

export function DesktopLayout(): React.ReactNode {
  const settings = useDesktopSettings()
  const {
    permissionMode,
    model,
    fallbackModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    recentWorkspaces,
    selectedModelPreset,
    providerID,
    showContextUsage,
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
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [modelProviders, setModelProviders] = useState<
    DesktopModelProviderSummary[]
  >([])

  const layout = useDesktopLayout()
  const {
    sidebarCollapsed,
    sidebarWidth,
    viewportWidth,
    setSidebarWidth,
    toggleSidebarCollapsed,
  } = layout

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
  } = workspace

  const session = useSessionState({
    permissionMode,
    model,
    fallbackModel,
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
  const isHomePage = location.pathname === '/'
  const isConversationRoute = routedSessionId !== null

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
    if (!routedSession || routedSession.archivedAt) {
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      setErrorMessage(`找不到对话：${routedSessionId}`)
      navigate('/', { replace: true })
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
      navigate('/')
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
      navigate('/')
      setWorkspaceState(selected)
      await refreshWorkspace(selected)
      return selected
    },
    [navigate, openRecentWorkspace, refreshWorkspace, setWorkspaceState],
  )

  const handleCreateSession = useCallback(async (
    target?: DesktopWorkspace | null,
  ): Promise<void> => {
    if (target === null) {
      navigate('/')
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
      navigate('/')
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

  const handleNewConversation = useCallback(async (): Promise<void> => {
    activateSessionById(null)
    setInput('')
    navigate('/')
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
          navigate('/')
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
        providerState?.provider.displayName
          ? `默认模型 (${providerState.provider.displayName})`
          : '默认模型',
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
          modelPresets: buildModelPresets(
            models,
            `默认模型 (${provider.displayName})`,
          ),
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
      const archivingActiveSession =
        targetSessionId === routedSessionId && Boolean(patch.archivedAt)
      const result = await updateSessionMetadata(targetSessionId, patch)
      if (!result || !archivingActiveSession) return
      navigate(
        result.nextActiveSession
          ? sessionPath(result.nextActiveSession.id)
          : '/',
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
  const activePermissionRequest: DesktopPermissionRequest | null =
    isConversationRoute && !isConversationLoading
      ? pendingPermissions[0] ?? null
      : null
  const composerCanSubmit =
    Boolean(input.trim()) &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'waiting' &&
    (isHomePage || Boolean(routedSessionId))
  const branchName =
    !currentWorkspace
      ? '无项目'
      : currentWorkspace.isGitRepo === false
      ? '未检测到 Git 分支'
      : currentWorkspace.branchName ?? '未检测到 Git 分支'

  const search = useDesktopSearch({
    query: searchQuery,
    recentWorkspaces,
    sessions,
  })
  const hasConversationMessages = messages.some(
    message => message.role !== 'system',
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

  const windowChrome = (
    <WindowChrome
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

  const sidebar = (
    <DesktopSidebar
      activeSessionId={sessionId}
      collapsed={sidebarCollapsed}
      maxWidth={Math.round(viewportWidth * 0.2)}
      minWidth={Math.round(viewportWidth * 0.12)}
      recentWorkspaces={recentWorkspaces}
      sessions={sessions}
      width={sidebarWidth}
      workspace={currentWorkspace}
      onCreateSession={workspaceItem => void handleCreateSession(workspaceItem)}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onSelectSession={handleSelectSession}
      onSetWidth={setSidebarWidth}
      onUpdateSessionMetadata={(targetSessionId, patch) =>
        void handleUpdateSessionMetadata(targetSessionId, patch)
      }
    />
  )

  const composer = isHomePage || isConversationRoute ? (
    <ComposerCard
      input={input}
      canSubmit={composerCanSubmit}
      sessionStatus={sessionStatus}
      permissionMode={permissionMode}
      thinkingMode={thinkingMode}
      selectedProviderID={selectedProviderID ?? 'anthropic'}
      selectedModelPreset={resolvedSelectedModelPreset}
      showThinkingOptions={showThinkingOptions}
      deepSeekThinkingControls={deepSeekThinkingControls}
      showContextUsage={showContextUsage}
      contextUsage={contextUsage}
      modelPresets={modelPresets}
      providerOptions={providerModelOptions}
      permissionOptions={PERMISSION_MODE_OPTIONS}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      branches={currentWorkspace?.branches ?? []}
      recentWorkspaces={recentWorkspaces}
      workspace={currentWorkspace}
      placeholder={hasConversationMessages ? '要求后续变更' : '随心输入'}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onInputChange={setInput}
      onInterrupt={() => void interrupt()}
      onProviderModelChange={handleProviderModelChange}
      onOpenFiles={() => {}}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onBranchSelect={handleBranchSelect}
      onPermissionChange={setPermissionMode}
      onSubmit={() => {
        void (async () => {
          const submittedInput = input
          if (isHomePage) {
            setInput('')
            const nextSessionId = currentWorkspace
              ? await createSessionForWorkspace(currentWorkspace)
              : await createSessionForWorkspace(null)
            if (!nextSessionId) return
            navigate(sessionPath(nextSessionId))
            await submitToSession(nextSessionId, submittedInput)
            return
          }
          if (routedSessionId) {
            await submitToSession(routedSessionId, submittedInput)
          }
        })()
      }}
      onThinkingChange={setThinkingMode}
    />
  ) : null

  return (
    <div className="desktop-frame">
      <PermissionRequestModal
        request={activePermissionRequest}
        onDecide={(request, behavior, alwaysAllow) => {
          void decidePermission(request, behavior, alwaysAllow)
        }}
      />

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

      <DesktopShell
        windowChrome={windowChrome}
        sidebar={sidebar}
        content={
        <QuickChatContext.Provider
          value={{
            isConversationRoute,
            isConversationLoading,
            sessionTitle:
              activeSessionItem?.sessionName ??
              activeSessionItem?.aiTitle ??
              null,
            workspaceName: currentWorkspace?.name ?? null,
            events: isHomePage || isConversationLoading ? [] : events,
            messages: isHomePage || isConversationLoading ? [] : messages,
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
        }
        composer={null}
      />
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
  if (providerID !== 'openrouter' && providerID !== 'ai-gateway') {
    return false
  }
  return model.toLowerCase().includes('deepseek') && metadata?.reasoning === true
}
