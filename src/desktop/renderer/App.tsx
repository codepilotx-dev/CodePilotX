import { useEffect, useMemo, useState } from 'react'
import {
  FolderOpen,
  LogIn,
  Play,
  Send,
  Settings,
  Square,
} from 'lucide-react'
import type {
  DesktopAgentEvent,
  DesktopAuthStatus,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../shared/types.js'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
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
        ...current,
        {
          id: crypto.randomUUID(),
          role: event.role,
          text: event.text,
        },
      ])
      return
    }
    if (event.type === 'done') {
      setSessionStatus('done')
    }
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.desktopApi.chooseWorkspace()
    if (!selected) return
    setWorkspace(selected)
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
          <p>File tree integration will read from the selected workspace.</p>
        </section>
        <section>
          <h2>Diff</h2>
          <p>No file changes yet.</p>
        </section>
        <section>
          <h2>Permissions</h2>
          <p>Pending tool approvals will appear here.</p>
        </section>
      </aside>
    </main>
  )
}
