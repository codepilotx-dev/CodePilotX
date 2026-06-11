import type React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { ComposerCard } from './ComposerCard.js'
import { DesktopShell } from './DesktopShell.js'
import { DesktopSidebar } from './DesktopSidebar.js'
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
  DesktopModelProviderState,
  DesktopPermissionRequest,
  DesktopWorkspace,
} from '../../shared/types.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

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
    setPermissionMode,
    setModel,
    setThinkingMode,
    setRecentWorkspaces,
    setDrawerTab,
    setSelectedModelPreset,
  } = settings
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)

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
    messages,
    pendingPermissions,
    input,
    setInput,
    activateSessionById,
    createSessionForWorkspace,
    submitToSession,
    interrupt,
    decidePermission,
    updateSessionMetadata,
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

  const handleCreateSession = useCallback(async (): Promise<void> => {
    const nextSessionId = currentWorkspace
      ? await createSessionForWorkspace(currentWorkspace)
      : await createSessionForWorkspace(null)
    if (nextSessionId) {
      navigate(sessionPath(nextSessionId))
    }
  }, [createSessionForWorkspace, currentWorkspace, navigate])

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
          void window.desktopApi.closeWindow()
          break
        case 'newWindow':
          void window.desktopApi.newWindow()
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
          void window.desktopApi.openSettings()
          break
        case 'logOut':
          void window.desktopApi.logOut()
          break
        case 'exit':
          void window.desktopApi.exitApp()
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
          void window.desktopApi.minimizeWindow()
          break
        case 'zoom':
          void window.desktopApi
            .toggleWindowMaximized()
            .then(next => setIsWindowMaximized(next))
          break
        case 'close':
          void window.desktopApi.closeWindow()
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
  const resolvedSelectedModelPreset = resolveModelPresetId(
    model,
    selectedModelPreset,
    modelPresets,
  )

  const refreshProviderState = useCallback(async (): Promise<void> => {
    try {
      const next = await window.desktopApi.getModelProviderState()
      setProviderState(next)
      if (next.model !== model) {
        setModel(next.model)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [model, setModel])

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

  const handleModelPresetChange = useCallback(
    (nextPresetId: string): void => {
      if (nextPresetId === CUSTOM_MODEL_PRESET_ID) {
        const customValue = window.prompt('输入自定义模型名称', model)
        if (!customValue) {
          setSelectedModelPreset(
            resolveModelPresetId(model, selectedModelPreset, modelPresets),
          )
          return
        }
        const trimmed = customValue.trim()
        if (!trimmed) return
        setModel(trimmed)
        setSelectedModelPreset(CUSTOM_MODEL_PRESET_ID)
        if (providerState) {
          void window.desktopApi
            .saveModelProvider({
              providerID: providerState.selectedProviderID,
              modelID: trimmed,
              baseURL: providerState.baseURL,
            })
            .then(setProviderState)
            .catch(error =>
              setErrorMessage(
                error instanceof Error ? error.message : String(error),
              ),
            )
        }
        return
      }
      const preset = modelPresets.find(item => item.id === nextPresetId)
      if (!preset) return
      setSelectedModelPreset(nextPresetId)
      setModel(preset.value)
      if (providerState) {
        void window.desktopApi
          .saveModelProvider({
            providerID: providerState.selectedProviderID,
            modelID: preset.value,
            baseURL: providerState.baseURL,
          })
          .then(setProviderState)
          .catch(error =>
            setErrorMessage(
              error instanceof Error ? error.message : String(error),
            ),
          )
      }
    },
    [
      model,
      modelPresets,
      providerState,
      setModel,
      setSelectedModelPreset,
      selectedModelPreset,
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
  const runtimeMissing = runtimeStatus?.agentExecutableExists === false
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
    let mounted = true
    void window.desktopApi
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
        void window.desktopApi.closeWindow()
      }}
      onMinimize={() => {
        void window.desktopApi.minimizeWindow()
      }}
      onToggleMaximize={() => {
        void window.desktopApi
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
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onCreateSession={() => void handleCreateSession()}
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
      selectedModelPreset={resolvedSelectedModelPreset}
      modelPresets={modelPresets}
      permissionOptions={PERMISSION_MODE_OPTIONS}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      recentWorkspaces={recentWorkspaces}
      workspace={currentWorkspace}
      placeholder={hasConversationMessages ? '要求后续变更' : '随心输入'}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onInputChange={setInput}
      onInterrupt={() => void interrupt()}
      onModelChange={handleModelPresetChange}
      onOpenFiles={() => {}}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
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
      {activePermissionRequest ? (
        <div className="permission-modal-backdrop">
          <section className="permission-modal">
            <header>
              <h2>权限请求</h2>
              <span>{activePermissionRequest.toolName}</span>
            </header>
            <p>{activePermissionRequest.description}</p>
            <code>{JSON.stringify(activePermissionRequest.input)}</code>
            <div className="permission-modal-actions">
              <button
                className="primary-button"
                onClick={() =>
                  void decidePermission(activePermissionRequest, 'allow')
                }
                type="button"
              >
                允许
              </button>
              <button
                onClick={() =>
                  void decidePermission(activePermissionRequest, 'allow', true)
                }
                type="button"
              >
                始终允许
              </button>
              <button
                onClick={() =>
                  void decidePermission(activePermissionRequest, 'deny')
                }
                type="button"
              >
                拒绝
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {!currentWorkspace && runtimeMissing ? (
        <div className="global-warning">
          <AlertCircle size={16} />
          <span>
            桌面端 agent 运行时缺失，发送消息前请先执行
            `bun run desktop:agent:build`。
          </span>
        </div>
      ) : null}

      <DesktopShell
        windowChrome={windowChrome}
        sidebar={sidebar}
        content={
        <QuickChatContext.Provider
          value={{
            isConversationRoute,
            isConversationLoading,
            workspaceName: currentWorkspace?.name ?? null,
            messages: isHomePage || isConversationLoading ? [] : messages,
            errorMessage,
            onDismissError: () => setErrorMessage(null),
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
