import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { ComposerCard } from './components/ComposerCard.js'
import { DesktopShell } from './components/DesktopShell.js'
import { DesktopSidebar } from './components/DesktopSidebar.js'
import { PluginsView } from './components/PluginsView.js'
import { QuickChatView } from './components/QuickChatView.js'
import { SearchView } from './components/SearchView.js'
import { AutomationView } from './components/AutomationView.js'
import { SettingsPage } from './components/SettingsPage.js'
import { WindowChrome } from './components/WindowChrome.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from './components/WindowChrome.js'
import type { AppView, SessionListItem } from './uiTypes.js'
import { PERMISSION_MODE_OPTIONS, THINKING_MODE_OPTIONS } from './features/settings/settingsStorage.js'
import { useDesktopSettings } from './features/settings/useDesktopSettings.js'
import { useDesktopLayout } from './features/layout/useDesktopLayout.js'
import { useWorkspaceState } from './features/workspace/useWorkspaceState.js'
import { useSessionState } from './features/session/useSessionState.js'
import { useDesktopCommands } from './features/session/useDesktopCommands.js'
import { useDesktopSearch } from './features/search/useDesktopSearch.js'
import { CUSTOM_MODEL_PRESET_ID, MODEL_PRESETS, resolveModelPresetId } from './modelPresets.js'
import type { DesktopPermissionRequest, DesktopWorkspace } from '../shared/types.js'

