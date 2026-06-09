import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type {
  DesktopAgentEvent,
  DesktopAuthStatus,
  DesktopFileEntry,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopRuntimeStatus,
  DesktopSessionStatus,
  DesktopThinkingMode,
  DesktopUiCommand,
  DesktopWorkspace,
} from '../shared/types.js'
import {
  CUSTOM_MODEL_PRESET_ID,
  DEFAULT_MODEL_PRESET_ID,
  MODEL_PRESETS,
  resolveModelPresetId,
} from './modelPresets.js'
import { AutomationView } from './components/AutomationView.js'
import { ComposerCard } from './components/ComposerCard.js'
import { ContextStrip } from './components/ContextStrip.js'
import { DesktopShell } from './components/DesktopShell.js'
import { DesktopSidebar } from './components/DesktopSidebar.js'
import { MenuBar } from './components/MenuBar.js'
import { PluginsView } from './components/PluginsView.js'
import { QuickChatView } from './components/QuickChatView.js'
import { RightDrawer } from './components/RightDrawer.js'
import { SearchView } from './components/SearchView.js'
import type {
  AppView,
  DrawerTab,
  Message,
  SessionListItem,
  SessionViewState,
  ToolLogEntry,
} from './uiTypes.js'

const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode
  label: string
  detail: string
}> = [
  {
    value: 'default',
    label: '自动审查',
    detail: '编辑和高风险工具会按原有规则请求确认。',
  },
  {
    value: 'acceptEdits',
    label: '允许编辑',
    detail: '默认允许文件编辑，其他高风险动作仍会确认。',
  },
  {
    value: 'plan',
    label: '规划模式',
    detail: '先分析和规划，再决定是否实施。',
  },
  {
    value: 'dontAsk',
    label: '严格拦截',
    detail: '需要额外确认的动作会被拒绝。',
  },
  {
    value: 'bypassPermissions',
    label: '免确认',
    detail: '跳过权限询问，直接执行会话内动作。',
  },
]

const THINKING_MODE_OPTIONS: Array<{
  value: DesktopThinkingMode
  label: string
}> = [
  { value: 'disabled', label: '低' },
  { value: 'default', label: '中' },
  { value: 'adaptive', label: '高' },
  { value: 'enabled', label: '超高' },
]

const DESKTOP_SETTINGS_STORAGE_KEY = 'claude-code-desktop-settings'
const SIDEBAR_WIDTH_STORAGE_KEY = 'layout.sidebarWidth'
const SIDEBAR_MIN_RATIO = 0.12
const SIDEBAR_MAX_RATIO = 0.2
const DEFAULT_SIDEBAR_WIDTH = 250
const MAX_RECENT_WORKSPACES = 5

type StoredDesktopSettings = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  activeView: AppView
  drawerTab: DrawerTab
  selectedModelPreset: string
}

declare global {
  interface Window {
    desktopApi: import('../shared/types.js').DesktopApi
  }
}

