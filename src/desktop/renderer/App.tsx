import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
  LogIn,
  Play,
  RefreshCw,
  Send,
  Settings,
  Plus,
  Square,
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
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<string[]>([])
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<DesktopFilePreview | null>(
    null,
  )
  const [diff, setDiff] = useState('No workspace selected.')
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')

  useEffect(() => {
    void window.desktopApi.getAuthStatus().then(setAuthStatus)
    return window.desktopApi.onAgentEvent(handleAgentEvent)
  }, [])

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
    if (event.sessionId !== activeSessionIdRef.current) {
      return
    }
    if (event.type === 'message') {
      setMessages(current => [
        ...current.filter(message => !message.streaming),
        {
          id: crypto.randomUUID(),
          role: event.role,
          text: event.text,
        },
      ])
      return
    }
    if (event.type === 'partial_message') {
      setMessages(current => {
        const index = current.findIndex(message => message.streaming)
        const nextMessage: Message = {
          id: index >= 0 ? current[index]!.id : crypto.randomUUID(),
          role: 'assistant',
          text: event.text,
          streaming: true,
        }
        if (index === -1) {
          return [...current, nextMessage]
        }
        return current.map((message, messageIndex) =>
          messageIndex === index ? nextMessage : message,
        )
      })
      return
    }
    if (event.type === 'tool_start') {
      setToolLog(current => [
        `${event.toolName}: ${event.summary}`,
        ...current,
      ])
      return
    }
    if (event.type === 'tool_result') {
      setToolLog(current => [
        `${event.toolName}: ${event.summary}`,
        ...current,
      ])
      return
    }
    if (event.type === 'permission_request') {
      setPendingPermissions(current => [event.request, ...current])
      return
    }
    if (event.type === 'diff') {
      setDiff(event.patch)
      return
    }
    if (event.type === 'error') {
      setMessages(current => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: event.message,
        },
      ])
      return
    }
    if (event.type === 'done') {
      setSessionStatus('done')
      setSessions(current =>
        current.map(session =>
          session.id === event.sessionId
            ? { ...session, status: 'done' }
            : session,
        ),
      )
      setMessages(current =>
        current.map(message =>
          message.streaming ? { ...message, streaming: false } : message,
        ),
      )
    }
  }

  async function refreshWorkspace(target = workspace): Promise<void> {
    if (!target) return
    const [nextFiles, nextDiff] = await Promise.all([
      window.desktopApi.listWorkspaceFiles(target.path),
      window.desktopApi.getWorkspaceDiff(target.path),
    ])
    setFiles(nextFiles)
    setDiff(nextDiff.patch)
    setSelectedFile(null)
  }

  function activateSession(nextSessionId: string): void {
    activeSessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.desktopApi.chooseWorkspace()
    if (!selected) return
    setWorkspace(selected)
    await refreshWorkspace(selected)
    await createSessionForWorkspace(selected)
  }

  async function createSessionForWorkspace(
    target = workspace,
  ): Promise<void> {
    if (!target) return
    const session = await window.desktopApi.createSession({
      workspacePath: target.path,
    })
    activateSession(session.sessionId)
    setSessionStatus('idle')
    setMessages([])
    setToolLog([])
    setPendingPermissions([])
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
    setAuthStatus(await window.desktopApi.login())
  }

  async function previewFile(file: DesktopFileEntry): Promise<void> {
    if (!workspace || file.type !== 'file') return
    setSelectedFile(
      await window.desktopApi.readWorkspaceFile(workspace.path, file.path),
    )
  }

  async function submit(): Promise<void> {
    const trimmed = input.trim()
    if (!sessionId || !trimmed) return
    setInput('')
    await window.desktopApi.sendUserMessage(sessionId, trimmed)
  }

  async function interrupt(): Promise<void> {
    if (sessionId) {
      await window.desktopApi.interruptSession(sessionId)
    }
  }

  async function decidePermission(
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow = false,
  ): Promise<void> {
    if (!sessionId) return
    setPendingPermissions(current =>
      current.filter(item => item.requestId !== request.requestId),
    )
    await window.desktopApi.respondToPermission(sessionId, request.requestId, {
      behavior,
      message: behavior === 'deny' ? 'Denied in desktop UI' : undefined,
      alwaysAllow,
    })
  }

  const canSubmit = useMemo(
    () => Boolean(sessionId && input.trim()),
    [input, sessionId],
  )

  return (
    <main className="desktop-shell">
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
                <button
                  className={
                    session.id === sessionId
                      ? 'session-row active'
                      : 'session-row'
                  }
                  key={session.id}
                  onClick={() => {
                    activateSession(session.id)
                    setSessionStatus(session.status)
                    setWorkspace({
                      name: session.workspaceName,
                      path: session.workspacePath,
                    })
                    setMessages([])
                    setToolLog([])
                    setPendingPermissions([])
                    void refreshWorkspace({
                      name: session.workspaceName,
                      path: session.workspacePath,
                    })
                  }}
                >
                  <span>{session.workspaceName}</span>
                  <small>{session.status} - {session.createdAt}</small>
                </button>
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
              <span>Send</span>
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
              toolLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
            )}
          </div>
        </section>
      </aside>
    </main>
  )
}
