import { desktopClient } from '../../services/desktop-client/index.js'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { sessionDisplayTitle, type SessionListItem } from '../../uiTypes.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'
import { canonicalThreadCache } from '../session/state/canonicalThreadCache.js'
import { errorMessageOf } from '@codepilotx/shared/errors'

export function ArchivedConversationsSettings(): React.ReactNode {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const snapshots = await desktopClient.listSessions({ archived: true })
      setSessions(snapshots.map((snapshot) => snapshot.item))
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
        .filter((session) => session.archivedAt)
        .sort((left, right) => compareTimestamp(right.archivedAt, left.archivedAt)),
    [sessions],
  )

  async function restoreSession(session: SessionListItem): Promise<void> {
    try {
      const snapshot = await desktopClient.updateSessionMetadata(session.id, { archivedAt: null })
      setSessions((current) =>
        current.map((item) => (item.id === session.id ? snapshot.item : item)),
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
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setError(null)
    } catch (deleteError) {
      setError(errorMessageOf(deleteError))
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">已归档对话</h2>
        </div>
        <SettingsSection
          title="归档列表"
          description={error ?? '归档对话不会出现在侧边栏和搜索中，恢复后会回到原来的分组。'}
        >
          {archivedSessions.length === 0 ? (
            <p className="archived-empty tw:m-0 tw:p-5 tw:text-app-text-soft tw:type-body-sm">暂无已归档对话。</p>
          ) : (
            archivedSessions.map((session) => (
              <article
                className="archived-session-row tw:flex tw:items-center tw:gap-4 tw:bg-transparent tw:px-4 tw:py-4 tw:max-[900px]:flex-col tw:max-[900px]:items-stretch tw:[&+&]:border-t tw:[&+&]:border-t-app-border"
                key={session.id}
              >
                <div className="archived-session-copy tw:min-w-0 tw:flex-1 tw:[&>h3]:m-0 tw:[&>h3]:truncate tw:[&>h3]:text-app-text tw:[&>h3]:type-row-title tw:[&>p]:m-0 tw:[&>p]:text-app-text-soft tw:[&>p]:text-[length:var(--cpx-sys-font-size-xs)]">
                  <h4>{sessionDisplayTitle(session)}</h4>
                  <p>
                    {session.standalone ? '对话' : session.workspaceName}
                    {' · '}
                    {session.createdAt}
                  </p>
                </div>
                <div className="archived-session-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                  <Button
                    color="primary"
                    onClick={() => void restoreSession(session)}
                    type="button"
                  >
                    <ArchiveRestore size={APP_ICON_SIZE} />
                    <span>恢复</span>
                  </Button>
                  <Button color="danger" onClick={() => void deleteSession(session)} type="button">
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