export function App(): React.ReactNode {
  const initialDesktopSettings = useMemo(() => readStoredDesktopSettings(), [])
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null)
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionViewsRef = useRef<Record<string, SessionViewState>>({})
  const sessionWorkspacesRef = useRef<Record<string, DesktopWorkspace>>({})
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [selectedFile, setSelectedFile] =
    useState<SessionViewState['selectedFile']>(null)
  const [diff, setDiff] = useState('未选择项目。')
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [permissionMode, setPermissionMode] =
    useState<DesktopPermissionMode>(initialDesktopSettings.permissionMode)
  const [model, setModel] = useState(initialDesktopSettings.model)
  const [fallbackModel, setFallbackModel] = useState(
    initialDesktopSettings.fallbackModel,
  )
  const [sessionName, setSessionName] = useState(
    initialDesktopSettings.sessionName,
  )
  const [thinkingMode, setThinkingMode] = useState<DesktopThinkingMode>(
    initialDesktopSettings.thinkingMode,
  )
  const [systemPrompt, setSystemPrompt] = useState(
    initialDesktopSettings.systemPrompt,
  )
  const [appendSystemPrompt, setAppendSystemPrompt] = useState(
    initialDesktopSettings.appendSystemPrompt,
  )
  const [additionalDirectories, setAdditionalDirectories] = useState(
    initialDesktopSettings.additionalDirectories,
  )
  const [recentWorkspaces, setRecentWorkspaces] = useState<DesktopWorkspace[]>(
    initialDesktopSettings.recentWorkspaces,
  )
  const [runtimeStatus, setRuntimeStatus] =
    useState<DesktopRuntimeStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [activeView, setActiveView] = useState<AppView>(
    initialDesktopSettings.activeView,
  )
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(
    initialDesktopSettings.drawerTab,
  )
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedModelPreset, setSelectedModelPreset] = useState(
    resolveModelPresetId(
      initialDesktopSettings.model,
      initialDesktopSettings.selectedModelPreset,
    ),
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.matchMedia('(max-width: 900px)').matches,
  )
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    readStoredSidebarWidth(window.innerWidth),
  )

  useEffect(() => {
    void runDesktopAction(() =>
      window.desktopApi.getAuthStatus().then(setAuthStatus),
    )
    void refreshRuntimeStatus()
    const unsubscribeAgent = window.desktopApi.onAgentEvent(handleAgentEvent)
    const unsubscribeUi = window.desktopApi.onUiCommand(handleUiCommand)
    return () => {
      unsubscribeAgent()
      unsubscribeUi()
    }
  }, [])

  useEffect(() => {
    function handleResize(): void {
      const nextViewportWidth = window.innerWidth
      setViewportWidth(nextViewportWidth)
      setSidebarWidthState(current =>
        clampSidebarWidth(current, nextViewportWidth),
      )
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    storeDesktopSettings({
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
    })
  }, [
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
  ])

  async function runDesktopAction<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      const result = await action()
      setErrorMessage(null)
      return result
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  function handleUiCommand(command: DesktopUiCommand): void {
    if (command === 'newConversation') {
      void handleNewConversation()
      return
    }
    if (command === 'chooseWorkspace') {
      void chooseWorkspace()
      return
    }
    if (command === 'refreshWorkspace') {
      void refreshWorkspace()
    }
  }

  function handleAgentEvent(event: DesktopAgentEvent): void {
    if (event.type === 'status') {
      setSessions(current =>
        current.map(session =>
          session.id === event.sessionId
            ? { ...session, status: event.status }
            : session,
        ),
      )
      if (event.sessionId === activeSessionIdRef.current) {
        setSessionStatus(event.status)
      }
      return
    }
    if (event.type === 'message') {
      updateSessionView(event.sessionId, view => ({
        ...view,
        messages: [
          ...view.messages.filter(message => !message.streaming),
          {
            id: crypto.randomUUID(),
            role: event.role,
            text: event.text,
          },
        ],
      }))
      return
    }
    if (event.type === 'partial_message') {
      updateSessionView(event.sessionId, view => {
        const index = view.messages.findIndex(message => message.streaming)
        const nextMessage: Message = {
          id: index >= 0 ? view.messages[index]!.id : crypto.randomUUID(),
          role: 'assistant',
          text: event.text,
          streaming: true,
        }
        if (index === -1) {
          return { ...view, messages: [...view.messages, nextMessage] }
        }
        return {
          ...view,
          messages: view.messages.map((message, messageIndex) =>
            messageIndex === index ? nextMessage : message,
          ),
        }
      })
      return
    }
    if (event.type === 'tool_start') {
      addToolLogEntry(event.sessionId, {
        toolName: event.toolName,
        summary: event.summary,
        kind: 'start',
      })
      return
    }
    if (event.type === 'tool_result') {
      addToolLogEntry(event.sessionId, {
        toolName: event.toolName,
        summary: event.summary,
        kind: 'result',
        isError: event.isError,
      })
      return
    }
    if (event.type === 'permission_request') {
      updateSessionView(event.sessionId, view => ({
        ...view,
        pendingPermissions: [event.request, ...view.pendingPermissions],
      }))
      if (event.sessionId === activeSessionIdRef.current) {
        setDrawerTab('permissions')
        setIsDrawerOpen(true)
      }
      return
    }
    if (event.type === 'diff') {
      if (event.sessionId === activeSessionIdRef.current) {
        setDiff(event.patch)
      }
      return
    }
    if (event.type === 'error') {
      if (event.sessionId === activeSessionIdRef.current) {
        setErrorMessage(event.message)
        refreshSessionWorkspace(event.sessionId)
      }
      updateSessionView(event.sessionId, view => ({
        ...view,
        pendingPermissions: [],
        messages: [
          ...view.messages.map(message =>
            message.streaming ? { ...message, streaming: false } : message,
          ),
          {
            id: crypto.randomUUID(),
            role: 'system',
            text: event.message,
          },
        ],
      }))
      return
    }
    if (event.type === 'done') {
      setSessions(current =>
        current.map(session =>
          session.id === event.sessionId
            ? { ...session, status: 'done' }
            : session,
        ),
      )
      if (event.sessionId === activeSessionIdRef.current) {
        setSessionStatus('done')
        refreshSessionWorkspace(event.sessionId)
      }
      updateSessionView(event.sessionId, view => ({
        ...view,
        pendingPermissions: [],
        messages: view.messages.map(message =>
          message.streaming ? { ...message, streaming: false } : message,
        ),
      }))
    }
  }

  async function refreshWorkspace(
    target = workspace,
    options: {
      clearErrorOnSuccess?: boolean
      clearSelectedFile?: boolean
      expectedSessionId?: string
    } = {},
  ): Promise<void> {
    if (!target) return
    try {
      const [nextContext, nextFiles, nextDiff] = await Promise.all([
        window.desktopApi.getWorkspaceContext(target.path),
        window.desktopApi.listWorkspaceFiles(target.path),
        window.desktopApi.getWorkspaceDiff(target.path),
      ])
      if (
        options.expectedSessionId &&
        options.expectedSessionId !== activeSessionIdRef.current
      ) {
        return
      }
      if (options.clearErrorOnSuccess ?? true) {
        setErrorMessage(null)
      }
      syncWorkspaceContext(nextContext, options.expectedSessionId)
      setFiles(nextFiles)
      setDiff(nextDiff.patch)
      if (options.clearSelectedFile ?? true) {
        setSelectedFile(null)
        updateActiveSessionView(view => ({ ...view, selectedFile: null }))
      } else {
        await refreshSelectedFilePreview(
          nextContext,
          nextFiles,
          options.expectedSessionId ?? activeSessionIdRef.current,
        )
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function syncWorkspaceContext(
    nextWorkspace: DesktopWorkspace,
    expectedSessionId?: string,
  ): void {
    setWorkspace(nextWorkspace)
    setRecentWorkspaces(current => upsertRecentWorkspace(current, nextWorkspace))
    if (!expectedSessionId) {
      return
    }
    sessionWorkspacesRef.current = {
      ...sessionWorkspacesRef.current,
      [expectedSessionId]: nextWorkspace,
    }
  }

  async function refreshSelectedFilePreview(
    target: DesktopWorkspace,
    nextFiles: DesktopFileEntry[],
    targetSessionId: string | null,
  ): Promise<void> {
    if (!targetSessionId || targetSessionId !== activeSessionIdRef.current) {
      return
    }
    const currentPreview =
      sessionViewsRef.current[targetSessionId]?.selectedFile
    if (!currentPreview) {
      return
    }
    const stillExists = nextFiles.some(
      file => file.type === 'file' && file.path === currentPreview.path,
    )
    if (!stillExists) {
      updateSessionView(targetSessionId, view => ({
        ...view,
        selectedFile: null,
      }))
      return
    }
    try {
      const preview = await window.desktopApi.readWorkspaceFile(
        target.path,
        currentPreview.path,
      )
      if (targetSessionId !== activeSessionIdRef.current) {
        return
      }
      updateSessionView(targetSessionId, view => ({
        ...view,
        selectedFile: preview,
      }))
    } catch {
      updateSessionView(targetSessionId, view => ({
        ...view,
        selectedFile: null,
      }))
    }
  }

  function refreshSessionWorkspace(targetSessionId: string): void {
    const target = sessionWorkspacesRef.current[targetSessionId]
    if (!target) return
    void refreshWorkspace(target, {
      clearErrorOnSuccess: false,
      clearSelectedFile: false,
      expectedSessionId: targetSessionId,
    })
  }

  function activateSession(nextSessionId: string | null): void {
    activeSessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
  }

  function createEmptySessionView(): SessionViewState {
    return {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      selectedFile: null,
    }
  }

  function applySessionView(view: SessionViewState): void {
    setMessages(view.messages)
    setToolLog(view.toolLog)
    setPendingPermissions(view.pendingPermissions)
    setSelectedFile(view.selectedFile)
  }

  function setSessionView(
    targetSessionId: string,
    view: SessionViewState,
  ): void {
    sessionViewsRef.current = {
      ...sessionViewsRef.current,
      [targetSessionId]: view,
    }
  }

  function updateSessionView(
    targetSessionId: string,
    updater: (view: SessionViewState) => SessionViewState,
  ): void {
    const nextView = updater(
      sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
    )
    setSessionView(targetSessionId, nextView)
    if (targetSessionId === activeSessionIdRef.current) {
      applySessionView(nextView)
    }
  }

  function updateActiveSessionView(
    updater: (view: SessionViewState) => SessionViewState,
  ): void {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId) return
    updateSessionView(activeSessionId, updater)
  }

  function addToolLogEntry(
    targetSessionId: string,
    entry: Omit<ToolLogEntry, 'id' | 'createdAt' | 'expanded'>,
  ): void {
    updateSessionView(targetSessionId, view => ({
      ...view,
      toolLog: [
        {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toLocaleTimeString(),
          expanded: entry.isError === true,
        },
        ...view.toolLog,
      ],
    }))
  }

  function toggleToolLogEntry(entryId: string): void {
    updateActiveSessionView(view => ({
      ...view,
      toolLog: view.toolLog.map(entry =>
        entry.id === entryId ? { ...entry, expanded: !entry.expanded } : entry,
      ),
    }))
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await runDesktopAction(() =>
      window.desktopApi.chooseWorkspace(),
    )
    if (!selected) return
    await activateWorkspace(selected)
  }

  async function openRecentWorkspace(target: DesktopWorkspace): Promise<void> {
    const selected = await runDesktopAction(() =>
      window.desktopApi.openWorkspace(target.path),
    )
    if (!selected) return
    await activateWorkspace(selected)
  }

  async function activateWorkspace(selected: DesktopWorkspace): Promise<void> {
    setActiveView('quickChat')
    syncWorkspaceContext(selected)
    await refreshWorkspace(selected)
    if (!runtimeMissing) {
      await createSessionForWorkspace(selected)
    }
  }

  async function createSessionForWorkspace(target = workspace): Promise<void> {
    if (!target) return
    if (runtimeMissing) {
      setErrorMessage('桌面端 agent 运行时缺失，请先构建 desktop agent。')
      return
    }
    const session = await runDesktopAction(() =>
      window.desktopApi.createSession({
        workspacePath: target.path,
        permissionMode,
        model: normalizeOptionalText(model),
        fallbackModel: normalizeOptionalText(fallbackModel),
        sessionName: normalizeOptionalText(sessionName),
        thinkingMode,
        systemPrompt: normalizeOptionalText(systemPrompt),
        appendSystemPrompt: normalizeOptionalText(appendSystemPrompt),
        additionalDirectories: parseAdditionalDirectories(additionalDirectories),
      }),
    )
    if (!session) return
    const nextView =
      sessionViewsRef.current[session.sessionId] ?? createEmptySessionView()
    sessionWorkspacesRef.current = {
      ...sessionWorkspacesRef.current,
      [session.sessionId]: target,
    }
    setSessionView(session.sessionId, nextView)
    activateSession(session.sessionId)
    setSessionStatus('idle')
    applySessionView(nextView)
    setActiveView('quickChat')
    setSessions(current => [
      {
        id: session.sessionId,
        sessionName: normalizeOptionalText(sessionName) ?? null,
        workspaceName: target.name,
        workspacePath: target.path,
        permissionMode,
        model: normalizeOptionalText(model) ?? null,
        fallbackModel: normalizeOptionalText(fallbackModel) ?? null,
        thinkingMode,
        hasSystemPrompt: Boolean(normalizeOptionalText(systemPrompt)),
        hasAppendSystemPrompt: Boolean(normalizeOptionalText(appendSystemPrompt)),
        additionalDirectoryCount:
          parseAdditionalDirectories(additionalDirectories).length,
        status: 'idle',
        createdAt: new Date().toLocaleTimeString(),
      },
      ...current,
    ])
  }

  async function handleNewConversation(): Promise<void> {
    setActiveView('quickChat')
    if (workspace) {
      await createSessionForWorkspace(workspace)
      return
    }
    await chooseWorkspace()
  }

  async function refreshRuntimeStatus(): Promise<void> {
    const status = await runDesktopAction(() =>
      window.desktopApi.getRuntimeStatus(),
    )
    if (status) {
      setRuntimeStatus(status)
    }
  }

  async function previewFile(file: DesktopFileEntry): Promise<void> {
    if (!workspace || file.type !== 'file') return
    const preview = await runDesktopAction(() =>
      window.desktopApi.readWorkspaceFile(workspace.path, file.path),
    )
    if (preview) {
      updateActiveSessionView(view => ({ ...view, selectedFile: preview }))
    }
  }

  async function submit(): Promise<void> {
    const trimmed = input.trim()
    const activeSessionId = sessionId
    if (!canSubmit || !activeSessionId) return
    setInput('')
    await runDesktopAction(() =>
      window.desktopApi.sendUserMessage(activeSessionId, trimmed),
    )
  }

  async function interrupt(): Promise<void> {
    if (sessionId) {
      await runDesktopAction(() => window.desktopApi.interruptSession(sessionId))
    }
  }

  function openDrawer(tab: DrawerTab): void {
    setDrawerTab(tab)
    setIsDrawerOpen(true)
  }

  function setSidebarWidth(nextWidth: number): void {
    const clamped = clampSidebarWidth(nextWidth, viewportWidth)
    setSidebarWidthState(clamped)
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped))
  }

  async function closeSession(targetSessionId: string): Promise<void> {
    const disposed = await runDesktopAction(() =>
      window.desktopApi.disposeSession(targetSessionId),
    )
    if (disposed === null) return
    const remaining = sessions.filter(session => session.id !== targetSessionId)
    const {
      [targetSessionId]: _removedSessionView,
      ...remainingSessionViews
    } = sessionViewsRef.current
    const {
      [targetSessionId]: _removedWorkspace,
      ...remainingSessionWorkspaces
    } = sessionWorkspacesRef.current
    sessionViewsRef.current = remainingSessionViews
    sessionWorkspacesRef.current = remainingSessionWorkspaces
    setSessions(remaining)

    if (targetSessionId !== activeSessionIdRef.current) {
      return
    }

    const next = remaining[0]
    activateSession(next?.id ?? null)
    setSessionStatus(next?.status ?? 'idle')
    if (next) {
      applySessionView(
        sessionViewsRef.current[next.id] ?? createEmptySessionView(),
      )
      const nextWorkspace =
        sessionWorkspacesRef.current[next.id] ?? {
          name: next.workspaceName,
          path: next.workspacePath,
        }
      setWorkspace(nextWorkspace)
      void refreshWorkspace(nextWorkspace, { expectedSessionId: next.id })
    } else {
      applySessionView(createEmptySessionView())
      setWorkspace(null)
      setFiles([])
      setDiff('未选择项目。')
    }
  }

  async function decidePermission(
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow = false,
  ): Promise<void> {
    if (!sessionId) return
    updateSessionView(sessionId, view => ({
      ...view,
      pendingPermissions: view.pendingPermissions.filter(
        item => item.requestId !== request.requestId,
      ),
    }))
    await runDesktopAction(() =>
      window.desktopApi.respondToPermission(sessionId, request.requestId, {
        behavior,
        message: behavior === 'deny' ? '在桌面端界面中拒绝' : undefined,
        alwaysAllow,
      }),
    )
  }

  function selectSession(session: SessionListItem): void {
    activateSession(session.id)
    setSessionStatus(session.status)
    setActiveView('quickChat')
    const nextWorkspace =
      sessionWorkspacesRef.current[session.id] ?? {
        name: session.workspaceName,
        path: session.workspacePath,
      }
    setWorkspace(nextWorkspace)
    applySessionView(
      sessionViewsRef.current[session.id] ?? createEmptySessionView(),
    )
    void refreshWorkspace(nextWorkspace, { expectedSessionId: session.id })
  }

  function handleModelPresetChange(nextPresetId: string): void {
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
  }

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

  const activeSessionItem = useMemo(
    () => sessions.find(session => session.id === sessionId) ?? null,
    [sessions, sessionId],
  )
  const runtimeMissing = runtimeStatus?.agentExecutableExists === false
  const activePermissionRequest = pendingPermissions[0] ?? null
  const workspaceName = workspace?.name ?? '未选择项目'
  const branchName =
    workspace?.isGitRepo === false
      ? '未检测到 Git 分支'
      : workspace?.branchName ?? '未检测到 Git 分支'

  const filteredWorkspaces = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return recentWorkspaces
    return recentWorkspaces.filter(item =>
      [item.name, item.path, item.branchName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [recentWorkspaces, searchQuery])

  const filteredSessions = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter(session =>
      [
        session.sessionName ?? '',
        session.workspaceName,
        session.createdAt,
        session.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [sessions, searchQuery])

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
        <p>当前项目：{workspace?.path ?? '无'}</p>
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

  const menuBar = (
    <MenuBar
      runtimeMissing={runtimeMissing}
      sidebarCollapsed={sidebarCollapsed}
      onOpenSettings={() => openDrawer('settings')}
      onToggleSidebar={() => setSidebarCollapsed(current => !current)}
    />
  )

  const sidebar = (
    <DesktopSidebar
      activeSessionId={sessionId}
      activeView={activeView}
      collapsed={sidebarCollapsed}
      maxWidth={Math.round(viewportWidth * SIDEBAR_MAX_RATIO)}
      minWidth={Math.round(viewportWidth * SIDEBAR_MIN_RATIO)}
      recentWorkspaces={recentWorkspaces}
      sessions={sessions}
      width={sidebarWidth}
      workspace={workspace}
      onChooseWorkspace={() => void chooseWorkspace()}
      onCloseSession={session => void closeSession(session)}
      onCreateSession={() => void createSessionForWorkspace()}
      onOpenSettings={() => openDrawer('settings')}
      onOpenWorkspace={workspaceItem => void openRecentWorkspace(workspaceItem)}
      onRefreshWorkspace={() => void refreshWorkspace()}
      onSelectSession={selectSession}
      onSelectView={view => {
        if (view === 'quickChat') {
          void handleNewConversation()
          return
        }
        setActiveView(view)
      }}
      onSetWidth={setSidebarWidth}
      onToggleCollapsed={() => setSidebarCollapsed(current => !current)}
    />
  )

  const content =
    activeView === 'quickChat' ? (
      <QuickChatView
        workspaceName={workspace?.name ?? null}
        messages={messages}
        errorMessage={errorMessage}
        onDismissError={() => setErrorMessage(null)}
        sessionStatus={sessionStatus}
      />
    ) : activeView === 'search' ? (
      <SearchView
        query={searchQuery}
        workspaces={filteredWorkspaces}
        sessions={filteredSessions}
        onQueryChange={setSearchQuery}
        onOpenWorkspace={workspaceItem => void openRecentWorkspace(workspaceItem)}
        onSelectSession={session => selectSession(session)}
      />
    ) : activeView === 'plugins' ? (
      <PluginsView />
    ) : (
      <AutomationView />
    )

  const composer = (
    <>
      <ComposerCard
        input={input}
        canSubmit={canSubmit}
        sessionStatus={sessionStatus}
        permissionMode={permissionMode}
        thinkingMode={thinkingMode}
        selectedModelPreset={selectedModelPreset}
        modelPresets={MODEL_PRESETS}
        permissionOptions={PERMISSION_MODE_OPTIONS.map(option => ({
          value: option.value,
          label: option.label,
        }))}
        thinkingOptions={THINKING_MODE_OPTIONS}
        onInputChange={setInput}
        onPermissionChange={setPermissionMode}
        onThinkingChange={setThinkingMode}
        onModelChange={handleModelPresetChange}
        onSubmit={() => void submit()}
        onInterrupt={() => void interrupt()}
        onOpenFiles={() => openDrawer('files')}
      />
      <ContextStrip workspaceName={workspaceName} branchName={branchName} />
    </>
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

      {!workspace && runtimeMissing ? (
        <div className="global-warning">
          <AlertCircle size={16} />
          <span>
            桌面端 agent 运行时缺失，发送消息前请先执行
            `bun run desktop:agent:build`。
          </span>
        </div>
      ) : null}

      <DesktopShell
        menuBar={menuBar}
        sidebar={sidebar}
        content={content}
        composer={composer}
        drawer={drawer}
      />
    </div>
  )
}

function readStoredDesktopSettings(): StoredDesktopSettings {
  try {
    const raw = window.localStorage.getItem(DESKTOP_SETTINGS_STORAGE_KEY)
    if (!raw) return defaultDesktopSettings()
    const parsed = JSON.parse(raw) as {
      permissionMode?: unknown
      model?: unknown
      fallbackModel?: unknown
      sessionName?: unknown
      thinkingMode?: unknown
      systemPrompt?: unknown
      appendSystemPrompt?: unknown
      additionalDirectories?: unknown
      recentWorkspaces?: unknown
      activeView?: unknown
      drawerTab?: unknown
      selectedModelPreset?: unknown
    }
    return {
      permissionMode: isDesktopPermissionMode(parsed.permissionMode)
        ? parsed.permissionMode
        : 'default',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      fallbackModel:
        typeof parsed.fallbackModel === 'string' ? parsed.fallbackModel : '',
      sessionName:
        typeof parsed.sessionName === 'string' ? parsed.sessionName : '',
      thinkingMode: isDesktopThinkingMode(parsed.thinkingMode)
        ? parsed.thinkingMode
        : 'default',
      systemPrompt:
        typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
      appendSystemPrompt:
        typeof parsed.appendSystemPrompt === 'string'
          ? parsed.appendSystemPrompt
          : '',
      additionalDirectories:
        typeof parsed.additionalDirectories === 'string'
          ? parsed.additionalDirectories
          : '',
      recentWorkspaces: parseStoredRecentWorkspaces(parsed.recentWorkspaces),
      activeView: isAppView(parsed.activeView) ? parsed.activeView : 'quickChat',
      drawerTab: isDrawerTab(parsed.drawerTab) ? parsed.drawerTab : 'files',
      selectedModelPreset:
        typeof parsed.selectedModelPreset === 'string'
          ? parsed.selectedModelPreset
          : DEFAULT_MODEL_PRESET_ID,
    }
  } catch {
    return defaultDesktopSettings()
  }
}

function storeDesktopSettings(settings: StoredDesktopSettings): void {
  window.localStorage.setItem(
    DESKTOP_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  )
}

function defaultDesktopSettings(): StoredDesktopSettings {
  return {
    permissionMode: 'default',
    model: '',
    fallbackModel: '',
    sessionName: '',
    thinkingMode: 'default',
    systemPrompt: '',
    appendSystemPrompt: '',
    additionalDirectories: '',
    recentWorkspaces: [],
    activeView: 'quickChat',
    drawerTab: 'files',
    selectedModelPreset: DEFAULT_MODEL_PRESET_ID,
  }
}

function isDesktopPermissionMode(value: unknown): value is DesktopPermissionMode {
  return PERMISSION_MODE_OPTIONS.some(option => option.value === value)
}

function isDesktopThinkingMode(value: unknown): value is DesktopThinkingMode {
  return THINKING_MODE_OPTIONS.some(option => option.value === value)
}

function isAppView(value: unknown): value is AppView {
  return (
    value === 'quickChat' ||
    value === 'search' ||
    value === 'plugins' ||
    value === 'automation'
  )
}

function isDrawerTab(value: unknown): value is DrawerTab {
  return (
    value === 'files' ||
    value === 'diff' ||
    value === 'permissions' ||
    value === 'toolLog' ||
    value === 'settings'
  )
}

function parseStoredRecentWorkspaces(value: unknown): DesktopWorkspace[] {
  if (!Array.isArray(value)) return []
  const workspaces: DesktopWorkspace[] = []
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as DesktopWorkspace).name === 'string' &&
      typeof (item as DesktopWorkspace).path === 'string'
    ) {
      workspaces.push({
        name: (item as DesktopWorkspace).name,
        path: (item as DesktopWorkspace).path,
        branchName:
          typeof (item as DesktopWorkspace).branchName === 'string'
            ? (item as DesktopWorkspace).branchName
            : null,
        isGitRepo:
          typeof (item as DesktopWorkspace).isGitRepo === 'boolean'
            ? (item as DesktopWorkspace).isGitRepo
            : undefined,
      })
    }
  }
  return workspaces
}

function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  const filtered = workspaces.filter(item => item.path !== workspace.path)
  return [workspace, ...filtered].slice(0, MAX_RECENT_WORKSPACES)
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseAdditionalDirectories(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function clampSidebarWidth(value: number, viewportWidth: number): number {
  const min = Math.round(viewportWidth * SIDEBAR_MIN_RATIO)
  const max = Math.round(viewportWidth * SIDEBAR_MAX_RATIO)
  return Math.min(max, Math.max(min, Math.round(value)))
}

function readStoredSidebarWidth(viewportWidth: number): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  if (!raw) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth)
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth)
  }
  return clampSidebarWidth(parsed, viewportWidth)
}
