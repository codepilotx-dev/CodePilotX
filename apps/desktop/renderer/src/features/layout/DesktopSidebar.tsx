import { mergeCatalogProjects } from './sidebar/useSidebarProjectCatalog.js'
import type React from 'react'
import { useLocation } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopRemovedWorkspace,
  DesktopSessionCatalogStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'
import type { AppView, SessionListItem } from '../../uiTypes.js'
import { SidebarBody } from './sidebar/SidebarBody.js'
import { SidebarDockedPanes } from './sidebar/SidebarDockedPanes.js'
import { SidebarEmptyRow } from './sidebar/SidebarRow.js'
import type { DesktopFileEntry } from '../../../shared/types.js'
import type {
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabId,
  WorkbenchTabsState,
} from './dock/rightDockState.js'
import { SidebarHeader, SidebarNewTaskNav } from './sidebar/SidebarTopNav.js'
import {
  buildSidebarViewModel,
  buildSidebarTimelineModel,
  filterSidebarActivitySessions,
  hasSidebarUnreadSessions,
  sidebarArchivableAttentionSessions,
  sidebarAttentionUnreadSessions,
  sidebarProjectKey,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
} from './sidebar/sidebarViewModel.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useEverOpened } from '../../hooks/usePresenceRetention.js'
import {
  getSidebarScrollModeKey,
  type SidebarScrollModeKey,
} from './sidebar/useSidebarScrollController.js'
import { useSidebarProjectCatalog } from './sidebar/useSidebarProjectCatalog.js'
import {
  createSidebarDisclosureStore,
  sidebarSectionDisclosureKey,
} from './sidebar/sidebarDisclosureStore.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { DEFAULT_SIDEBAR_CUSTOMIZATION } from '../../../shared/settingsSchema.js'
import {
  addSidebarSection,
  deleteSidebarSection,
  moveItemToSection,
  orderSidebarSections,
  removeItemsFromSections,
  renameSidebarSection,
  captureSidebarAssignments,
  restoreFailedArchiveAssignments,
  restoreSidebarAssignments,
  setSidebarSectionCollapsed,
  setSidebarSectionItems,
  setSidebarSectionSort,
} from './sidebar/sidebarCustomization.js'
import type { SidebarCustomization } from '../../../shared/types.js'

import type { SidebarPane } from './sidebar/sidebarNavigation.js'

type Props = {
  active?: boolean
  pane?: SidebarPane
  activeSessionId: string | null
  catalogStatus: DesktopSessionCatalogStatus
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  recentWorkspaces: DesktopWorkspace[]
  removedWorkspaces: DesktopRemovedWorkspace[]
  sessionFallbackTitles: Record<string, string>
  sessions: SessionListItem[]
  unavailableWorkspacePaths: Set<string>
  workspace: DesktopWorkspace | null
  onChooseWorkspace: () => void
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onOpenCommandMenu: () => void
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onArchiveSessions: (sessionIds: readonly string[]) => Promise<{
    failedSessionIds: string[]
    succeededSessionIds: string[]
  }>
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport: (message: string) => void
  onError?: (message: string) => void
  dockedPanesState?: WorkbenchPanelSnapshot
  dockedTabsById?: WorkbenchTabsState['tabsById']
  workspaceFiles?: DesktopFileEntry[]
  onSelectDockedTab?: (tabId: WorkbenchTabId) => void
  onCloseDockedTab?: (tabId: WorkbenchTabId) => void
  onMoveDockedTab?: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
  ) => void
  onPopOutDockedTab?: (source: WorkbenchPanelTarget, tabId: WorkbenchTabId) => void
  onOpenFile?: (file: DesktopFileEntry) => void
  onAddComposerFiles?: (files: string[]) => void
}

