import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { sessionDisplayTitle, type SessionListItem } from '../uiTypes.js'

export function ArchivedConversationsSettings(): React.ReactNode {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const snapshots = await window.desktopApi.listSessions()
      setSessions(snapshots.map(snapshot => snapshot.item))
      setError(null)
    } catch (loadError) {
      setError(errorMessageOf(loadError))
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const archivedSessions = useMemo(
    () =>
      sessions
        .filter(session => session.archivedAt)
        .sort((left, right) =>
          compareTimestamp(right.archivedAt, left.archivedAt),
        ),
    [sessions],
  )

  async function restoreSession(session: SessionListItem): Promise<void> {
    try {
      const snapshot = await window.desktopApi.updateSessionMetadata(
        session.id,
        { archivedAt: null },
      )
      setSessions(current =>
        current.map(item => (item.id === session.id ? snapshot.item : item)),
      )
      setError(null)
    } catch (restoreError) {
      setError(errorMessageOf(restoreError))
    }
  }

  async function deleteSession(session: SessionListItem): Promise<void> {
    try {
      await window.desktopApi.disposeSession(session.id)
      setSessions(current => current.filter(item => item.id !== session.id))
      setError(null)
    } catch (deleteError) {
      setError(errorMessageOf(deleteError))
    }
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h1 className="settings-page-title">已归档对话</h1>
        <section className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">归档列表</h2>
            <p className="settings-section-desc">
              归档对话不会出现在侧边栏和搜索中，恢复后会回到原来的分组。
            </p>
          </div>
          {error ? <p className="settings-error-text">{error}</p> : null}
          <div className="settings-card archived-session-card">
            {archivedSessions.length === 0 ? (
              <p className="archived-empty">暂无已归档对话。</p>
            ) : (
              archivedSessions.map(session => (
                <article className="archived-session-row" key={session.id}>
                  <div className="archived-session-copy">
                    <h3>{sessionDisplayTitle(session)}</h3>
                    <p>
                      {session.standalone ? '对话' : session.workspaceName}
                      {' · '}
                      {session.createdAt}
                    </p>
                  </div>
                  <div className="archived-session-actions">
                    <button
                      className="settings-button"
                      onClick={() => void restoreSession(session)}
                      type="button"
                    >
                      <ArchiveRestore size={14} />
                      <span>恢复</span>
                    </button>
                    <button
                      className="settings-button danger"
                      onClick={() => void deleteSession(session)}
                      type="button"
                    >
                      <Trash2 size={14} />
                      <span>删除</span>
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime()
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
