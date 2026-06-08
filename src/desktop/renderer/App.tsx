import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LogIn,
  Play,
  RefreshCw,
  Send,
  Settings,
  Plus,
  Square,
  X,
} from 'lucide-react'
import type {
  DesktopAgentEvent,
  DesktopAuthStatus,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../shared/types.js'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming?: boolean
}

type SessionListItem = {
  id: string
  workspaceName: string
  workspacePath: string
  status: DesktopSessionStatus
  createdAt: string
}

type ToolLogEntry = {
  id: string
  toolName: string
  summary: string
  kind: 'start' | 'result'
  isError?: boolean
  expanded: boolean
  createdAt: string
}

type SessionViewState = {
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  selectedFile: DesktopFilePreview | null
}

declare global {
  interface Window {
    desktopApi: import('../shared/types.js').DesktopApi
  }
}

export function App(): React.ReactNode {
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null)
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const sessionViewsRef = useRef<Record<string, SessionViewState>>({})
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([])
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<DesktopFilePreview | null>(
    null,
  )
  const [diff, setDiff] = useState('No workspace selected.')
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [showSettings, setShowSettings] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [input, setInput] = useState('')

  useEffect(() => {
    void runDesktopAction(() =>
      window.desktopApi.getAuthStatus().then(setAuthStatus),
    )
    return window.desktopApi.onAgentEvent(handleAgentEvent)
  }, [])

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
      }
      updateSessionView(event.sessionId, view => ({
        ...view,
        messages: [
          ...view.messages,
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
      }
      updateSessionView(event.sessionId, view => ({
        ...view,
        messages: view.messages.map(message =>
          message.streaming ? { ...message, streaming: false } : message,
        ),
      }))
    }
  }

  async function refreshWorkspace(target = workspace): Promise<void> {
    if (!target) return
    const result = await runDesktopAction(() =>
      Promise.all([
        window.desktopApi.listWorkspaceFiles(target.path),
        window.desktopApi.getWorkspaceDiff(target.path),
      ]),
    )
    if (!result) return
    const [nextFiles, nextDiff] = result
    setFiles(nextFiles)
    setDiff(nextDiff.patch)
    setSelectedFile(null)
    updateActiveSessionView(view => ({ ...view, selectedFile: null }))
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
    if (!activeSessionId) {
      return
    }
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
    setWorkspace(selected)
    await refreshWorkspace(selected)
    await createSessionForWorkspace(selected)
  }

  async function createSessionForWorkspace(
    target = workspace,
  ): Promise<void> {
    if (!target) return
    const session = await runDesktopAction(() =>
      window.desktopApi.createSession({
        workspacePath: target.path,
      }),
    )
    if (!session) return
    const nextView = createEmptySessionView()
    setSessionView(session.sessionId, nextView)
    activateSession(session.sessionId)
    setSessionStatus('idle')
    applySessionView(nextView)
    setSessions(current => [
      {
        id: session.sessionId,
        workspaceName: target.name,
        workspacePath: target.path,
        status: 'idle',
        createdAt: new Date().toLocaleTimeString(),
      },
      ...current,
    ])
  }

  async function login(): Promise<void> {
    const status = await runDesktopAction(() => window.desktopApi.login())
    if (status) {
      setAuthStatus(status)
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
    sessionViewsRef.current = remainingSessionViews
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
      const nextWorkspace = {
        name: next.workspaceName,
        path: next.workspacePath,
      }
      setWorkspace(nextWorkspace)
      void refreshWorkspace(nextWorkspace)
    } else {
      applySessionView(createEmptySessionView())
      setWorkspace(null)
      setFiles([])
      setDiff('No workspace selected.')
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
        message: behavior === 'deny' ? 'Denied in desktop UI' : undefined,
        alwaysAllow,
      }),
    )
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
  const activePermissionRequest = pendingPermissions[0] ?? null

  return (
    <main className="desktop-shell">
      {activePermissionRequest ? (
        <div className="permission-modal-backdrop">
          <section className="permission-modal">
            <header>
              <h2>Permission request</h2>
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
              >
                Allow
              </button>
              <button
                onClick={() =>
                  void decidePermission(activePermissionRequest, 'allow', true)
                }
              >
                Always allow
              </button>
              <button
                onClick={() =>
                  void decidePermission(activePermissionRequest, 'deny')
                }
              >
                Deny
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CC</span>
          <div>
            <h1>ClaudeCode</h1>
            <p>Local Desktop</p>
          </div>
        </div>

        <button className="primary-button" onClick={chooseWorkspace}>
          <FolderOpen size={18} />
          <span>Choose workspace</span>
        </button>

        <section className="panel">
          <h2>Workspace</h2>
          <p>{workspace?.path ?? 'No workspace selected'}</p>
          <button onClick={() => void refreshWorkspace()} disabled={!workspace}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => void createSessionForWorkspace()}
            disabled={!workspace}
          >
            <Plus size={15} />
            <span>New session</span>
          </button>
        </section>

        <section className="panel">
          <h2>Sessions</h2>
          {sessions.length === 0 ? (
            <p>No sessions yet.</p>
          ) : (
            <div className="session-list">
              {sessions.map(session => (
                <div
                  className={
                    session.id === sessionId
                      ? 'session-row active'
                      : 'session-row'
                  }
                  key={session.id}
                >
                  <button
                    className="session-select"
                    onClick={() => {
                      activateSession(session.id)
                      setSessionStatus(session.status)
                      setWorkspace({
                        name: session.workspaceName,
                        path: session.workspacePath,
                      })
                      applySessionView(
                        sessionViewsRef.current[session.id] ??
                          createEmptySessionView(),
                      )
                      void refreshWorkspace({
                        name: session.workspaceName,
                        path: session.workspacePath,
                      })
                    }}
                  >
                    <span>{session.workspaceName}</span>
                    <small>{session.status} - {session.createdAt}</small>
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => void closeSession(session.id)}
                    title="Close session"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <section className="conversation">
        <header className="topbar">
          <div>
            <h2>Agent workspace</h2>
            <p>{workspace?.name ?? 'Select a workspace to start'}</p>
          </div>
          <div className="topbar-actions">
            <button onClick={login}>
              <LogIn size={17} />
              <span>{authStatus?.authenticated ? 'Signed in' : 'Sign in'}</span>
            </button>
            <button onClick={() => setShowSettings(value => !value)}>
              <Settings size={17} />
            </button>
          </div>
        </header>

        <div className="message-list">
          {errorMessage ? (
            <div className="error-banner">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)}>Dismiss</button>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <div className="empty-state">
              <Play size={24} />
              <p>Choose a workspace, then send a prompt to start a desktop session.</p>
            </div>
          ) : (
            messages.map(message => (
              <article key={message.id} className={`message ${message.role}`}>
                <span>{message.role}</span>
                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>

        <footer className="composer">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Ask the agent to inspect or change this workspace..."
          />
          <div className="composer-actions">
            <button onClick={interrupt} disabled={!sessionId}>
              <Square size={17} />
            </button>
            <button className="send-button" onClick={submit} disabled={!canSubmit}>
              <Send size={17} />
              <span>{sessionStatus === 'waiting' ? 'Waiting' : 'Send'}</span>
            </button>
          </div>
        </footer>
      </section>

      <aside className="inspector">
        <section>
          <h2>Files</h2>
          <div className="file-list">
            {files.length === 0 ? (
              <p>No files loaded.</p>
            ) : (
              files.map(file => (
                <button
                  className="file-row"
                  key={file.path}
                  onClick={() => void previewFile(file)}
                  style={{ paddingLeft: 10 + file.depth * 14 }}
                >
                  <span>{file.type === 'directory' ? 'dir' : 'file'}</span>
                  {file.name}
                </button>
              ))
            )}
          </div>
          {selectedFile ? (
            <div className="file-preview">
              <strong>{selectedFile.path}</strong>
              {selectedFile.truncated ? <p>Preview truncated.</p> : null}
              <pre>{selectedFile.content}</pre>
            </div>
          ) : null}
        </section>
        <section>
          <h2>Diff</h2>
          <pre className="diff-panel">{diff}</pre>
        </section>
        <section>
          <h2>Permissions</h2>
          <div className="permission-list">
            {pendingPermissions.length === 0 ? (
              <p>No pending approvals.</p>
            ) : (
              pendingPermissions.map(request => (
                <article className="permission-card" key={request.requestId}>
                  <strong>{request.toolName}</strong>
                  <p>{request.description}</p>
                  <code>{JSON.stringify(request.input)}</code>
                  <div>
                    <button
                      onClick={() => void decidePermission(request, 'allow')}
                    >
                      Allow
                    </button>
                    <button
                      onClick={() =>
                        void decidePermission(request, 'allow', true)
                      }
                    >
                      Always allow
                    </button>
                    <button
                      onClick={() => void decidePermission(request, 'deny')}
                    >
                      Deny
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
        {showSettings ? (
          <section>
            <h2>Settings</h2>
            <div className="settings-list">
              <p>Auth: {authStatus?.method ?? 'unknown'}</p>
              <p>User: {authStatus?.email ?? 'not signed in'}</p>
              <p>Workspace: {workspace?.path ?? 'none'}</p>
              <p>Active session: {sessionId ?? 'none'}</p>
            </div>
          </section>
        ) : null}
        <section>
          <h2>Tool log</h2>
          <div className="tool-log">
            {toolLog.length === 0 ? (
              <p>No tool activity yet.</p>
            ) : (
              toolLog.map(entry => (
                <article
                  className={entry.isError ? 'tool-entry error' : 'tool-entry'}
                  key={entry.id}
                >
                  <button onClick={() => toggleToolLogEntry(entry.id)}>
                    {entry.expanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <span>{entry.toolName}</span>
                    <small>{entry.kind} - {entry.createdAt}</small>
                  </button>
                  {entry.expanded ? <p>{entry.summary}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  )
}
