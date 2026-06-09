import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type {
  DesktopPermissionRequest,
  DesktopWorkspace,
} from '../shared/types.js'
import {
  CUSTOM_MODEL_PRESET_ID,
  MODEL_PRESETS,
  resolveModelPresetId,
} from './modelPresets.js'
import { AutomationView } from './components/AutomationView.js'
import { ComposerCard } from './components/ComposerCard.js'
import { DesktopShell } from './components/DesktopShell.js'
import { DesktopSidebar } from './components/DesktopSidebar.js'
import { PluginsView } from './components/PluginsView.js'
import { QuickChatView } from './components/QuickChatView.js'
import { RightDrawer } from './components/RightDrawer.js'
import { SearchView } from './components/SearchView.js'
import { WindowChrome } from './components/WindowChrome.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from './components/WindowChrome.js'
import type { AppView, DrawerTab, SessionListItem } from './uiTypes.js'
import { PERMISSION_MODE_OPTIONS, THINKING_MODE_OPTIONS } from './features/settings/settingsStorage.js'
import { useDesktopSettings } from './features/settings/useDesktopSettings.js'
import { useDesktopLayout } from './features/layout/useDesktopLayout.js'
import { useWorkspaceState } from './features/workspace/useWorkspaceState.js'
import { useSessionState } from './features/session/useSessionState.js'
import { useDesktopCommands } from './features/session/useDesktopCommands.js'
import { useDesktopSearch } from './features/search/useDesktopSearch.js'

declare global {
  interface Window {
    desktopApi: import('../shared/types.js').DesktopApi
  }
}