// 主布局组件 - 所有页面的共同容器
function DesktopLayout(): React.ReactNode {
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
    setFallbackModel,
    setSessionName,
    setThinkingMode,
    setSystemPrompt,
    setAppendSystemPrompt,
    setAdditionalDirectories,
    setSelectedModelPreset,
  } = settings
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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
    authStatus,
    runtimeStatus,
    files,
    selectedFile,
    diff,
    setActiveSessionId,
    refreshRuntimeStatus,
    refreshWorkspace,
    chooseWorkspace,
    openRecentWorkspace,
    previewFile,
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
  })
  const {
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
    selectSession: selectSessionRaw,
    toggleToolLogEntry,
  } = session

  useEffect(() => {
    setActiveSessionId(sessionId)
  }, [sessionId, setActiveSessionId])

  const navigate = useNavigate()
  const location = useLocation()

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
    if (currentWorkspace) {
      await createSessionForWorkspace(currentWorkspace)
      return
    }
    const selected = await handleChooseWorkspace()
    if (selected) {
      await createSessionForWorkspace(selected)
    }
  }, [createSessionForWorkspace, currentWorkspace, handleChooseWorkspace])

  const handleNewConversation = useCallback(async (): Promise<void> => {
    navigate('/')
    if (currentWorkspace) {
      await createSessionForWorkspace(currentWorkspace)
      return
    }
    const selected = await handleChooseWorkspace()
    if (selected) {
      await createSessionForWorkspace(selected)
    }
  }, [
    createSessionForWorkspace,
    currentWorkspace,
    handleChooseWorkspace,
    navigate,
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
      setErrorMessage('已退出登录（本地无持久账户，请重新启动应用）。')
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

  const handleModelPresetChange = useCallback(
    (nextPresetId: string): void => {
      if (nextPresetId === CUSTOM_MODEL_PRESET_ID) {
        const customValue = window.prompt('输入自定义模型名称', model)
        if (!customValue) {
          setSelectedModelPreset(resolveModelPresetId(model, selectedModelPreset))
          return
        }
        const trimmed = customValue.trim()
        if (!trimmed) return
        setModel(trimmed)
        setSelectedModelPreset(CUSTOM_MODEL_PRESET_ID)
        return
      }
      const preset = MODEL_PRESETS.find(item => item.id === nextPresetId)
      if (!preset) return
      setSelectedModelPreset(nextPresetId)
      setModel(preset.value)
    },
    [model, setModel, setSelectedModelPreset, selectedModelPreset],
  )

  const handleSelectSession = useCallback(
    (sessionItem: SessionListItem): void => {
      const nextWorkspace = selectSessionRaw(sessionItem)
      navigate('/')
      setWorkspaceState(nextWorkspace)
      void refreshWorkspace(nextWorkspace, { expectedSessionId: sessionItem.id })
    },
    [navigate, refreshWorkspace, selectSessionRaw, setWorkspaceState],
  )

  const handleCloseSession = useCallback(
    async (targetSessionId: string): Promise<void> => {
      const result = await closeSession(targetSessionId)
      if (!result) return
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
    [closeSession, refreshWorkspace, setDiffState, setSelectedFile, setWorkspaceState],
  )

  const handleSelectView = useCallback(
    (view: AppView): void => {
      navigate(`/${view === 'quickChat' ? '' : view}`)
    },
    [navigate],
  )

  const runtimeMissing = runtimeStatus?.agentExecutableExists === false
  const activePermissionRequest: DesktopPermissionRequest | null =
    pendingPermissions[0] ?? null
  const workspaceName = currentWorkspace?.name ?? '未选择项目'
  const branchName =
    currentWorkspace?.isGitRepo === false
      ? '未检测到 Git 分支'
      : currentWorkspace?.branchName ?? '未检测到 Git 分支'

  const search = useDesktopSearch({
    query: searchQuery,
    recentWorkspaces,
    sessions,
  })

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
      activeView={getActiveViewFromPath(location.pathname)}
      collapsed={sidebarCollapsed}
      maxWidth={Math.round(viewportWidth * 0.2)}
      minWidth={Math.round(viewportWidth * 0.12)}
      recentWorkspaces={recentWorkspaces}
      sessions={sessions}
      width={sidebarWidth}
      workspace={currentWorkspace}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onCloseSession={session => void handleCloseSession(session)}
      onCreateSession={() => void handleCreateSession()}
      onOpenSettings={() => navigate('/settings')}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onRefreshWorkspace={() => void refreshWorkspace()}
      onSelectSession={handleSelectSession}
      onSelectView={handleSelectView}
      onSetWidth={setSidebarWidth}
      onToggleCollapsed={toggleSidebarCollapsed}
    />
  )

  const composer = (
    <ComposerCard
      input={input}
      canSubmit={canSubmit}
      sessionStatus={sessionStatus}
      permissionMode={permissionMode}
      thinkingMode={thinkingMode}
      selectedModelPreset={selectedModelPreset}
      modelPresets={MODEL_PRESETS}
      permissionOptions={PERMISSION_MODE_OPTIONS}
      thinkingOptions={THINKING_MODE_OPTIONS}
      branchName={branchName}
      recentWorkspaces={recentWorkspaces}
      workspace={currentWorkspace}
      onChooseWorkspace={() => void handleChooseWorkspace()}
      onInputChange={setInput}
      onInterrupt={() => void interrupt()}
      onModelChange={handleModelPresetChange}
      onOpenFiles={() => {}}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onPermissionChange={setPermissionMode}
      onSubmit={() => void submit()}
      onThinkingChange={setThinkingMode}
    />
  )

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
        content={<Outlet />}
        composer={composer}
      />
    </div>
  )
}

// 根据路径获取当前视图
function getActiveViewFromPath(pathname: string): AppView {
  if (pathname === '/') return 'quickChat'
  if (pathname === '/search') return 'search'
  if (pathname === '/plugins') return 'plugins'
  if (pathname === '/automation') return 'automation'
  return 'quickChat'
}

// 路由配置 - 所有页面共用 DesktopLayout
const router = createBrowserRouter([
  {
    path: '/',
    element: <DesktopLayout />,
    children: [
      { index: true, element: <QuickChatView /> },
      { path: 'search', element: <SearchView /> },
      { path: 'plugins', element: <PluginsView /> },
      { path: 'automation', element: <AutomationView /> },
      { path: 'settings', element: <SettingsView /> },
    ],
  },
])

function SettingsView(): React.ReactNode {
  const navigate = useNavigate()
  return (
    <SettingsPage onClose={() => navigate(-1)} />
  )
}

export { router }