export function DesktopSidebar({
  active = true,
  pane,
  activeSessionId,
  catalogStatus,
  pendingPermissionSessionIds,
  titleLoadingIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionFallbackTitles,
  sessions,
  unavailableWorkspacePaths,
  workspace,
  onChooseWorkspace,
  onCreateSession,
  onOpenCommandMenu,
  onOpenWhatsNew,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onArchiveSessions,
  onRenameSession,
  onUnpinWorkspace,
  onReport,
  onError,
  dockedPanesState,
  dockedTabsById,
  workspaceFiles,
  onSelectDockedTab,
  onCloseDockedTab,
  onMoveDockedTab,
  onPopOutDockedTab,
  onOpenFile,
  onAddComposerFiles,
}: Props): React.ReactNode {
  const location = useLocation()
  const [relativeNow, setRelativeNow] = useState(() => Date.now())
  const [sidebarScrollOverlapping, setSidebarScrollOverlapping] = useState(false)
  const sidebarScrollPositionsRef = useRef<Map<SidebarScrollModeKey, number>>(new Map())
  const {
    collapsedSidebarSections,
    collapsedSidebarProjectPaths,
    setSidebarManualOrder,
    setRecentWorkspaces,
    setSidebarOrganization,
    setSidebarProjectSort,
    sidebarCustomization,
    setSidebarCustomization,
    sidebarSessionPins,
    setSidebarSessionPins,
    sidebarManualOrder,
    sidebarOrganization,
    sidebarShowScheduledSessions,
    setSidebarShowScheduledSessions,
    sidebarProjectSort,
    sidebarSort,
    setSidebarSort,
    sidebarTimelineEnabled,
    sidebarActivityShowWork,
    setSidebarActivityShowWork,
    sidebarActivityShowChat,
    setSidebarActivityShowChat,
    sidebarActivityShowPinned,
    setSidebarActivityShowPinned,
    syncExternalSettingsPatch,
  } = useDesktopSettings()
  const sidebarCustomizationRef = useRef(sidebarCustomization)
  sidebarCustomizationRef.current = sidebarCustomization
  const persistSidebarDisclosuresRef = useRef(syncExternalSettingsPatch)
  persistSidebarDisclosuresRef.current = syncExternalSettingsPatch
  const sidebarDisclosureExternalSignatureRef = useRef(
    sidebarDisclosureSignature(collapsedSidebarSections, collapsedSidebarProjectPaths),
  )
  const sidebarDisclosureState = useMemo(
    () =>
      createSidebarDisclosureStore(
        { collapsedSidebarSections, collapsedSidebarProjectPaths },
        (snapshot) => persistSidebarDisclosuresRef.current(snapshot),
      ),
    [],
  )
  const { projectCatalogState, removeCatalogProject } = useSidebarProjectCatalog({
    onError: onError ?? onReport,
    onReport,
  })

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const mergedProjects = useMemo(
    () => mergeCatalogProjects(projectCatalogState.projects, recentWorkspaces),
    [projectCatalogState.projects, recentWorkspaces],
  )

  useEffect(() => {
    sidebarDisclosureState.registerProjects(mergedProjects)
  }, [mergedProjects, sidebarDisclosureState])

  useEffect(() => {
    const signature = sidebarDisclosureSignature(
      collapsedSidebarSections,
      collapsedSidebarProjectPaths,
    )
    if (sidebarDisclosureExternalSignatureRef.current === signature) return
    sidebarDisclosureExternalSignatureRef.current = signature
    sidebarDisclosureState.replace({
      collapsedSidebarSections,
      collapsedSidebarProjectPaths,
    })
  }, [collapsedSidebarProjectPaths, collapsedSidebarSections, sidebarDisclosureState])

  const viewModel = useMemo(
    () =>
      buildSidebarViewModel({
        manualOrderByScope: sidebarManualOrder,
        organization: sidebarOrganization,
        showScheduledSessions: sidebarShowScheduledSessions,
        pendingPermissionSessionIds,
        recentWorkspaces: mergedProjects,
        removedWorkspaces,
        sessionPins: sidebarSessionPins,
        customSections: sidebarCustomization.sections,
        sessions,
      }),
    [
      pendingPermissionSessionIds,
      mergedProjects,
      removedWorkspaces,
      sessions,
      sidebarManualOrder,
      sidebarOrganization,
      sidebarShowScheduledSessions,
      sidebarCustomization,
      sidebarSessionPins,
      pane,
    ],
  )

  const [archiveAttentionOpen, setArchiveAttentionOpen] = useState(false)
  const [archivingAttention, setArchivingAttention] = useState(false)
  const archiveAttentionDialogMounted = useEverOpened(archiveAttentionOpen)

  const activityFilteredSessions = useMemo(
    () =>
      filterSidebarActivitySessions(viewModel.visibleSessions, {
        showWork: sidebarActivityShowWork,
        showChat: sidebarActivityShowChat,
      }),
    [sidebarActivityShowChat, sidebarActivityShowWork, viewModel.visibleSessions],
  )

  // 始终构建时间线投影，使铃铛在时间线关闭时也能获得关注状态
  const timelineModel = useMemo(
    () =>
      buildSidebarTimelineModel({
        now: relativeNow,
        sessions: activityFilteredSessions,
        showPinned: sidebarActivityShowPinned,
      }),
    [activityFilteredSessions, relativeNow, sidebarActivityShowPinned],
  )
  const timeline = pane === 'activity' ? timelineModel : null
  const hasUnread = useMemo(
    () => hasSidebarUnreadSessions(viewModel.visibleSessions),
    [viewModel.visibleSessions],
  )
  const attentionUnreadSessions = useMemo(
    () => sidebarAttentionUnreadSessions(timelineModel.attentionSessions),
    [timelineModel],
  )
  const archivableAttentionSessions = useMemo(
    () => sidebarArchivableAttentionSessions(timelineModel.attentionSessions),
    [timelineModel],
  )
  const sidebarScrollModeKey = getSidebarScrollModeKey({
    organization: sidebarOrganization,
    timelineEnabled: timeline !== null,
    pane,
  })

  const markAttentionRead = useCallback(async (): Promise<void> => {
    if (attentionUnreadSessions.length === 0) return
    const readThroughAt = new Date().toISOString()
    const results = await Promise.allSettled(
      attentionUnreadSessions.map((session) =>
        desktopClient.markSessionRead(session.id, readThroughAt),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    if (failedCount > 0) {
      onReport(
        `已标记 ${attentionUnreadSessions.length - failedCount} 个任务为已读，${failedCount} 个失败。`,
      )
    }
  }, [attentionUnreadSessions, onReport])

  const requestArchiveAttention = useCallback((): void => {
    if (archivableAttentionSessions.length === 0) return
    setArchiveAttentionOpen(true)
  }, [archivableAttentionSessions.length])

  const confirmArchiveAttention = useCallback(async (): Promise<void> => {
    if (archivingAttention) return
    setArchivingAttention(true)
    try {
      await archiveSessions(archivableAttentionSessions)
    } finally {
      setArchivingAttention(false)
      setArchiveAttentionOpen(false)
    }
  }, [archivableAttentionSessions, archivingAttention, archiveSessions])

  function isActiveView(view: AppView): boolean {
    if (view === 'new') return location.pathname === '/new'
    if (view === 'sessionGroups') return location.pathname.startsWith('/workflows')
    if (view === 'projects') return location.pathname.startsWith('/projects')
    if (view === 'pullRequests') return location.pathname.startsWith('/pull-requests')
    return location.pathname === `/${view}`
  }

  const previousActiveSessionIdRef = useRef<string | null | undefined>(undefined)
  const pendingContainerRevealIdRef = useRef<string | null>(activeSessionId)
  useEffect(() => {
    if (previousActiveSessionIdRef.current !== activeSessionId) {
      previousActiveSessionIdRef.current = activeSessionId
      pendingContainerRevealIdRef.current = activeSessionId
    }
    if (!activeSessionId || pendingContainerRevealIdRef.current !== activeSessionId) {
      return
    }

    if (timeline) {
      pendingContainerRevealIdRef.current = null
      return
    }

    const sessionExists = viewModel.visibleSessions.some(
      (session) => session.id === activeSessionId,
    )
    if (!sessionExists) return
    const pinnedSession = viewModel.pinnedSessions.some((session) => session.id === activeSessionId)
    const pinnedProject = viewModel.pinnedWorkspaces.find((project) =>
      viewModel.projectSessionBuckets
        .get(sidebarProjectKey(project))
        ?.displaySessions.some((session) => session.id === activeSessionId),
    )
    const project =
      sidebarOrganization === 'projects'
        ? viewModel.projectWorkspaces.find((projectEntry) =>
            viewModel.projectSessionBuckets
              .get(sidebarProjectKey(projectEntry))
              ?.displaySessions.some((session) => session.id === activeSessionId),
          )
        : undefined
    const recent = viewModel.recentSessions.some((session) => session.id === activeSessionId)

    if (!pinnedSession && !pinnedProject && !project && !recent) return
    pendingContainerRevealIdRef.current = null

    if (pinnedSession || pinnedProject) {
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('pinned'), true)
      if (pinnedProject) {
        sidebarDisclosureState.setProjectExpanded(pinnedProject, true)
      }
      return
    }
    if (project) {
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('projects'), true)
      sidebarDisclosureState.setProjectExpanded(project, true)
      return
    }
    if (recent)
      sidebarDisclosureState.store.setExpanded(sidebarSectionDisclosureKey('recent'), true)
  }, [activeSessionId, sidebarDisclosureState, sidebarOrganization, timeline, viewModel])

  function pinSession(session: SessionListItem): void {
    setSidebarSessionPins((current) => ({
      ...current,
      [session.id]: new Date().toISOString(),
    }))
  }

  function unpinSession(session: SessionListItem): void {
    setSidebarSessionPins((current) => {
      const { [session.id]: _removed, ...next } = current
      return next
    })
    removePinnedManualOrder([sidebarPinnedSessionKey(session)])
  }

  function toggleSessionUnread(session: SessionListItem): void {
    const operation = session.unreadAt
      ? desktopClient.markSessionRead(session.id, session.unreadAt)
      : desktopClient.markSessionUnread(session.id, new Date().toISOString())
    void operation.catch(() => {
      onReport('更新会话已读状态失败，请重试。')
    })
  }

  async function archiveSessions(targetSessions: readonly SessionListItem[]): Promise<boolean> {
    const targetKeys = targetSessions.map((session) => sidebarPinnedSessionKey(session))
    const capturedAssignments = captureSidebarAssignments(
      sidebarCustomizationRef.current,
      targetKeys,
    )
    const result = await onArchiveSessions(targetSessions.map((session) => session.id))
    if (result.failedSessionIds.length > 0) {
      // 部分失败时只回滚失败条目的分组归属，成功归档的保持移除。
      updateSidebarCustomization((current) =>
        restoreFailedArchiveAssignments(
          current,
          result.failedSessionIds.map((sessionId) => `session:${sessionId}`),
          capturedAssignments,
        ),
      )
    }
    if (result.succeededSessionIds.length > 0) {
      const removedIds = new Set(result.succeededSessionIds)
      setSidebarSessionPins((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sessionId]) => !removedIds.has(sessionId)),
        ),
      )
      removePinnedManualOrder(result.succeededSessionIds.map((sessionId) => `session:${sessionId}`))
    }
    if (result.failedSessionIds.length > 0) {
      onReport(
        `已归档 ${result.succeededSessionIds.length} 个任务，${result.failedSessionIds.length} 个失败。`,
      )
      return false
    }
    if (result.succeededSessionIds.length > 1) {
      onReport(`已归档 ${result.succeededSessionIds.length} 个任务。`)
    }
    return true
  }

  const removePinnedManualOrder = useCallback(
    (keys: readonly string[]): void => {
      if (keys.length === 0) return
      const removedKeys = new Set(keys)
      setSidebarManualOrder((current) => {
        const pinnedItems = current['pinned-items']
        if (!pinnedItems?.some((key) => removedKeys.has(key))) return current
        const nextPinnedItems = pinnedItems.filter((key) => !removedKeys.has(key))
        if (nextPinnedItems.length > 0) {
          return {
            ...current,
            'pinned-items': nextPinnedItems,
          }
        }
        const { ['pinned-items']: _removed, ...next } = current
        return next
      })
    },
    [setSidebarManualOrder],
  )

  const updateSidebarCustomization = useCallback(
    (updater: (current: SidebarCustomization) => SidebarCustomization): void => {
      setSidebarCustomization((current) => updater(current ?? DEFAULT_SIDEBAR_CUSTOMIZATION))
    },
    [setSidebarCustomization],
  )

  const createCustomSection = useCallback((): void => {
    const id = `section-${crypto.randomUUID().slice(0, 8)}`
    updateSidebarCustomization((current) => addSidebarSection(current, id))
  }, [updateSidebarCustomization])

  /** 拖入自定义分组：移除置顶与旧归属，按插入位置写入目标分组。 */
  const moveItemsToDestination = useCallback(
    (itemKeys: readonly string[], sectionId: string, index?: number): void => {
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        const sessionIds = new Set(sessionKeys.map((key) => key.slice('session:'.length)))
        setSidebarSessionPins((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([sessionId]) => !sessionIds.has(sessionId)),
          ),
        )
        removePinnedManualOrder(sessionKeys)
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      let offset = 0
      for (const key of itemKeys) {
        const target = index === undefined ? undefined : index + offset
        updateSidebarCustomization((current) => moveItemToSection(current, sectionId, key, target))
        offset += 1
      }
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt: null }
              : workspace,
          ),
        )
        removePinnedManualOrder(projectKeys)
      }
    },
    [
      removePinnedManualOrder,
      setRecentWorkspaces,
      setSidebarSessionPins,
      updateSidebarCustomization,
    ],
  )

  /** 拖入置顶区：移除自定义归属、取消旧置顶顺序后按插入位置置顶。 */
  const pinItemsToTop = useCallback(
    (itemKeys: readonly string[], index?: number): void => {
      updateSidebarCustomization((current) => removeItemsFromSections(current, itemKeys))
      const pinnedAt = new Date().toISOString()
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        setSidebarSessionPins((current) => {
          const next = { ...current }
          for (const key of sessionKeys) next[key.slice('session:'.length)] = pinnedAt
          return next
        })
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt }
              : workspace,
          ),
        )
      }
      if (index !== undefined) {
        setSidebarManualOrder((current) => {
          const existing = (current['pinned-items'] ?? []).filter((key) => !itemKeys.includes(key))
          const insertAt = Math.max(0, Math.min(index, existing.length))
          const nextPinned = [
            ...existing.slice(0, insertAt),
            ...itemKeys,
            ...existing.slice(insertAt),
          ]
          return { ...current, 'pinned-items': nextPinned }
        })
      }
    },
    [setRecentWorkspaces, setSidebarManualOrder, setSidebarSessionPins, updateSidebarCustomization],
  )

  /** 拖入默认区域：移除自定义归属并取消置顶，回到真实项目或平铺列表。 */
  const releaseItemsToDefault = useCallback(
    (itemKeys: readonly string[]): void => {
      updateSidebarCustomization((current) => removeItemsFromSections(current, itemKeys))
      const sessionKeys = itemKeys.filter((key) => key.startsWith('session:'))
      if (sessionKeys.length > 0) {
        const sessionIds = new Set(sessionKeys.map((key) => key.slice('session:'.length)))
        setSidebarSessionPins((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([sessionId]) => !sessionIds.has(sessionId)),
          ),
        )
      }
      const projectKeys = itemKeys.filter((key) => key.startsWith('project:'))
      if (projectKeys.length > 0) {
        setRecentWorkspaces((current) =>
          current.map((workspace) =>
            projectKeys.includes(sidebarPinnedProjectKey(workspace))
              ? { ...workspace, pinnedAt: null }
              : workspace,
          ),
        )
      }
      removePinnedManualOrder(itemKeys)
    },
    [removePinnedManualOrder, setRecentWorkspaces, setSidebarSessionPins, updateSidebarCustomization],
  )

  const updateManualOrder = useCallback(
    (scopeKey: string, order: string[]): void => {
      setSidebarManualOrder((current) => ({
        ...current,
        [scopeKey]: order,
      }))
    },
    [setSidebarManualOrder],
  )

  return (
    <div className="sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:py-2">
      <SidebarHeader
        showActions={active}
        hasUnread={hasUnread}
        onOpenCommandMenu={onOpenCommandMenu}
      />
      <SidebarNewTaskNav
        label="新聊天"
        isActiveView={isActiveView}
        scrollOverlapping={sidebarScrollOverlapping}
      />
      <SidebarBody
        onScrollOverlapChange={setSidebarScrollOverlapping}
        scrollHeader={
          <>
            {catalogStatus.state === 'loading' ? (
              <SidebarEmptyRow role="status">正在加载任务目录…</SidebarEmptyRow>
            ) : null}
          </>
        }
        projectCatalogState={projectCatalogState}
        scrollModeKey={sidebarScrollModeKey}
        scrollPositions={sidebarScrollPositionsRef.current}
        activeSessionId={activeSessionId}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        disclosureStore={sidebarDisclosureState.store}
        organization={sidebarOrganization}
        timeline={timeline}
        showTimelinePinned={sidebarActivityShowPinned}
        showActivityWork={sidebarActivityShowWork}
        showActivityChat={sidebarActivityShowChat}
        showScheduledSessions={sidebarShowScheduledSessions}
        onShowScheduledSessionsChange={setSidebarShowScheduledSessions}
        onShowActivityWorkChange={setSidebarActivityShowWork}
        onShowActivityChatChange={setSidebarActivityShowChat}
        onShowTimelinePinnedChange={setSidebarActivityShowPinned}
        now={relativeNow}
        pinnedSessions={viewModel.pinnedSessions}
        pinnedWorkspaces={viewModel.pinnedWorkspaces}
        projectSessionBuckets={viewModel.projectSessionBuckets}
        projectWorkspaces={viewModel.projectWorkspaces}
        projectSort={sidebarProjectSort}
        sessionFallbackTitles={sessionFallbackTitles}
        recentSessions={viewModel.recentSessions}
        sessionSort={sidebarSort}
        manualOrderByScope={sidebarManualOrder}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        workspace={workspace}
        onArchiveSessions={archiveSessions}
        onChooseWorkspace={onChooseWorkspace}
        onCreateSession={onCreateSession}
        onPinSession={pinSession}
        onPinWorkspace={onPinWorkspace}
        onRemoveWorkspace={(target) => {
          removeCatalogProject(target)
          removePinnedManualOrder([sidebarPinnedProjectKey(target)])
          onRemoveWorkspace(target)
        }}
        onSelectSession={onSelectSession}
        onToggleSessionUnread={toggleSessionUnread}
        onRenameSession={onRenameSession}
        onUnpinSession={unpinSession}
        onUnpinWorkspace={(target) => {
          removePinnedManualOrder([sidebarPinnedProjectKey(target)])
          onUnpinWorkspace(target)
        }}
        onReport={onReport}
        customSections={viewModel.customSections}
        pinnedSort={sidebarCustomization.pinnedSort}
        onPinnedSortChange={(pinnedSort) =>
          updateSidebarCustomization((current) => ({ ...current, pinnedSort }))
        }
        onManualOrderChange={updateManualOrder}
        onCreateSection={createCustomSection}
        onRenameSection={(sectionId, title) =>
          updateSidebarCustomization((current) => renameSidebarSection(current, sectionId, title))
        }
        onDeleteSection={(sectionId) =>
          updateSidebarCustomization((current) => deleteSidebarSection(current, sectionId))
        }
        onSetSectionCollapsed={(sectionId, collapsed) =>
          updateSidebarCustomization((current) =>
            setSidebarSectionCollapsed(current, sectionId, collapsed),
          )
        }
        onSetSectionSort={(sectionId, sort) =>
          updateSidebarCustomization((current) => setSidebarSectionSort(current, sectionId, sort))
        }
        onReorderSectionItems={(sectionId, keys) =>
          updateSidebarCustomization((current) => setSidebarSectionItems(current, sectionId, keys))
        }
        onMoveItemsToSection={(itemKeys, sectionId, index) => {
          moveItemsToDestination(itemKeys, sectionId, index)
        }}
        onMoveItemsToPinned={(itemKeys, index) => {
          pinItemsToTop(itemKeys, index)
        }}
        onMoveItemsToDefault={(itemKeys) => {
          releaseItemsToDefault(itemKeys)
        }}
        onRestoreItemsToProject={(itemKeys) => {
          releaseItemsToDefault(itemKeys)
        }}
        onMoveSessionToSection={(sessionId, sectionId) =>
          moveItemsToDestination([`session:${sessionId}`], sectionId)
        }
        onMoveSessionToDefault={(sessionId) =>
          releaseItemsToDefault([`session:${sessionId}`])
        }
        onOrganizationChange={setSidebarOrganization}
        onProjectSortChange={setSidebarProjectSort}
        onSessionSortChange={setSidebarSort}
        hasUnreadAttention={attentionUnreadSessions.length > 0}
        hasArchivableAttention={archivableAttentionSessions.length > 0}
        onMarkAttentionRead={() => void markAttentionRead()}
        onRequestArchiveAttention={requestArchiveAttention}
      />
      {dockedPanesState && dockedPanesState.tabIds.length > 0 ? (
        <SidebarDockedPanes
          files={workspaceFiles ?? []}
          state={dockedPanesState}
          tabsById={dockedTabsById ?? {}}
          workspace={workspace}
          onAddComposerFiles={onAddComposerFiles}
          onCloseTab={onCloseDockedTab ?? (() => undefined)}
          onMoveTab={onMoveDockedTab ?? (() => undefined)}
          onPopOutTab={onPopOutDockedTab}
          onOpenFile={onOpenFile}
          onSelectTab={onSelectDockedTab ?? (() => undefined)}
        />
      ) : null}
      {archiveAttentionDialogMounted ? (
        <Suspense fallback={null}>
          <ConfirmationDialog
            actionDisabled={archivingAttention}
            actionLabel={archivingAttention ? '归档中…' : '归档任务'}
            description={`将归档 ${archivableAttentionSessions.length} 个已完成的任务；等待问题、权限或计划审批的任务不会被归档。`}
            open={archiveAttentionOpen}
            title="归档需要关注的任务？"
            tone="danger"
            onAction={() => void confirmArchiveAttention()}
            onCancel={() => setArchiveAttentionOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function sidebarDisclosureSignature(
  sections: readonly string[],
  projects: readonly string[],
): string {
  return `${sections.join('\u0000')}\u0001${projects.join('\u0000')}`
}
