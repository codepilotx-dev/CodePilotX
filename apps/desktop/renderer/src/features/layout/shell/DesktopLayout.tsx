import {
  desktopClient,
  readDesktopBrowserDebugMode,
  writeDesktopBrowserDebugMode,
} from '../../../services/desktop-client/index.js'
import {
  openPathWithPreferredExternalTarget,
  shouldFallbackToExternalOpen,
} from '../../../services/externalOpenTargetsStore.js'
import type React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import {
  DesktopComposer,
  getDesktopComposerBranchName,
  type DesktopComposerProps,
} from '../../session/composer/DesktopComposer.js'
import type { ComposerDraftKey } from '../../session/composer/composerTypes.js'
import { deriveWorkflowSessionState } from '../../../../shared/workflowReducer.js'
import {
  WorkspaceShellControls,
  WorkbenchPanel,
  type WorkbenchFileLoadErrorEvent,
} from '../dock/RightDock.js'
import {
  DesktopWorkspaceHeader,
  WorkspaceHeaderProvider,
} from '../workspace-header/index.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
  type WorkbenchPanelTarget,
  type WorkbenchTabId,
} from '../dock/rightDockState.js'
import {
  createDefaultConversationUiState,
  createDefaultReviewTabUiState,
  saveConversationUiState,
  loadConversationUiState,
  validateConversationUiState,
  type ConversationUiState,
  type ReviewTabUiState,
} from '../tabs/conversationUiState.js'
import { DesktopSidebar } from '../DesktopSidebar.js'
import { GlobalErrorModal } from '../../../components/GlobalErrorModal.js'
import type { GitWorkflowMode } from '../panels/GitWorkflowModal.js'
import { SidebarFrame } from '../SidebarFrame.js'
import { MenuBar } from '../MenuBar.js'
import type {
  EditMenuAction,
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from '../MenuBar.js'
import { QuickChatContext } from '../../session/QuickChatContext.js'
import { SearchContext } from '../../search/SearchContext.js'
import {
  sessionDisplayTitle,
  sessionViewFallbackTitle,
  type SessionListItem,
} from '../../../uiTypes.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import { NO_WORKSPACE_DIFF } from '../../workspace/useWorkspaceState.js'
import { shouldRestoreLastWorkspace } from '../../workspace/lastWorkspaceRestore.js'
import { useSessionState } from '../../session/state/useSessionState.js'
import { useDesktopCommands } from '../../session/useDesktopCommands.js'
import { useDesktopSearch } from '../../search/useDesktopSearch.js'
import { withModelCatalogLoading } from '../../../hooks/useModelCatalogLoading.js'
import {
  buildModelPresets,
  resolveModelPresetId,
} from '../../../modelPresets.js'
import type {
  DesktopModelMetadata,
  DesktopBrowserState,
  DesktopFileEntry,
  DesktopPermissionMode,
  DesktopUserMessageInput,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
  SidebarSectionId,
} from '../../../../shared/types.js'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { upsertRecentWorkspace } from '../../../../shared/settings.js'
import {
  QUICK_CHAT_PATH,
  sessionPath,
  useWorkbenchRouteController,
} from './useWorkbenchRouteController.js'
import {
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  useWorkbenchShellController,
} from './useWorkbenchShellController.js'
import { useWorkbenchWorkspaceController } from './useWorkbenchWorkspaceController.js'
import { useModelProviderController } from '../useModelProviderController.js'
import { useSubagentDockController } from '../dock/useSubagentDockController.js'
import { WorkbenchShellView } from './WorkbenchShellView.js'
import { resolveSidebarEscapeAction } from '../sidebarShellState.js'
import type {
  MarkdownFileOpenOptions,
  MarkdownFileReference,
} from '../../markdown/index.js'
import {
  hasDirtyFileDocuments,
  prefetchFileDocument,
  saveAllFileDocuments,
  saveFileDocument,
} from '../../workspace/fileDocumentStore.js'

const GitWorkflowModal = lazy(() => import('../panels/GitWorkflowModal.js').then(module => ({ default: module.GitWorkflowModal })))
const GithubRepositoryModal = lazy(() => import('../panels/GithubRepositoryModal.js').then(module => ({ default: module.GithubRepositoryModal })))
const SettingsSidebarContent = lazy(() => import('../../settings/SettingsSidebarContent.js').then(module => ({ default: module.SettingsSidebarContent })))
const SubagentThreadPanel = lazy(() => import('../../session/subagents/SubagentThreadPanel.js').then(module => ({ default: module.SubagentThreadPanel })))

const EMPTY_BRANCHES: string[] = []
const EXTERNAL_FILE_EXTENSIONS = new Set([
  'bmp',
  'doc',
  'docx',
  'gif',
  'ico',
  'ipynb',
  'jpeg',
  'jpg',
  'ods',
  'odt',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'svg',
  'webp',
  'xls',
  'xlsm',
  'xlsx',
])

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], dialog[open]') !== null
}

function createFilePreviewTabId(
  workspacePath: string,
  relativePath: string,
): `file:${string}` {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').toLowerCase()
  const normalizedFile = relativePath.replace(/\\/g, '/').toLowerCase()
  return `file:${encodeURIComponent(`${normalizedWorkspace}\u0000${normalizedFile}`)}`
}

function resolveWorkspaceFileReference(
  workspacePath: string,
  referencePath: string,
): { relativePath: string; absolutePath: string } | null {
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/u, '')
  const value = referencePath.trim().replace(/\\/g, '/')
  if (!value) return null

  const isAbsolute = /^(?:[a-zA-Z]:\/|\/\/|\/)/u.test(value)
  let relativePath = value

  if (isAbsolute) {
    const prefix = `${workspace}/`
    const matchesWorkspace =
      /^[a-zA-Z]:\//u.test(workspace) || /^[a-zA-Z]:\//u.test(value)
        ? value.toLowerCase().startsWith(prefix.toLowerCase())
        : value.startsWith(prefix)
    if (!matchesWorkspace) {
      // Check if reference IS the workspace root itself (exact match)
      if (value.toLowerCase() === workspace.toLowerCase()) {
        return { relativePath: '.', absolutePath: workspace }
      }
      return null
    }
    relativePath = value.slice(prefix.length)
  }

  relativePath = relativePath.replace(/^(?:\.\/)+/u, '')

  // Handle workspace root (empty or '.' after stripping)
  if (!relativePath || relativePath === '.') {
    return { relativePath: '.', absolutePath: workspace }
  }

  const segments = relativePath.split('/').filter(Boolean)
  if (segments.some(segment => segment === '..')) {
    return null
  }
  if (segments.length === 0) {
    return { relativePath: '.', absolutePath: workspace }
  }

  relativePath = segments.join('/')
  return {
    relativePath,
    absolutePath: `${workspace}/${relativePath}`,
  }
}

function shouldOpenFileExternally(path: string): boolean {
  const extension = path.split(/[\\/]/u).pop()?.split('.').pop()?.toLowerCase()
  return extension ? EXTERNAL_FILE_EXTENSIONS.has(extension) : false
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
}

/** Incrementing counter to sequence directory probe requests */
let directoryProbeRequestId = 0

