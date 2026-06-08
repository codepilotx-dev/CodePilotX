import { useEffect, useMemo, useState } from 'react'
import {
  FolderOpen,
  LogIn,
  Play,
  RefreshCw,
  Send,
  Settings,
  Square,
} from 'lucide-react'
import type {
  DesktopAgentEvent,
  DesktopAuthStatus,
  DesktopFileEntry,
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

declare global {
  interface Window {
    desktopApi: import('../shared/types.js').DesktopApi
  }
}

export function App(): React.ReactNode {
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null)
  const [workspace, setWorkspace] = useState<DesktopWorkspace | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] =
    useState<DesktopSessionStatus>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [toolLog, setToolLog] = useState<string[]>([])
  const [files, setFiles] = useState<DesktopFileEntry[]>([])
  const [diff, setDiff] = useState('No workspace selected.')
  const [pendingPermissions, setPendingPermissions] = useState<
    DesktopPermissionRequest[]
  >([])
  const [input, setInput] = useState('')

  useEffect(() => {
    void window.desktopApi.getAuthStatus().then(setAuthStatus)
    return window.desktopApi.onAgentEvent(handleAgentEvent)
  }, [])

  function handleAgentEvent(event: DesktopAgentEvent): void {
    if (event.type === 'status') {
      setSessionStatus(event.status)
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
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.desktopApi.chooseWorkspace()
    if (!selected) return
    setWorkspace(selected)
    await refreshWorkspace(selected)
    const session = await window.desktopApi.createSession({
      workspacePath: selected.path,
    })
    setSessionId(session.sessionId)
  }

  async function login(): Promise<void> {
    setAuthStatus(await window.desktopApi.login())
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
        </section>

        <section className="panel">
          <h2>Session</h2>
          <p>{sessionId ?? 'No active session'}</p>
          <span className="status-pill">{sessionStatus}</span>
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
            <button>
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
                  style={{ paddingLeft: 10 + file.depth * 14 }}
                >
                  <span>{file.type === 'directory' ? 'dir' : 'file'}</span>
                  {file.name}
                </button>
              ))
            )}
          </div>
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