export function App(): React.ReactNode {
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
    activeView,
    drawerTab,
    selectedModelPreset,
    setPermissionMode,
    setModel,
    setFallbackModel,
    setSessionName,
    setThinkingMode,
    setSystemPrompt,
    setAppendSystemPrompt,
    setAdditionalDirectories,
    setRecentWorkspaces,
    setActiveView,
    setDrawerTab,
    setSelectedModelPreset,
  } = settings
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
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
    onOpenDrawerPermissions: () => {
      setDrawerTab('permissions')
      setIsDrawerOpen(true)
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

  const openDrawerTab = useCallback(
    (tab: DrawerTab): void => {
      setDrawerTab(tab)
      setIsDrawerOpen(true)
    },
    [setDrawerTab],
  )

  const handleChooseWorkspace = useCallback(
    async (): Promise<DesktopWorkspace | null> => {
      const selected = await chooseWorkspace()
      if (!selected) return null
      setActiveView('quickChat')
      setWorkspaceState(selected)
      await refreshWorkspace(selected)
      return selected
    },
    [chooseWorkspace, refreshWorkspace, setActiveView, setWorkspaceState],
  )

  const handleOpenRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      const selected = await openRecentWorkspace(target)
      if (!selected) return null
      setActiveView('quickChat')
      setWorkspaceState(selected)
      await refreshWorkspace(selected)
      return selected
    },
    [openRecentWorkspace, refreshWorkspace, setActiveView, setWorkspaceState],
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
    setActiveView('quickChat')
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
    setActiveView,
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
      openDrawerTab('settings')
    },
    onLogOut: () => {
      setErrorMessage('已退出登录（本地无持久账户，请重新启动应用）。')
    },
  })

  const handleFileMenuAction = useCallback(
    (action: FileMenuAction): void => {
      console.log('[app] handleFileMenuAction', action)
      if (
        typeof window !== 'undefined' &&
        window.desktopApi &&
        typeof window.desktopApi.logRenderer === 'function'
      ) {
        try {
          void window.desktopApi.logRenderer('[app] handleFileMenuAction', action)
        } catch {}
      }
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
          setActiveView('quickChat')
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
    [handleChooseWorkspace, handleNewConversation, setActiveView],
  )

  const handleEditMenuAction = useCallback(
    (action: EditMenuAction): void => {
      console.log('[app] handleEditMenuAction', action)
      if (
        typeof window !== 'undefined' &&
        window.desktopApi &&
        typeof window.desktopApi.logRenderer === 'function'
      ) {
        try {
          void window.desktopApi.logRenderer('[app] handleEditMenuAction', action)
        } catch {}
      }
    },
    [],
  )

  const handleViewMenuAction = useCallback(
    (action: ViewMenuAction): void => {
      console.log('[app] handleViewMenuAction', action)
      if (
        typeof window !== 'undefined' &&
        window.desktopApi &&
        typeof window.desktopApi.logRenderer === 'function'
      ) {
        try {
          void window.desktopApi.logRenderer('[app] handleViewMenuAction', action)
        } catch {}
      }
      if (action === 'toggleSidebar') {
        toggleSidebarCollapsed()
      }
    },
    [toggleSidebarCollapsed],
  )

  const handleWindowMenuAction = useCallback(
    (action: WindowMenuAction): void => {
      console.log('[app] handleWindowMenuAction', action)
      if (
        typeof window !== 'undefined' &&
        window.desktopApi &&
        typeof window.desktopApi.logRenderer === 'function'
      ) {
        try {
          void window.desktopApi.logRenderer(
            '[app] handleWindowMenuAction',
            action,
          )
        } catch {}
      }
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
    (action: HelpMenuAction): void => {
      console.log('[app] handleHelpMenuAction', action)
      if (
        typeof window !== 'undefined' &&
        window.desktopApi &&
        typeof window.desktopApi.logRenderer === 'function'
      ) {
        try {
          void window.desktopApi.logRenderer('[app] handleHelpMenuAction', action)
        } catch {}
      }
    },
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
      setActiveView('quickChat')
      setWorkspaceState(nextWorkspace)
      void refreshWorkspace(nextWorkspace, { expectedSessionId: sessionItem.id })
    },
    [refreshWorkspace, selectSessionRaw, setActiveView, setWorkspaceState],
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
      setActiveView(view)
    },
    [setActiveView],
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

  const settingsContent = (
    <div className="settings-list">
      <label className="setting-field">
        <span>会话名称</span>
        <input
          value={sessionName}
          onChange={event => setSessionName(event.target.value)}
          placeholder="为空时默认使用项目名称"
        />
      </label>
      <label className="setting-field">
        <span>Fallback 模型</span>
        <input
          value={fallbackModel}
          onChange={event => setFallbackModel(event.target.value)}
          placeholder="模型繁忙时回退到此模型"
        />
      </label>
      <label className="setting-field">
        <span>System Prompt</span>
        <textarea
          value={systemPrompt}
          onChange={event => setSystemPrompt(event.target.value)}
          placeholder="替换默认系统提示词"
        />
      </label>
      <label className="setting-field">
        <span>追加 Prompt</span>
        <textarea
          value={appendSystemPrompt}
          onChange={event => setAppendSystemPrompt(event.target.value)}
          placeholder="附加到默认提示词后面"
        />
      </label>
      <label className="setting-field">
        <span>额外目录</span>
        <textarea
          value={additionalDirectories}
          onChange={event => setAdditionalDirectories(event.target.value)}
          placeholder="每行一个目录，可相对项目或绝对路径"
        />
      </label>
      <div className="setting-runtime">
        <p>认证方式：{authStatus?.method ?? '未知'}</p>
        <p>账号：{authStatus?.email ?? '未登录'}</p>
        <p>
          Agent 运行时：
          {runtimeStatus?.agentExecutableExists ? '可用' : '缺失'}
        </p>
        <p>Agent 路径：{runtimeStatus?.agentExecutablePath ?? '检查中'}</p>
        <button onClick={() => void refreshRuntimeStatus()} type="button">
          <RefreshCw size={15} />
          <span>刷新运行时</span>
        </button>
      </div>
      <div className="setting-runtime">
        <p>当前项目：{currentWorkspace?.path ?? '无'}</p>
        <p>
          当前会话：
          {activeSessionItem?.sessionName ??
            activeSessionItem?.workspaceName ??
            '无'}
        </p>
        <p>当前模型：{(activeSessionItem?.model ?? model) || '默认模型'}</p>
        <p>
          当前推理：
          {
            THINKING_MODE_OPTIONS.find(option => option.value === thinkingMode)
              ?.label
          }
        </p>
      </div>
    </div>
  )

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
      activeView={activeView}
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
      onOpenSettings={() => openDrawerTab('settings')}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onRefreshWorkspace={() => void refreshWorkspace()}
      onSelectSession={handleSelectSession}
      onSelectView={handleSelectView}
      onSetWidth={setSidebarWidth}
      onToggleCollapsed={toggleSidebarCollapsed}
    />
  )

  const content =
    activeView === 'quickChat' ? (
      <QuickChatView
        workspaceName={currentWorkspace?.name ?? null}
        messages={messages}
        errorMessage={errorMessage}
        onDismissError={() => setErrorMessage(null)}
        sessionStatus={sessionStatus}
      />
    ) : activeView === 'search' ? (
      <SearchView
        query={searchQuery}
        workspaces={search.filteredWorkspaces}
        sessions={search.filteredSessions}
        onQueryChange={setSearchQuery}
        onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
        onSelectSession={session => handleSelectSession(session)}
      />
    ) : activeView === 'plugins' ? (
      <PluginsView />
    ) : (
      <AutomationView />
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
      onOpenFiles={() => openDrawerTab('files')}
      onOpenWorkspace={workspaceItem => void handleOpenRecentWorkspace(workspaceItem)}
      onPermissionChange={setPermissionMode}
      onSubmit={() => void submit()}
      onThinkingChange={setThinkingMode}
    />
  )

  const drawer = (
    <RightDrawer
      isOpen={isDrawerOpen}
      activeTab={drawerTab}
      files={files}
      selectedFile={selectedFile}
      diff={diff}
      pendingPermissions={pendingPermissions}
      toolLog={toolLog}
      settingsContent={settingsContent}
      onClose={() => setIsDrawerOpen(false)}
      onSelectTab={tab => {
        setDrawerTab(tab)
        setIsDrawerOpen(true)
      }}
      onPreviewFile={file => void previewFile(file)}
      onToggleToolLog={toggleToolLogEntry}
      onDecidePermission={(request, behavior, alwaysAllow) =>
        void decidePermission(request, behavior, alwaysAllow)
      }
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
        content={content}
        composer={composer}
        drawer={drawer}
      />
    </div>
  )
}