export function DesktopLayout(): React.ReactNode {
  const location = useLocation()
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
    installCodePilotXDependencies,
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
    followUpBehavior,
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
	    sidebarSessionPins,
	    setSidebarSessionPins,
	    syncExternalSettingsPatch,
  } = settings
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [_runtimeWarningDismissed, setRuntimeWarningDismissed] = useState(false)
  const [archiveNoticeVisible, setArchiveNoticeVisible] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [gitWorkflowMode, setGitWorkflowMode] =
    useState<GitWorkflowMode | null>(null)
  const [githubRepositoryModalOpen, setGithubRepositoryModalOpen] =
    useState(false)
  const [browserState, setBrowserState] = useState<DesktopBrowserState | null>(
    null,
  )
  const [menubarDebugMode, setMenubarDebugMode] = useState(() =>
    readDesktopBrowserDebugMode(),
  )
  const {
    providerState,
    setProviderState,
    modelProviders,
    setModelProviders,
    modelCatalogLoading,
  } = useModelProviderController()
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebarCollapsed,
    collapseSidebar,
    sidebarShell,
    sidebarMinWidth,
    sidebarMaxWidth,
    workbenchPanelState,
    setWorkbenchPanelState,
    rightDockState,
    bottomPanelState,
    bottomPanelVisible,
    rightDockWidth,
    bottomPanelHeight,
    openRightDockTab,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleSetBottomPanelHeight,
    handleResetBottomPanelHeight,
    handleOpenPlanDock,
    toggleBottomPanelVisible,
    openPanelTab,
    selectPanelTab,
    closePanelTab,
    togglePanel,
    closePanel,
    movePanelTab,
    reorderPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    pinTab,
    setFileMarkdownViewMode,
    toggleRightFullWidth,
  } = useWorkbenchShellController(menubarDebugMode)
  const handleErrorMessage = useCallback((message: string): void => {
    setErrorMessage(message || null)
  }, [])
  const {
    workspace,
    unavailableWorkspacePaths,
    setUnavailableWorkspacePaths,
    removedWorkspaces,
    setRemovedWorkspaces,
    lastActiveWorkspacePath,
    setLastActiveWorkspacePath,
    clearWorkspaceRemoved,
    clearWorkspaceUnavailable,
  } = useWorkbenchWorkspaceController({
    initialLastActiveWorkspacePath:
      settings.draft.values.lastActiveWorkspacePath ?? '',
    initialRemovedWorkspaces: settings.draft.values.removedWorkspaces ?? [],
    settings,
    onError: handleErrorMessage,
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
    permissionConfig: settings.draft.values.permissionConfig,
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
    installCodePilotXDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    followUpBehavior,
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
    catalogStatus,
    sessions,
    sessionFallbackTitles,
    sessionStatus,
    events,
    workflowEvents,
    messages,
    contextUsage,
    queuedFollowUps,
    queuePauseReason,
    pendingPermissions,
    pendingPermissionSessionIds,
    input,
    setInput,
    composerAttachments,
    setComposerAttachments,
    appendComposerAttachmentsForDraft,
    removeComposerAttachmentForDraft,
    clearComposerDraftIfUnchanged,
    activateSessionById,
    createSessionForWorkspace,
    submitToSession,
    interrupt,
    decidePermission,
    archiveSessions,
    renameSession,
    setSessionPermissionMode,
    setSessionPlanModeActive,
    setSessionLocalRouterMode,
    activeSessionItem,
    permissionMode: effectivePermissionMode,
    planModeActive,
    localRouterMode: effectiveLocalRouterMode,
  } = session
  const isBrowserMockSession = sessionId?.startsWith('browser-mock-') === true
  const localRouterAvailable = !sessionId || isBrowserMockSession

  const {
    navigate,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    routedSessionId,
    isQuickChatPage,
    isConversationRoute,
    isSettingsRoute,
    settingsActiveTab,
    handleSettingsTabChange,
    handleSettingsBack,
  } = useWorkbenchRouteController()
  useEffect(() => {
    const bridge = window.codePilotXDesktop
    if (!bridge) return
    if (
      settingsLoaded &&
      settings.draft.values.pet.enabled &&
      typeof bridge.openPetOverlay === 'function'
    ) {
      void bridge.openPetOverlay()
    }
    if (typeof bridge.onPetOpenSession !== 'function') return
    return bridge.onPetOpenSession(threadId => {
      navigate(sessionPath(threadId))
    })
  }, [
    navigate,
    settings.draft.values.pet.enabled,
    settingsLoaded,
  ])
  const mainComposerDraftKey: ComposerDraftKey = routedSessionId
    ? `session:${routedSessionId}`
    : 'home'
  const lastWorkspaceRestoreAttemptedRef = useRef(false)

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

  const handleCreateBranch = useCallback((): void => {
    setGitWorkflowMode('branch')
  }, [])

  const handleCommitOrPush = useCallback((): void => {
    setGitWorkflowMode('commitPush')
  }, [])

  const handleCreatePullRequest = useCallback((): void => {
    setGitWorkflowMode('pullRequest')
  }, [])

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

  const handleOpenBrowser = useCallback((): void => {
    openRightDockTab({ id: 'browser', kind: 'browser' })
    void desktopClient
      .openBrowser()
      .then(setBrowserState)
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [openRightDockTab])

  const handleOpenFilesDock = useCallback((): void => {
    openRightDockTab({ id: 'file-browser', kind: 'file-browser' })
  }, [openRightDockTab])

  const handleOpenSideChat = useCallback((): void => {
    openRightDockTab({ id: 'side-chat', kind: 'side-chat' })
  }, [openRightDockTab])

  const handleOpenReview = useCallback((): void => {
    openRightDockTab({ id: 'review', kind: 'review' })
  }, [openRightDockTab])

  const handleStartAiReview = useCallback(
    async (
      target:
        | { type: 'uncommittedChanges' }
        | { type: 'baseBranch'; branch: string },
    ): Promise<void> => {
      if (!sessionId) {
        setErrorMessage('请先打开一个任务，再发起代码审查。')
        return
      }
      try {
        const result = await desktopClient.startSessionReview(sessionId, target)
        setReviewTabState(current => ({
          ...current,
          source: result.source,
          selectedFile: null,
          selectedCommentId: null,
          scrollTop: 0,
          diffExpansion: { mode: 'all' },
        }))
        openRightDockTab({ id: 'review', kind: 'review' })
        if (
          result.delivery === 'detached' &&
          result.threadId !== sessionId
        ) {
          const detachedState = createDefaultConversationUiState()
          detachedState.workbench = applyWorkbenchPanelAction(
            detachedState.workbench,
            {
              type: 'openTab',
              target: 'right',
              tab: { id: 'review', kind: 'review' },
            },
          )
          detachedState.review = {
            ...detachedState.review,
            source: result.source,
          }
          saveConversationUiState(result.threadId, detachedState)
          navigate(sessionPath(result.threadId))
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [navigate, openRightDockTab, sessionId],
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

  const activeSideTaskId = useMemo(() => {
    const preferredTarget =
      workbenchPanelState.focusArea === 'bottom-panel' ? 'bottom' : 'right'
    const fallbackTarget =
      preferredTarget === 'right' ? 'bottom' : 'right'
    for (const target of [preferredTarget, fallbackTarget] as const) {
      const panel = workbenchPanelState[target]
      if (!panel.open || !panel.activeTabId) continue
      const tab = workbenchPanelState.tabsById[panel.activeTabId]
      if (tab?.kind === 'side-task') return tab.taskId
    }
    return null
  }, [workbenchPanelState])

  const {
    sideChatInput,
    setSideChatInput,
    sideChatFocusVersion,
    sideChatAttachments,
    setSideChatAttachments,
    selectedSubagentTaskId,
    selectedSubagent,
    subagentPermissionMode,
    setSubagentPermissionMode,
    handleAppendSideChatText,
    sideChatSubmitToSession,
    appendSideComposerAttachmentsForDraft,
    removeSideComposerAttachmentForDraft,
    clearSideComposerDraftIfUnchanged,
    refreshSelectedSubagent,
    handleOpenSubagent,
  } = useSubagentDockController({
    activeSideTaskId,
    model,
    openRightDockTab,
    submitToSession,
    onError: handleErrorMessage,
  })
  const sideComposerDraftKey: ComposerDraftKey = selectedSubagentTaskId
    ? `side-task:${selectedSubagentTaskId}`
    : 'side-chat'

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
    const targetDraftKey = mainComposerDraftKey
    void desktopClient
      .authorizeComposerFilePaths(filePaths)
      .then(() => desktopClient.readComposerFiles(filePaths))
      .then(nextAttachments => {
        if (nextAttachments.length === 0) return
        appendComposerAttachmentsForDraft(targetDraftKey, nextAttachments)
      })
      .catch(error =>
        setErrorMessage(error instanceof Error ? error.message : String(error)),
      )
  }, [])

  const handleNewConversation = useCallback(async (): Promise<void> => {
    activateSessionById(null)
    setInput('')
    setComposerAttachments([])
    navigate(QUICK_CHAT_PATH)
  }, [
    activateSessionById,
    navigate,
    setComposerAttachments,
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
      navigate('/settings/general')
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

  const browserTabVisible = useMemo(
    () =>
      (['right', 'bottom'] as const).some(target => {
        const panel = workbenchPanelState[target]
        if (!panel.open || !panel.activeTabId) return false
        return (
          workbenchPanelState.tabsById[panel.activeTabId]?.kind === 'browser'
        )
      }),
    [workbenchPanelState],
  )

  useEffect(() => {
    if (browserTabVisible) return
    void desktopClient
      .setBrowserBounds({ x: 0, y: 0, width: 0, height: 0 })
      .then(setBrowserState)
      .catch(() => undefined)
  }, [browserTabVisible])

  const prevSessionIdRef = useRef<string | null>(null)
  const [reviewTabState, setReviewTabState] = useState<ReviewTabUiState>(
    createDefaultReviewTabUiState,
  )
  const uiSnapshotRef = useRef<ConversationUiState>(
    createDefaultConversationUiState(),
  )
  uiSnapshotRef.current = {
    schemaVersion: 4,
    workbench: workbenchPanelState,
    mainScrollTop: 0,
    sideChatInput,
    sideChatAttachments,
    review: reviewTabState,
  }

  useEffect(() => {
    const prevId = prevSessionIdRef.current
    const currentId = sessionId

    if (prevId && prevId !== currentId) {
      saveConversationUiState(prevId, uiSnapshotRef.current)
    }

    prevSessionIdRef.current = currentId

    if (currentId) {
      const saved = loadConversationUiState(currentId)
      if (saved) {
        const validated = validateConversationUiState(saved, {
          debugMode: menubarDebugMode,
        })
        setWorkbenchPanelState(validated.workbench)
        setSideChatInput(validated.sideChatInput)
        setSideChatAttachments(validated.sideChatAttachments)
        setReviewTabState(validated.review)
      } else {
        /* No saved state — force defaults */
        setWorkbenchPanelState(createDefaultWorkbenchTabsState())
        setSideChatInput('')
        setSideChatAttachments([])
        setReviewTabState(createDefaultReviewTabUiState())
      }
    } else {
      /* Quick-chat — force defaults */
      setWorkbenchPanelState(createDefaultWorkbenchTabsState())
      setSideChatInput('')
      setSideChatAttachments([])
      setReviewTabState(createDefaultReviewTabUiState())
    }
  }, [sessionId])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      const currentSessionId = sessionId
      if (currentSessionId) {
        saveConversationUiState(currentSessionId, uiSnapshotRef.current)
      }
      if (hasDirtyFileDocuments()) {
        void saveAllFileDocuments()
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sessionId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.repeat) return
      const key = event.key.toLowerCase()
      if (!event.shiftKey && !event.altKey && key === 'b') {
        event.preventDefault()
        toggleSidebarCollapsed()
      } else if (!event.shiftKey && !event.altKey && key === 'j') {
        event.preventDefault()
        togglePanel('right')
      } else if (!event.shiftKey && !event.altKey && key === 't') {
        event.preventDefault()
        handleOpenBrowser()
      } else if (event.shiftKey && !event.altKey && key === 'e') {
        event.preventDefault()
        handleOpenFilesDock()
      } else if (event.shiftKey && !event.altKey && key === 'g') {
        event.preventDefault()
        handleOpenReview()
      } else if (!event.shiftKey && event.altKey && key === 's') {
        event.preventDefault()
        handleOpenSideChat()
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'BracketLeft'
      ) {
        event.preventDefault()
        navigateBack()
      } else if (
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'BracketRight'
      ) {
        event.preventDefault()
        navigateForward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    handleOpenBrowser,
    handleOpenFilesDock,
    handleOpenReview,
    handleOpenSideChat,
    navigateBack,
    navigateForward,
    togglePanel,
    toggleSidebarCollapsed,
  ])

  useEffect(() => {
    const preventMouseNavigationDefault = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      event.stopPropagation()
    }
    const handleMouseNavigation = (event: MouseEvent): void => {
      preventMouseNavigationDefault(event)
      if (event.button === 3) {
        navigateBack()
      } else if (event.button === 4) {
        navigateForward()
      }
    }

    window.addEventListener('mousedown', preventMouseNavigationDefault, true)
    window.addEventListener('mouseup', handleMouseNavigation, true)
    window.addEventListener('auxclick', preventMouseNavigationDefault, true)
    return () => {
      window.removeEventListener('mousedown', preventMouseNavigationDefault, true)
      window.removeEventListener('mouseup', handleMouseNavigation, true)
      window.removeEventListener('auxclick', preventMouseNavigationDefault, true)
    }
  }, [navigateBack, navigateForward])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const action = resolveSidebarEscapeAction({
        defaultPrevented: event.defaultPrevented,
        isDialogOpen: hasOpenDialog(),
        isSettingsRoute,
        isTextEntry: isTextEntryTarget(event.target),
        mode: sidebarShell.mode,
      })
      if (action === 'none') return
      event.preventDefault()
      handleSettingsBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    handleSettingsBack,
    isSettingsRoute,
    sidebarShell.mode,
  ])

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
      if (action === 'toggleBottomPanel') {
        togglePanel('bottom')
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
        togglePanel('right')
        return
      }
      if (action === 'reloadBrowserPage') {
        handleReloadBrowser()
        return
      }
      if (action === 'back') {
        navigateBack()
        return
      }
      if (action === 'forward') {
        navigateForward()
        return
      }
    },
    [
      handleOpenBrowser,
      handleOpenFilesDock,
      handleReloadBrowser,
      navigateBack,
      navigateForward,
      togglePanel,
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
  const openedProviderCatalogsRef = useRef<Set<ModelProviderID>>(new Set())
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
                modelMetadata: {
                  ...current.modelMetadata,
                  ...result.modelMetadata,
                },
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
      openedProviderCatalogsRef.current.clear()
      fetchedModelCatalogKeysRef.current.clear()
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
      if (sessionId && messages.length > 0) {
        setNoticeMessage('在对话过程中切换模型会降低性能表现')
      }
      void desktopClient
        .saveModelProvider({
          providerID,
          id: preset.value,
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
      messages.length,
      providerModelOptions,
      providerState,
      sessionId,
      setModel,
      setProviderBaseURL,
      setProviderID,
      setSelectedModelPreset,
    ],
  )

  const handlePermissionChange = useCallback(
    (value: DesktopPermissionMode): void => {
      if (!sessionId) {
        setPermissionMode(value)
        return
      }
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
      // Pareto/Fusion 仍是 Browser Mock 的本地能力；真实 Agent Thread 暂不提交该设置。
      if (!sessionId?.startsWith('browser-mock-')) return
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

  const handleProviderOpen = useCallback(
    (providerID: ModelProviderID): void => {
      if (openedProviderCatalogsRef.current.has(providerID)) return
      openedProviderCatalogsRef.current.add(providerID)
      void desktopClient.fetchProviderModels({ providerID, limit: 100 })
        .then(result => {
          setModelProviders(current => current.map(provider =>
            provider.providerID === providerID
              ? {
                  ...provider,
                  defaultModels: result.models,
                  modelMetadata: {
                    ...provider.modelMetadata,
                    ...result.modelMetadata,
                  },
                }
              : provider,
          ))
        })
        .catch(error => {
          openedProviderCatalogsRef.current.delete(providerID)
          setErrorMessage(error instanceof Error ? error.message : String(error))
        })
    },
    [setModelProviders],
  )

  const handleProviderSearch = useCallback(
    (providerID: ModelProviderID, query: string): void => {
      void desktopClient.fetchProviderModels({ providerID, query, limit: 100 })
        .then(result => {
          setModelProviders(current => current.map(provider =>
            provider.providerID === providerID
              ? {
                  ...provider,
                  defaultModels: result.models,
                  modelMetadata: result.modelMetadata,
                }
              : provider,
          ))
        })
        .catch(error => setErrorMessage(error instanceof Error ? error.message : String(error)))
    },
    [setModelProviders],
  )

  const handleArchiveSessions = useCallback(
    async (targetSessionIds: readonly string[]) => {
      const result = await archiveSessions(targetSessionIds)
      if (result.succeededSessionIds.length > 0) {
        setArchiveNoticeVisible(true)
        const archivedIds = new Set(result.succeededSessionIds)
        setSidebarSessionPins(current =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([targetSessionId]) => !archivedIds.has(targetSessionId),
            ),
          ),
        )
      }
      if (!result.succeededSessionIds.includes(routedSessionId ?? '')) {
        return result
      }
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
      return result
    },
    [
      archiveSessions,
      navigate,
      refreshWorkspace,
      routedSessionId,
      setDiffState,
      setSelectedFile,
      setWorkspaceState,
      setSidebarSessionPins,
    ],
  )

  const isConversationLoading =
    isConversationRoute && (!sessionsHydrated || sessionId !== routedSessionId)
  const branchName = getDesktopComposerBranchName(currentWorkspace)

  const search = useDesktopSearch({
    query: searchQuery,
    recentWorkspaces,
    sessions,
  })
  const activeSessionFallbackTitle = useMemo(
    () => {
      const workflowTitleEvents = deriveWorkflowSessionState(
        workflowEvents,
        sessionId,
      ).events
      const titleEvents =
        (sessionStatus === 'running' || sessionStatus === 'waiting') &&
        events.length > 0
          ? events
          : workflowTitleEvents.length > 0
            ? workflowTitleEvents
            : events
      return sessionViewFallbackTitle({ events: titleEvents, messages })
    },
    [events, messages, sessionId, sessionStatus, workflowEvents],
  )
  const quickChatSessionTitle = activeSessionItem
    ? sessionDisplayTitle(activeSessionItem, activeSessionFallbackTitle)
    : activeSessionFallbackTitle
  const sidebarSessionFallbackTitles = useMemo(() => {
    if (!sessionId || !activeSessionFallbackTitle) return sessionFallbackTitles
    if (sessionFallbackTitles[sessionId] === activeSessionFallbackTitle) {
      return sessionFallbackTitles
    }
    return {
      ...sessionFallbackTitles,
      [sessionId]: activeSessionFallbackTitle,
    }
  }, [activeSessionFallbackTitle, sessionFallbackTitles, sessionId])
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
      sidebarCollapsed={sidebarShell.mode !== 'docked'}
      isMaximized={isWindowMaximized}
      canNavigateBack={canNavigateBack}
      canNavigateForward={canNavigateForward}
      onToggleSidebar={toggleSidebarCollapsed}
      onSidebarTriggerPointerEnter={sidebarShell.onTriggerPointerEnter}
      onSidebarTriggerPointerLeave={sidebarShell.onTriggerPointerLeave}
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

  const appSidebarContent = (
    <DesktopSidebar
      activeSessionId={sessionId}
      catalogStatus={catalogStatus}
      pendingPermissionSessionIds={pendingPermissionSessionIds}
      recentWorkspaces={recentWorkspaces}
      removedWorkspaces={removedWorkspaces}
      sessionFallbackTitles={sidebarSessionFallbackTitles}
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
      onArchiveSessions={handleArchiveSessions}
      onRenameSession={async (targetSessionId, title) =>
        Boolean(await renameSession(targetSessionId, title))
      }
      onReport={setNoticeMessage}
    />
  )

  const settingsSidebarContent = (
    <Suspense fallback={null}>
      <SettingsSidebarContent
        activeTab={settingsActiveTab}
        onBack={handleSettingsBack}
        onTabChange={handleSettingsTabChange}
      />
    </Suspense>
  )

  const handleFollowUpEdit = useCallback(
    async (followUpId: string, value: DesktopUserMessageInput): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.updateQueuedFollowUp(sessionId, followUpId, value)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpRemove = useCallback(
    async (followUpId: string): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.removeQueuedFollowUp(sessionId, followUpId)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpSteer = useCallback(
    async (followUpId: string): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.sendQueuedFollowUpNow(sessionId, followUpId)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpReorder = useCallback(
    async (followUpIds: string[]): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.reorderQueuedFollowUps(sessionId, followUpIds)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpResume = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await desktopClient.resumeQueuedFollowUps(sessionId)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const sidebar = (
    <SidebarFrame
      collapsed={sidebarCollapsed}
      contentKind={isSettingsRoute ? 'settings' : 'tasks'}
      maxWidth={sidebarMaxWidth}
      minWidth={sidebarMinWidth}
      width={sidebarWidth}
      onCollapse={collapseSidebar}
      onSetWidth={setSidebarWidth}
      shell={sidebarShell}
    >
      {isSettingsRoute ? settingsSidebarContent : appSidebarContent}
    </SidebarFrame>
  )

  const composerProps: DesktopComposerProps | null =
    isQuickChatPage || isConversationRoute
      ? {
          input,
          messages,
          placement: isQuickChatPage ? 'new-session' : 'thread',
          draftKey: mainComposerDraftKey,
          routedSessionId,
          sessionStatus,
          permissionMode: effectivePermissionMode,
          planModeActive,
          localRouterMode: effectiveLocalRouterMode,
          enableParetoCodeRouter:
            localRouterAvailable && (enableParetoCodeRouter ?? false),
          enableFusionRouter:
            localRouterAvailable && (enableFusionRouter ?? false),
          enableAutoReviewPermissionMode:
            enableAutoReviewPermissionMode ?? false,
          enableFullAccessPermissionMode:
            enableFullAccessPermissionMode ?? false,
          planExecutionModel,
          thinkingMode,
          selectedProviderID,
          selectedModelPreset: resolvedSelectedModelPreset,
          modelConfigured,
          modelCatalogLoading,
          modelConfigurationMessage,
          selectedModelMetadata,
          showThinkingOptions,
          deepSeekThinkingControls,
          debugMode: menubarDebugMode,
          showContextUsage,
          contextUsage,
          modelPresets: selectedProviderModelPresets,
          providerOptions: providerModelOptions,
          recentWorkspaces,
          workspace: currentWorkspace,
          attachments: composerAttachments,
          onAttachmentsChange: setComposerAttachments,
          onAppendAttachmentsForDraft: appendComposerAttachmentsForDraft,
          onRemoveAttachmentForDraft: removeComposerAttachmentForDraft,
          onDraftAccepted: clearComposerDraftIfUnchanged,
          onChooseWorkspace: handleChooseWorkspace,
          onInputChange: setInput,
          onInterrupt: interrupt,
          onProviderModelChange: handleProviderModelChange,
          onProviderOpen: handleProviderOpen,
          onProviderSearch: handleProviderSearch,
          onOpenWorkspace: handleOpenRecentWorkspace,
          onCloneGithub: () => setGithubRepositoryModalOpen(true),
          onClearWorkspace: handleClearWorkspace,
          onOpenBrowser: handleOpenBrowser,
          onBranchSelect: handleBranchSelect,
          onCreateBranch: handleCreateBranch,
          onStartReview: handleStartAiReview,
          onPermissionChange: handlePermissionChange,
          onPlanModeChange: handlePlanModeChange,
          onLocalRouterModeChange: handleLocalRouterModeChange,
          onThinkingChange: setThinkingMode,
          createSessionForWorkspace,
          submitToSession,
          queuedFollowUps,
          queuePauseReason,
          onFollowUpEdit: (followUpId, value) =>
            void handleFollowUpEdit(followUpId, value),
          onFollowUpRemove: followUpId =>
            void handleFollowUpRemove(followUpId),
          onFollowUpSendNow: followUpId =>
            void handleFollowUpSteer(followUpId),
          onFollowUpReorder: followUpIds =>
            void handleFollowUpReorder(followUpIds),
          onFollowUpResume: () => void handleFollowUpResume(),
        }
      : null
  const sideChatComposer =
    isQuickChatPage || isConversationRoute ? (
      <DesktopComposer
        input={sideChatInput}
        messages={messages}
        placement="side-task"
        draftKey={sideComposerDraftKey}
        routedSessionId={
          selectedSubagent?.task.childThreadId ?? activeSessionItem?.id ?? null
        }
        sessionStatus={sessionStatus}
        permissionMode={selectedSubagentTaskId ? subagentPermissionMode : effectivePermissionMode}
        planModeActive={selectedSubagentTaskId ? false : planModeActive}
        localRouterMode={effectiveLocalRouterMode}
        enableParetoCodeRouter={localRouterAvailable && (enableParetoCodeRouter ?? false)}
        enableFusionRouter={localRouterAvailable && (enableFusionRouter ?? false)}
        enableAutoReviewPermissionMode={selectedSubagentTaskId ? selectedSubagent?.task.permissionCeiling.approvalsReviewer === 'auto_review' : enableAutoReviewPermissionMode ?? false}
        enableFullAccessPermissionMode={selectedSubagentTaskId ? selectedSubagent?.task.permissionCeiling.sandboxMode === 'danger-full-access' : enableFullAccessPermissionMode ?? false}
        planExecutionModel={planExecutionModel}
        thinkingMode={thinkingMode}
        selectedProviderID={selectedProviderID}
        selectedModelPreset={resolvedSelectedModelPreset}
        modelConfigured={modelConfigured}
        modelCatalogLoading={modelCatalogLoading}
        modelConfigurationMessage={modelConfigurationMessage}
        selectedModelMetadata={selectedModelMetadata}
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
        onAppendAttachmentsForDraft={appendSideComposerAttachmentsForDraft}
        onRemoveAttachmentForDraft={removeSideComposerAttachmentForDraft}
        onDraftAccepted={clearSideComposerDraftIfUnchanged}
        onChooseWorkspace={handleChooseWorkspace}
        onInputChange={setSideChatInput}
        onInterrupt={selectedSubagentTaskId && desktopClient.stopSubagent ? async () => { await desktopClient.stopSubagent!(selectedSubagentTaskId); await refreshSelectedSubagent() } : interrupt}
        onProviderModelChange={handleProviderModelChange}
        onProviderOpen={handleProviderOpen}
        onProviderSearch={handleProviderSearch}
        onOpenWorkspace={handleOpenRecentWorkspace}
        onCloneGithub={() => setGithubRepositoryModalOpen(true)}
        onClearWorkspace={handleClearWorkspace}
        onOpenBrowser={handleOpenBrowser}
        onBranchSelect={handleBranchSelect}
        onCreateBranch={handleCreateBranch}
        onStartReview={handleStartAiReview}
        onPermissionChange={selectedSubagentTaskId ? setSubagentPermissionMode : handlePermissionChange}
        onPlanModeChange={selectedSubagentTaskId ? () => {} : handlePlanModeChange}
        onLocalRouterModeChange={handleLocalRouterModeChange}
        onThinkingChange={setThinkingMode}
        createSessionForWorkspace={createSessionForWorkspace}
        submitToSession={sideChatSubmitToSession}
        subagentMode={Boolean(selectedSubagentTaskId)}
      />
    ) : null
  const subagentSideChatContent = selectedSubagent?.currentRun ? (
    <Suspense fallback={null}>
      <SubagentThreadPanel
        task={selectedSubagent.task}
        run={selectedSubagent.currentRun}
        snapshot={selectedSubagent.snapshot}
        capabilities={selectedSubagent.capabilities}
        composer={sideChatComposer}
        callbacks={{
        onStop: task => { void desktopClient.stopSubagent?.(task.id).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onRetry: task => { void desktopClient.retrySubagent?.(task.id).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onApplyWorktree: task => { void desktopClient.applySubagentWorktree?.(task.id).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onDiscardWorktree: task => { void desktopClient.discardSubagentWorktree?.(task.id).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onRestoreWorkspace: task => { void desktopClient.restoreSubagentWorkspace?.(task.id).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onOpenSubagent: item => handleOpenSubagent(item.subagentTaskId),
        onApprovalRespond: (approval, decision) => { void desktopClient.respondSubagentApproval?.(approval, decision).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        onQuestionRespond: (question, response) => { void desktopClient.respondSubagentQuestion?.(question.id, response.answer, response.ignored).then(refreshSelectedSubagent).catch(error => setErrorMessage(error instanceof Error ? error.message : String(error))) },
        }}
      />
    </Suspense>
  ) : selectedSubagentTaskId ? <div className="right-dock-empty-state">正在加载子 Agent...</div> : undefined
  const desktopWorkspaceRef = useRef<HTMLDivElement>(null)
  const rightDockPanelRef = useRef<HTMLDivElement>(null)
  const handlePreviewRightDockWidth = useCallback((width: number): void => {
    if (rightDockPanelRef.current) {
      rightDockPanelRef.current.style.width = `${width}px`
    }
    desktopWorkspaceRef.current?.style.setProperty(
      '--workspace-right-panel-live-width',
      `${width}px`,
    )
  }, [])

  const planContentByEventId = useMemo(() => {
    const result: Record<string, string> = {}
    for (const event of events) {
      if (event.type !== 'proposed_plan') continue
      const content = event.content?.trim()
      if (content) result[event.id] = content
    }
    return result
  }, [events])
  const rightDockPlanEventId = useMemo(() => {
    for (const target of ['right', 'bottom'] as const) {
      const panel = workbenchPanelState[target]
      if (!panel.open || !panel.activeTabId) continue
      const tab = workbenchPanelState.tabsById[panel.activeTabId]
      if (tab?.kind === 'plan') return tab.eventId
    }
    return null
  }, [workbenchPanelState])

  const handledFileLoadErrorsRef = useRef(new WeakSet<Error>())
  const handleFileLoadError = useCallback(
    ({
      error,
      phase,
      tab,
      target,
    }: WorkbenchFileLoadErrorEvent): void => {
      if (handledFileLoadErrorsRef.current.has(error)) return
      handledFileLoadErrorsRef.current.add(error)
      if (phase === 'initial' && shouldFallbackToExternalOpen(error)) {
        const resolved = resolveWorkspaceFileReference(
          tab.workspacePath,
          tab.relativePath,
        )
        if (!resolved) {
          setErrorMessage('无法打开文件')
          return
        }
        closePanelTab(target, tab.id)
        void openPathWithPreferredExternalTarget(resolved.absolutePath).catch(
          () => setErrorMessage('无法打开文件'),
        )
        return
      }
      setErrorMessage('无法打开文件')
    },
    [closePanelTab, setErrorMessage],
  )

  const retryExistingFileTab = useCallback(
    (tabId: WorkbenchTabId): void => {
      const tab = workbenchPanelState.tabsById[tabId]
      if (tab?.kind !== 'file-preview') return
      const target = workbenchPanelState.right.tabIds.includes(tabId)
        ? 'right'
        : workbenchPanelState.bottom.tabIds.includes(tabId)
          ? 'bottom'
          : null
      if (!target) return
      void prefetchFileDocument(tab.workspacePath, tab.relativePath).catch(
        error =>
          handleFileLoadError({
            error:
              error instanceof Error ? error : new Error(String(error)),
            phase: 'initial',
            tab,
            target,
          }),
      )
    },
    [handleFileLoadError, workbenchPanelState],
  )

  const handleOpenFilePreview = useCallback(
    (target: WorkbenchPanelTarget, file: DesktopFileEntry): void => {
      if (file.type !== 'file' || !currentWorkspace) return
      const tabId = createFilePreviewTabId(currentWorkspace.path, file.path)
      retryExistingFileTab(tabId)
      openPanelTab(target, {
        id: tabId,
        kind: 'file-preview',
        workspacePath: currentWorkspace.path,
        relativePath: file.path,
        preview: true,
      })
    },
    [currentWorkspace, openPanelTab, retryExistingFileTab],
  )

  const handleOpenFileFromBrowser = useCallback(
    (target: WorkbenchPanelTarget, file: DesktopFileEntry): void => {
      if (file.type !== 'file' || !currentWorkspace) return
      const workspacePath = currentWorkspace.path
      const tabId = createFilePreviewTabId(workspacePath, file.path)
      retryExistingFileTab(tabId)
      openPanelTab(target, {
        id: tabId,
        kind: 'file-preview',
        workspacePath,
        relativePath: file.path,
        preview: false,
      })
      closePanelTab(target, 'file-browser')
    },
    [
      closePanelTab,
      currentWorkspace,
      openPanelTab,
      retryExistingFileTab,
    ],
  )

  const handleOpenMarkdownFileReference = useCallback(
    (
      reference: MarkdownFileReference,
      options: MarkdownFileOpenOptions,
    ): void => {
      if (!currentWorkspace) return
      const resolved = resolveWorkspaceFileReference(
        currentWorkspace.path,
        reference.path,
      )
      if (!resolved) {
        // Not a workspace path — open with system
        if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(reference.path)) {
          void openPathWithPreferredExternalTarget(reference.path).catch(
            error => {
              setErrorMessage(
                error instanceof Error ? error.message : String(error),
              )
            },
          )
        }
        return
      }

      // Workspace root directory — open file-browser tab
      if (resolved.relativePath === '.') {
        directoryProbeRequestId += 1
        openPanelTab('right', {
          id: 'file-browser',
          kind: 'file-browser',
          directoryPath: undefined,
          revealToken: directoryProbeRequestId,
        })
        return
      }

      // Check if it's a known directory from workspaceFiles (root-level entries)
      const isKnownDirectory = workspaceFiles.some(
        file =>
          file.type === 'directory' &&
          normalizePathForCompare(file.path) ===
            normalizePathForCompare(resolved.relativePath),
      )
      if (isKnownDirectory) {
        directoryProbeRequestId += 1
        openPanelTab('right', {
          id: 'file-browser',
          kind: 'file-browser',
          directoryPath: resolved.relativePath,
          revealToken: directoryProbeRequestId,
        })
        return
      }

      // Asynchronously probe unknown paths to determine if directory or file
      const probeRequestId = ++directoryProbeRequestId
      desktopClient
        .listWorkspaceFiles(currentWorkspace.path, resolved.relativePath)
        .then(() => {
          // Probe succeeded → it's a directory
          if (directoryProbeRequestId === probeRequestId) {
            openPanelTab('right', {
              id: 'file-browser',
              kind: 'file-browser',
              directoryPath: resolved.relativePath,
              revealToken: probeRequestId,
            })
          }
        })
        .catch(() => {
          // Probe failed → it's a file (or doesn't exist)
          if (directoryProbeRequestId !== probeRequestId) return

          // External file types still open with system
          if (shouldOpenFileExternally(reference.path)) {
            void openPathWithPreferredExternalTarget(
              resolved.absolutePath,
            ).catch(error => {
              setErrorMessage(
                error instanceof Error ? error.message : String(error),
              )
            })
            return
          }

          // Open as file-preview tab
          const tabId = createFilePreviewTabId(
            currentWorkspace.path,
            resolved.relativePath,
          )
          retryExistingFileTab(tabId)
          openPanelTab('right', {
            id: tabId,
            kind: 'file-preview',
            workspacePath: currentWorkspace.path,
            relativePath: resolved.relativePath,
            preview: options.preview,
            ...(reference.line ? { line: reference.line } : {}),
            ...(reference.column ? { column: reference.column } : {}),
            ...(reference.endLine ? { endLine: reference.endLine } : {}),
            ...(reference.endColumn ? { endColumn: reference.endColumn } : {}),
          })
        })
    },
    [
      currentWorkspace,
      openPanelTab,
      retryExistingFileTab,
      workspaceFiles,
    ],
  )

  const canCopyMarkdownFileReferenceContents = useCallback(
    (reference: MarkdownFileReference): boolean => {
      if (!currentWorkspace || shouldOpenFileExternally(reference.path)) {
        return false
      }
      const resolved = resolveWorkspaceFileReference(
        currentWorkspace.path,
        reference.path,
      )
      return resolved !== null && resolved.relativePath !== '.'
    },
    [currentWorkspace],
  )

  const handleCopyMarkdownFileReferenceContents = useCallback(
    async (reference: MarkdownFileReference): Promise<void> => {
      if (!currentWorkspace || shouldOpenFileExternally(reference.path)) return
      const resolved = resolveWorkspaceFileReference(
        currentWorkspace.path,
        reference.path,
      )
      if (!resolved) return
      try {
        const document = await prefetchFileDocument(
          currentWorkspace.path,
          resolved.relativePath,
        )
        await navigator.clipboard.writeText(document.draftContent)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [currentWorkspace],
  )

  const handleSelectPanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      selectPanelTab(target, tabId)
      retryExistingFileTab(tabId)
    },
    [retryExistingFileTab, selectPanelTab],
  )

  const saveTabsBeforeClose = useCallback(
    async (tabIds: readonly WorkbenchTabId[]): Promise<boolean> => {
      for (const tabId of tabIds) {
        const tab = workbenchPanelState.tabsById[tabId]
        if (tab?.kind !== 'file-preview') continue
        if (!(await saveFileDocument(tab.workspacePath, tab.relativePath))) {
          setErrorMessage(`无法关闭 ${tab.relativePath}：文件尚未保存。`)
          return false
        }
      }
      return true
    },
    [workbenchPanelState.tabsById],
  )

  const renderWorkbenchPanel = (
    target: WorkbenchPanelTarget,
  ): React.ReactNode => {
    const state =
      target === 'right' ? rightDockState : bottomPanelState
    if (!state.open) return null
    return (
    <WorkbenchPanel
      target={target}
      state={state}
      tabsById={workbenchPanelState.tabsById}
      browserState={browserState}
      debugMode={menubarDebugMode}
      defaultBranch={derivedDefaultBranch}
      files={workspaceFiles}
      gitStatus={gitStatus}
      isRefreshingReview={false}
      diffMarkerStyle={diffMarkerStyle}
      maxWidth={Math.max(
        RIGHT_DOCK_MIN_WIDTH,
        window.innerWidth - RIGHT_DOCK_MAIN_MIN_WIDTH,
      )}
      minWidth={RIGHT_DOCK_MIN_WIDTH}
      reviewView={reviewView}
      reviewTabState={reviewTabState}
      planContentByEventId={planContentByEventId}
      selectedFile={selectedFile}
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      width={rightDockWidth}
      height={bottomPanelHeight}
      rightFullWidth={workbenchPanelState.rightFullWidth}
      workspace={currentWorkspace}
      onAppendBrowserAnnotation={handleBrowserAnnotation}
      onAppendComposerText={handleAppendComposerText}
      onAddComposerFiles={handleAddComposerFiles}
      onBrowserStateChange={setBrowserState}
      onClose={() => {
        void saveTabsBeforeClose(state.tabIds).then(saved => {
          if (saved) closePanel(target)
        })
      }}
      onCloseTab={tabId => {
        void saveTabsBeforeClose([tabId]).then(saved => {
          if (saved) closePanelTab(target, tabId)
        })
      }}
      onCloseOtherTabs={tabId => {
        const closing = state.tabIds.filter(id => id !== tabId)
        void saveTabsBeforeClose(closing).then(saved => {
          if (saved) closeOtherTabs(target, tabId)
        })
      }}
      onCloseTabsToRight={tabId => {
        const index = state.tabIds.indexOf(tabId)
        const closing = index < 0 ? [] : state.tabIds.slice(index + 1)
        void saveTabsBeforeClose(closing).then(saved => {
          if (saved) closeTabsToRight(target, tabId)
        })
      }}
      onCreateBranch={handleCreateBranch}
      onFileLoadError={handleFileLoadError}
      onOpenTab={tab => {
        if (tab.kind === 'browser') {
          void desktopClient
            .openBrowser()
            .then(setBrowserState)
            .catch(error =>
              setErrorMessage(error instanceof Error ? error.message : String(error)),
            )
        }
        openPanelTab(target, tab)
      }}
      onOpenWorkspacePath={handleOpenWorkspacePath}
      onOpenFileFromBrowser={file =>
        handleOpenFileFromBrowser(target, file)
      }
      onPreviewFile={file => handleOpenFilePreview(target, file)}
      onRefreshReview={handleRefreshDiff}
      onReviewTabStateChange={setReviewTabState}
      onResetHeight={handleResetBottomPanelHeight}
      onResetWidth={handleResetRightDockWidth}
      onResizePreviewWidth={
        target === 'right' ? handlePreviewRightDockWidth : undefined
      }
      onSelectTab={tabId => handleSelectPanelTab(target, tabId)}
      onMoveTab={movePanelTab}
      onReorderTab={reorderPanelTab}
      onPinTab={pinTab}
      onSetFileMarkdownViewMode={setFileMarkdownViewMode}
      onSetHeight={handleSetBottomPanelHeight}
      onSetWidth={handleSetRightDockWidth}
      onToggleRightFullWidth={toggleRightFullWidth}
      onToggleReviewView={() =>
        setReviewView(reviewView === 'inline' ? 'split' : 'inline')
      }
      sideChatComposer={sideChatComposer}
      sideChatFocusVersion={sideChatFocusVersion}
      activeSideTaskId={activeSideTaskId}
      sideTaskContent={subagentSideChatContent}
    />
    )
  }

  const rightDockNode = renderWorkbenchPanel('right')
  const bottomPanelNode = renderWorkbenchPanel('bottom')

  return (
    <div className="desktop-frame tw:min-h-0 tw:w-full tw:overflow-hidden tw:bg-app-canvas tw:text-app-text">
      <GlobalErrorModal
        message={errorMessage}
        onDismiss={() => {
          if (errorMessage) {
            setErrorMessage(null)
            return
          }
          setRuntimeWarningDismissed(true)
        }}
      />
      <GlobalErrorModal
        message={noticeMessage}
        tone="status"
        onDismiss={() => setNoticeMessage(null)}
      />
      {gitWorkflowMode ? <Suspense fallback={null}><GitWorkflowModal
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
      /></Suspense> : null}
      {githubRepositoryModalOpen ? <Suspense fallback={null}><GithubRepositoryModal
        open={githubRepositoryModalOpen}
        onClose={() => setGithubRepositoryModalOpen(false)}
        onError={message => setErrorMessage(message)}
        onWorkspaceCloned={handleGithubWorkspaceCloned}
      /></Suspense> : null}
      {archiveNoticeVisible ? (
        <ArchiveConversationNotice
          onClose={() => setArchiveNoticeVisible(false)}
          onOpenSettings={() => {
            setArchiveNoticeVisible(false)
            navigate('/settings/archived')
          }}
        />
      ) : null}

      <WorkbenchShellView
        menuBar={menuBar}
        sidebar={sidebar}
        debugMode={menubarDebugMode}
        appBodyRef={sidebarShell.appBodyRef}
      >
        <QuickChatContext.Provider
            value={{
            isConversationRoute,
            isConversationLoading,
            sidebarCollapsed: sidebarShell.mode === 'collapsed',
            activeSessionId: activeSessionItem?.id ?? null,
            activeSessionPinnedAt: activeSessionItem
              ? sidebarSessionPins[activeSessionItem.id] ?? null
              : null,
            sessionTitle: quickChatSessionTitle,
            workspaceName: currentWorkspace?.name ?? null,
            workspacePath: currentWorkspace?.path ?? null,
            branchName,
            branches: currentWorkspace?.branches ?? EMPTY_BRANCHES,
            diff: workspace.diff,
            gitStatus,
            recentWorkspaces,
            onArchiveSession: () => {
              if (!activeSessionItem) return
              void handleArchiveSessions([activeSessionItem.id])
            },
            onCreateBranch: handleCreateBranch,
            onOpenAutomation: () => navigate('/automations'),
            onOpenWorkspacePath: handleOpenWorkspacePath,
            onOpenRightDock: () =>
              openRightDockTab({ id: 'review', kind: 'review' }),
            onOpenPlanInRightDock: handleOpenPlanDock,
            canCopyFileReferenceContents:
              canCopyMarkdownFileReferenceContents,
            onCopyFileReferenceContents:
              handleCopyMarkdownFileReferenceContents,
            onOpenFileReference: handleOpenMarkdownFileReference,
            onSubmitEditedUserMessage: handleSubmitEditedUserMessage,
            onAppendComposerText: handleAppendComposerText,
            onAppendSideChatText: handleAppendSideChatText,
            onOpenSubagent: handleOpenSubagent,
            onAddComposerFiles: handleAddComposerFiles,
            onRefreshDiff: handleRefreshDiff,
            onToggleSidebar: toggleSidebarCollapsed,
            onToggleSessionPinned: () => {
              if (!activeSessionItem) return
              setSidebarSessionPins(current => {
                if (current[activeSessionItem.id]) {
                  const { [activeSessionItem.id]: _removed, ...next } = current
                  return next
                }
                return {
                  ...current,
                  [activeSessionItem.id]: new Date().toISOString(),
                }
              })
            },
            onCommitOrPush: handleCommitOrPush,
            onCreatePullRequest: handleCreatePullRequest,
            onChooseWorkspace: handleChooseWorkspace,
            onCloneGithub: () => setGithubRepositoryModalOpen(true),
            onOpenWorkspace: handleOpenRecentWorkspace,
            onBranchSelect: handleBranchSelect,
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
            permissionMode: effectivePermissionMode,
            planModeActive,
            providerModelOptions,
            events: isQuickChatPage || isConversationLoading ? [] : events,
            workflowEvents:
              isQuickChatPage || isConversationLoading ? [] : workflowEvents,
            messages: isQuickChatPage || isConversationLoading ? [] : messages,
            pendingPermissions:
              isQuickChatPage || isConversationLoading ? [] : pendingPermissions,
            sessionStatus,
            composerProps: isConversationLoading ? null : composerProps,
            composerDraft: {
              value: input,
              replace: setInput,
            },
            bottomPanelVisible,
            onToggleBottomPanel: toggleBottomPanelVisible,
            rightDockPlanEventId,
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
              <WorkspaceHeaderProvider routeScope={location.pathname}>
                <div
                  ref={desktopWorkspaceRef}
                  className="desktop-workspace"
                  style={
                    {
                      '--sidebar-w': sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
                      '--workspace-right-panel-live-width': rightDockState.open
                        ? workbenchPanelState.rightFullWidth
                          ? '100%'
                          : `${rightDockWidth}px`
                        : '0px',
                    } as React.CSSProperties
                  }
                >
                  <DesktopWorkspaceHeader
                    fullWidth={workbenchPanelState.rightFullWidth}
                    rightDockOpen={rightDockState.open}
                    shellControls={
                      <WorkspaceShellControls
                        rightDockState={rightDockState}
                        bottomPanelVisible={bottomPanelVisible}
                        showBottomPanel={isQuickChatPage || isConversationRoute}
                        showRightPanel={
                          isQuickChatPage ||
                          isConversationRoute
                        }
                        onToggleBottomPanel={toggleBottomPanelVisible}
                        onToggleRightPanel={() => togglePanel('right')}
                      />
                    }
                  />
                  <div className="desktop-workspace__upper">
                    <div
                      className="desktop-main-route"
                      style={
                        {
                          flexBasis: workbenchPanelState.rightFullWidth ? 0 : undefined,
                          width: workbenchPanelState.rightFullWidth ? 0 : undefined,
                        } as React.CSSProperties
                      }
                    >
                      <div aria-hidden="true" className="desktop-main-route__header-spacer" />
                      <div className="desktop-main-route__body">
                        <Outlet />
                      </div>
                    </div>
                    {rightDockNode ? (
                      <div
                        ref={rightDockPanelRef}
                        className={
                          workbenchPanelState.rightFullWidth
                            ? 'desktop-workspace-panel desktop-workspace-panel--right full-width'
                            : 'desktop-workspace-panel desktop-workspace-panel--right'
                        }
                        style={{
                          width: workbenchPanelState.rightFullWidth
                            ? '100%'
                            : `${rightDockWidth}px`,
                        }}
                      >
                        {rightDockNode}
                      </div>
                    ) : null}
                  </div>
                  {bottomPanelNode ? (
                    <div
                      className="desktop-workspace-panel desktop-workspace-panel--bottom"
                      style={{ height: `${bottomPanelHeight}px` }}
                    >
                      {bottomPanelNode}
                    </div>
                  ) : null}
                </div>
              </WorkspaceHeaderProvider>
            </SearchContext.Provider>
          </QuickChatContext.Provider>
      </WorkbenchShellView>
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
