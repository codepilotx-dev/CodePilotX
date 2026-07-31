import { desktopClient } from '../../services/desktop-client/index.js'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { sessionDisplayTitle, type SessionListItem } from '../../uiTypes.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js';
import { Button } from '../../components/ui/Button.js'
import { canonicalThreadCache } from '../session/state/canonicalThreadCache.js'

export function ArchivedConversationsSettings(): React.ReactNode {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const snapshots = await desktopClient.listSessions({ archived: true })
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
      const snapshot = await desktopClient.updateSessionMetadata(
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
      await desktopClient.disposeSession(session.id)
      canonicalThreadCache.invalidate(session.id)
      setSessions(current => current.filter(item => item.id !== session.id))
      setError(null)
    } catch (deleteError) {
      setError(errorMessageOf(deleteError))
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">已归档对话</h2>
        </div>
        <SettingsSection
          title="归档列表"
          description={error ?? '归档对话不会出现在侧边栏和搜索中，恢复后会回到原来的分组。'}
        >
          {archivedSessions.length === 0 ? (
            <p className="archived-empty">暂无已归档对话。</p>
          ) : (
            archivedSessions.map(session => (
              <article className="archived-session-row" key={session.id}>
                <div className="archived-session-copy">
                  <h4>{sessionDisplayTitle(session)}</h4>
                  <p>
                    {session.standalone ? '对话' : session.workspaceName}
                    {' · '}
                    {session.createdAt}
                  </p>
                </div>
                <div className="archived-session-actions">
                  <Button
                    onClick={() => void restoreSession(session)}
                    type="button"
                  >
                    <ArchiveRestore size={APP_ICON_SIZE} />
                    <span>恢复</span>
                  </Button>
                  <Button
                    tone="danger"
                    onClick={() => void deleteSession(session)}
                    type="button"
                  >
                    <Trash2 size={APP_ICON_SIZE} />
                    <span>删除</span>
                  </Button>
                </div>
              </article>
            ))
          )}
        </SettingsSection>
      </div>
    </SettingsContentArea>
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
