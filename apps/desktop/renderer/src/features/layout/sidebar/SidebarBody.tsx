import type React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Ellipsis, Plus, SquarePen } from "lucide-react";
import { AnimatePresence, motion, Reorder, useIsPresent } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import type {
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopWorkspace,
  SidebarSectionId,
} from "../../../../shared/types.js";
import type { SessionListItem } from "../../../uiTypes.js";
import { Button } from "../../../components/ui/Button.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import {
  PopoverCheckboxItem,
  PopoverItem,
  PopoverLabel,
  PopoverRadioGroup,
  PopoverRadioItem,
  PopoverSeparator,
} from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { DisclosureContent } from "../../../components/ui/DisclosureContent.js";
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from "../../../components/ui/keyedDisclosureStore.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import {
  fastTween,
  motionTransition,
  standardTween,
} from "../../motion/motionTransitions.js";
import { SidebarEmptyRow } from "./SidebarRow.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarReorderItem } from './SidebarReorderItem.js'
import {
  getSidebarSessionDisplayGroups,
  SidebarSessionGroup,
} from "./SidebarSessionGroup.js";
import {
  buildSidebarPinnedItems,
  clampTimelineVisibleLimit,
  normalizeSidebarPath,
  reorderSidebarPinnedItemKeys,
  sidebarProjectKey,
  type SidebarFocusSection,
  type SidebarPinnedItem,
  type SidebarProjectSessionBucket,
  type SidebarTimelineModel,
  sliceSidebarTimelineModel,
} from "./sidebarViewModel.js";
import { cx } from "../../../utils/cx.js";
import type { SidebarProjectCatalogState } from './useSidebarProjectCatalog.js'
import {
  type SidebarScrollModeKey,
  useSidebarScrollController,
} from './useSidebarScrollController.js'
import { sidebarSectionDisclosureKey } from './sidebarDisclosureStore.js'

const PINNED_INITIAL_LIMIT = 20;
const PINNED_LIMIT_STEP = 20;

type Props = {
  activeSessionId: string | null;
  disclosureStore: KeyedDisclosureStore;
  organization: DesktopSidebarOrganization;
  timeline?: SidebarTimelineModel | null;
  showTimelinePinned: boolean;
  showActivityWork: boolean;
  showActivityChat: boolean;
  onShowActivityWorkChange: (value: boolean) => void;
  onShowActivityChatChange: (value: boolean) => void;
  now: number;
  pendingPermissionSessionIds: ReadonlySet<string>;
  titleLoadingIds: ReadonlySet<string>;
  pinnedSessions: SessionListItem[];
  pinnedWorkspaces: DesktopWorkspace[];
  projectSessionBuckets: ReadonlyMap<string, SidebarProjectSessionBucket>;
  projectWorkspaces: DesktopWorkspace[];
  projectSort: DesktopSidebarSort;
  recentSessions: SessionListItem[];
  sessionFallbackTitles: Record<string, string>;
  sessionSort: DesktopSidebarSort;
  manualOrderByScope: Record<string, string[]>;
  unavailableWorkspacePaths: Set<string>;
  workspace: DesktopWorkspace | null;
  /** 位于滚动视口最前端的次级导航与加载/错误提示。 */
  scrollHeader: React.ReactNode;
  /** 滚动视口是否已滚过固定入口（scrollTop > 0），驱动动态分隔线。 */
  onScrollOverlapChange: (overlapping: boolean) => void;
  projectCatalogState: SidebarProjectCatalogState;
  scrollModeKey: SidebarScrollModeKey;
  scrollPositions: Map<SidebarScrollModeKey, number>;
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onPinSession: (session: SessionListItem) => void;
  onPinWorkspace: (workspace: DesktopWorkspace) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleSessionUnread: (session: SessionListItem) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onUnpinSession: (session: SessionListItem) => void;
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void;
  onReport: (message: string) => void;
  onManualOrderChange: (scopeKey: string, order: string[]) => void;
  onOrganizationChange: (organization: DesktopSidebarOrganization) => void;
  onProjectSortChange: (sort: DesktopSidebarSort) => void;
  onSessionSortChange: (sort: DesktopSidebarSort) => void;
  hasUnreadAttention: boolean;
  hasArchivableAttention: boolean;
  onMarkAttentionRead: () => void;
  onRequestArchiveAttention: () => void;
  onShowTimelinePinnedChange: (value: boolean) => void;
};

export function SidebarBody({
  activeSessionId,
  disclosureStore,
  organization,
  timeline,
  showTimelinePinned,
  showActivityWork,
  showActivityChat,
  onShowActivityWorkChange,
  onShowActivityChatChange,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  pinnedSessions,
  pinnedWorkspaces,
  projectSessionBuckets,
  projectWorkspaces,
  projectSort,
  recentSessions,
  sessionFallbackTitles,
  sessionSort,
  manualOrderByScope,
  unavailableWorkspacePaths,
  workspace,
  scrollHeader,
  onScrollOverlapChange,
  projectCatalogState,
  scrollModeKey,
  scrollPositions,
  onArchiveSessions,
  onChooseWorkspace,
  onCreateSession,
  onPinSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onUnpinSession,
  onUnpinWorkspace,
  onReport,
  onManualOrderChange,
  onOrganizationChange,
  onProjectSortChange,
  onSessionSortChange,
  hasUnreadAttention,
  hasArchivableAttention,
  onMarkAttentionRead,
  onRequestArchiveAttention,
  onShowTimelinePinnedChange,
}: Props): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  const [visibleProjectLimit, setVisibleProjectLimit] = useState(5);
  const [visiblePinnedLimit, setVisiblePinnedLimit] = useState(
    PINNED_INITIAL_LIMIT,
  );
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null)
  const [draggingPinnedItemKey, setDraggingPinnedItemKey] = useState<
    string | null
  >(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const { onScroll } = useSidebarScrollController({
    activeSessionId,
    modeKey: scrollModeKey,
    positions: scrollPositions,
    viewportRef: scrollViewportRef,
    onScrollOverlapChange,
  })
  const unavailablePaths = useMemo(
    () =>
      new Set(
        [...unavailableWorkspacePaths].map((path) =>
          normalizeSidebarPath(path),
        ),
      ),
    [unavailableWorkspacePaths],
  );
  const pinnedItems = useMemo(
    () =>
      buildSidebarPinnedItems({
        pinnedSessions,
        pinnedWorkspaces,
        storedOrder: manualOrderByScope["pinned-items"] ?? [],
      }),
    [manualOrderByScope, pinnedSessions, pinnedWorkspaces],
  );
  const canonicalProjectOrder = useMemo(
    () => projectWorkspaces.map(sidebarProjectKey),
    [projectWorkspaces],
  )
  const [projectOrder, setProjectOrder] = useState(canonicalProjectOrder)
  const projectOrderRef = useRef(projectOrder)
  const orderedProjects = useMemo(
    () => orderItemsByKeys(projectWorkspaces, projectOrder, sidebarProjectKey),
    [projectOrder, projectWorkspaces],
  )
  const {
    baseSessions: baseProjects,
    canCollapse: canCollapseProjects,
    canShowMore: canShowMoreProjects,
    extraSessions: extraProjects,
    hasOverflow: hasProjectOverflow,
  } = getSidebarSessionDisplayGroups(orderedProjects, visibleProjectLimit);
  const displayedProjects = [...baseProjects, ...extraProjects];
  const canonicalPinnedSessionOrder = useMemo(
    () => pinnedItems.filter(item => item.kind === 'session').map(item => item.key),
    [pinnedItems],
  )
  const canonicalPinnedProjectOrder = useMemo(
    () => pinnedItems.filter(item => item.kind === 'project').map(item => item.key),
    [pinnedItems],
  )
  const [pinnedSessionOrder, setPinnedSessionOrder] = useState(
    canonicalPinnedSessionOrder,
  )
  const [pinnedProjectOrder, setPinnedProjectOrder] = useState(
    canonicalPinnedProjectOrder,
  )
  const pinnedSessionOrderRef = useRef(pinnedSessionOrder)
  const pinnedProjectOrderRef = useRef(pinnedProjectOrder)
  const orderedPinnedItems = useMemo(() => {
    const sessions = pinnedItems.filter(item => item.kind === 'session')
    const projects = pinnedItems.filter(item => item.kind === 'project')
    return [
      ...orderItemsByKeys(sessions, pinnedSessionOrder, item => item.key),
      ...orderItemsByKeys(projects, pinnedProjectOrder, item => item.key),
    ]
  }, [pinnedItems, pinnedProjectOrder, pinnedSessionOrder])
  const {
    baseSessions: basePinnedItems,
    canCollapse: canCollapsePinnedItems,
    canShowMore: canShowMorePinnedItems,
    extraSessions: extraPinnedItems,
    hasOverflow: hasPinnedItemOverflow,
  } = getSidebarSessionDisplayGroups(
    orderedPinnedItems,
    visiblePinnedLimit,
    PINNED_INITIAL_LIMIT,
  );
  const displayedPinnedItems = [...basePinnedItems, ...extraPinnedItems];
  const displayedPinnedSessions = displayedPinnedItems.filter(
    item => item.kind === 'session',
  )
  const displayedPinnedProjects = displayedPinnedItems.filter(
    item => item.kind === 'project',
  )
  const pinnedSessionValues = orderedPinnedItems
    .filter(item => item.kind === 'session')
    .map(item => item.key)
  const pinnedProjectValues = orderedPinnedItems
    .filter(item => item.kind === 'project')
    .map(item => item.key)

  useEffect(() => {
    if (draggingProjectKey) return
    projectOrderRef.current = canonicalProjectOrder
    setProjectOrder(current =>
      sameStringOrder(current, canonicalProjectOrder)
        ? current
        : canonicalProjectOrder,
    )
  }, [canonicalProjectOrder, draggingProjectKey])

  useEffect(() => {
    if (draggingPinnedItemKey) return
    pinnedSessionOrderRef.current = canonicalPinnedSessionOrder
    pinnedProjectOrderRef.current = canonicalPinnedProjectOrder
    setPinnedSessionOrder(current =>
      sameStringOrder(current, canonicalPinnedSessionOrder)
        ? current
        : canonicalPinnedSessionOrder,
    )
    setPinnedProjectOrder(current =>
      sameStringOrder(current, canonicalPinnedProjectOrder)
        ? current
        : canonicalPinnedProjectOrder,
    )
  }, [
    canonicalPinnedProjectOrder,
    canonicalPinnedSessionOrder,
    draggingPinnedItemKey,
  ])

  useEffect(() => {
    if (!activeSessionId) return

    const pinnedIndex = pinnedItems.findIndex(item =>
      item.kind === 'session'
        ? item.session.id === activeSessionId
        : projectSessionBuckets
            .get(sidebarProjectKey(item.project))
            ?.displaySessions.some(session => session.id === activeSessionId),
    )
    if (pinnedIndex >= 0) {
      setVisiblePinnedLimit(current => Math.max(current, pinnedIndex + 1))
      return
    }

    const projectIndex = organization === 'projects'
      ? projectWorkspaces.findIndex(project =>
          projectSessionBuckets
            .get(sidebarProjectKey(project))
            ?.displaySessions.some(session => session.id === activeSessionId),
        )
      : -1
    if (projectIndex >= 0) {
      setVisibleProjectLimit(current => Math.max(current, projectIndex + 1))
    }
  }, [
    activeSessionId,
    pinnedItems,
    organization,
    projectSessionBuckets,
    projectWorkspaces,
  ])

  useEffect(() => {
    const activeProjectIndex = activeSessionId && organization === 'projects'
      ? projectWorkspaces.findIndex(project =>
          projectSessionBuckets
            .get(sidebarProjectKey(project))
            ?.displaySessions.some(session => session.id === activeSessionId),
        )
      : -1
    setVisibleProjectLimit(
      activeProjectIndex < 0 ? 5 : Math.max(5, activeProjectIndex + 1),
    )
  }, [organization]);

  function isUnavailable(project: DesktopWorkspace): boolean {
    return unavailablePaths.has(normalizeSidebarPath(project.path));
  }

  function moveProject(
    projects: readonly DesktopWorkspace[],
    scopeKey: string,
    sourceKey: string,
    targetKey: string,
  ): void {
    if (sourceKey === targetKey) return;
    const order = projects.map(sidebarProjectKey);
    const sourceIndex = order.indexOf(sourceKey);
    const targetIndex = order.indexOf(targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = order.splice(sourceIndex, 1);
    if (!moved) return;
    order.splice(targetIndex, 0, moved);
    onManualOrderChange(scopeKey, order);
    onProjectSortChange('manual')
  }

  function renderProjectGroup(project: DesktopWorkspace): React.ReactNode {
    return (
      <SidebarProjectGroup
        activeSessionId={activeSessionId}
        bucket={
          projectSessionBuckets.get(sidebarProjectKey(project)) ??
          EMPTY_PROJECT_SESSION_BUCKET
        }
        disclosureStore={disclosureStore}
        isUnavailable={isUnavailable(project)}
        manualOrderByScope={manualOrderByScope}
        now={now}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        project={project}
        sessionFallbackTitles={sessionFallbackTitles}
        sort={projectSort}
        workspace={workspace}
        onArchiveSessions={onArchiveSessions}
        onCreateSession={onCreateSession}
        onManualOrderChange={onManualOrderChange}
        onPinSession={onPinSession}
        onPinWorkspace={onPinWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
        onReport={onReport}
        onSelectSession={onSelectSession}
        onToggleSessionUnread={onToggleSessionUnread}
        onRenameSession={onRenameSession}
        onSortChange={onProjectSortChange}
        onUnpinSession={onUnpinSession}
        onUnpinWorkspace={onUnpinWorkspace}
      />
    );
  }

  function renderProject(project: DesktopWorkspace): React.ReactNode {
    const key = sidebarProjectKey(project);
    return (
      <SidebarReorderItem
        className="sidebar-project-sortable"
        dragHandleSelector=".sidebar-project-header"
        key={key}
        reducedMotion={reducedMotion}
        value={key}
        onReorderDragEnd={() => {
          const finalOrder = projectOrderRef.current
          setDraggingProjectKey(null)
          onManualOrderChange('projects', finalOrder)
          onProjectSortChange('manual')
        }}
        onReorderDragStart={() => {
          projectOrderRef.current = orderedProjects.map(sidebarProjectKey)
          setDraggingProjectKey(key)
        }}
        onKeyDownCapture={(event) => {
          if (
            !event.altKey ||
            (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
            isTextEntry(event.target) ||
            !(event.target as Element).closest(".sidebar-project-button")
          ) {
            return;
          }
          const order = orderedProjects.map(sidebarProjectKey);
          const index = order.indexOf(key);
          const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
          const target = order[targetIndex];
          if (index < 0 || !target) return;
          event.preventDefault();
          moveProject(orderedProjects, 'projects', key, target);
        }}
      >
        {renderProjectGroup(project)}
      </SidebarReorderItem>
    );
  }

  function movePinnedItem(sourceKey: string, targetKey: string): void {
    const order = reorderSidebarPinnedItemKeys(
      orderedPinnedItems,
      sourceKey,
      targetKey,
    );
    if (order) onManualOrderChange("pinned-items", order);
  }

  function renderPinnedItem(item: SidebarPinnedItem): React.ReactNode {
    const shortcutTargetSelector =
      item.kind === "session"
        ? ".sidebar-session-button"
        : ".sidebar-project-button";
    return (
      <SidebarReorderItem
        className="sidebar-project-sortable"
        data-sidebar-pinned-item-key={item.key}
        dragHandleSelector={
          item.kind === 'project' ? '.sidebar-project-header' : undefined
        }
        key={item.key}
        reducedMotion={reducedMotion}
        value={item.key}
        onReorderDragEnd={() => {
          const finalOrder = [
            ...pinnedSessionOrderRef.current,
            ...pinnedProjectOrderRef.current,
          ]
          setDraggingPinnedItemKey(null)
          onManualOrderChange('pinned-items', finalOrder)
        }}
        onReorderDragStart={() => {
          setDraggingPinnedItemKey(item.key);
        }}
        onKeyDownCapture={(event) => {
          if (
            !event.altKey ||
            (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
            isTextEntry(event.target) ||
            !(event.target as Element).closest(shortcutTargetSelector)
          ) {
            return;
          }
          const index = orderedPinnedItems.findIndex(
            (entry) => entry.key === item.key,
          );
          const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
          const target = orderedPinnedItems[targetIndex];
          // 到达会话/文件夹分界时停止，不跨组移动
          if (index < 0 || !target || target.kind !== item.kind) return;
          event.preventDefault();
          event.stopPropagation();
          movePinnedItem(item.key, target.key);
        }}
      >
        {item.kind === "project" ? (
          renderProjectGroup(item.project)
        ) : (
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            groupKey={`pinned-item:${item.session.id}`}
            now={now}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            titleLoadingIds={titleLoadingIds}
            sessionFallbackTitles={sessionFallbackTitles}
            sessions={[item.session]}
            showConversationIcon
            onArchiveSessions={onArchiveSessions}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleSessionUnread={onToggleSessionUnread}
            onRenameSession={onRenameSession}
            onUnpinSession={onUnpinSession}
          />
        )}
      </SidebarReorderItem>
    );
  }

  return (
    <ScrollArea
      className="sidebar-scroll-area tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="sidebar-scroll-content"
      viewportRef={scrollViewportRef}
      onScroll={onScroll}
    >
      {scrollHeader}
      {/* 次级导航与时间线/任务主体之间的分组间距，不再占用整个滚动视口的外边距 */}
      <div className="sidebar-scroll-main">
        {timeline ? (
          <Timeline
            activeSessionId={activeSessionId}
            hasArchivableAttention={hasArchivableAttention}
            hasUnreadAttention={hasUnreadAttention}
            now={now}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            showWork={showActivityWork}
            showChat={showActivityChat}
            showPinned={showTimelinePinned}
            timeline={timeline}
            titleLoadingIds={titleLoadingIds}
            sessionFallbackTitles={sessionFallbackTitles}
            onArchiveSessions={onArchiveSessions}
            onMarkAttentionRead={onMarkAttentionRead}
            onPinSession={onPinSession}
            onRequestArchiveAttention={onRequestArchiveAttention}
            onSelectSession={onSelectSession}
            onToggleSessionUnread={onToggleSessionUnread}
            onRenameSession={onRenameSession}
            onShowWorkChange={onShowActivityWorkChange}
            onShowChatChange={onShowActivityChatChange}
            onShowPinnedChange={onShowTimelinePinnedChange}
            onUnpinSession={onUnpinSession}
          />
        ) : (
        <div className="sidebar-standard-mode sidebar-section-group tw:flex tw:min-w-0 tw:flex-col">
          <AnimatePresence initial={false}>
          {pinnedItems.length > 0 ? (
            <SidebarSectionPresence key="pinned" reducedMotion={reducedMotion}>
            <SidebarSection
              disclosureStore={disclosureStore}
              sectionId="pinned"
              title="置顶"
            >
              {displayedPinnedSessions.length > 0 ? (
                <Reorder.Group
                  as="div"
                  axis="y"
                  className="sidebar-reorder-group"
                  values={pinnedSessionValues}
                  onReorder={nextOrder => {
                    if (sameStringOrder(pinnedSessionOrderRef.current, nextOrder)) return
                    pinnedSessionOrderRef.current = nextOrder
                    setPinnedSessionOrder(nextOrder)
                  }}
                >
                  {displayedPinnedSessions.map(renderPinnedItem)}
                </Reorder.Group>
              ) : null}
              {displayedPinnedProjects.length > 0 ? (
                <Reorder.Group
                  as="div"
                  axis="y"
                  className="sidebar-reorder-group"
                  values={pinnedProjectValues}
                  onReorder={nextOrder => {
                    if (sameStringOrder(pinnedProjectOrderRef.current, nextOrder)) return
                    pinnedProjectOrderRef.current = nextOrder
                    setPinnedProjectOrder(nextOrder)
                  }}
                >
                  {displayedPinnedProjects.map(renderPinnedItem)}
                </Reorder.Group>
              ) : null}
              {hasPinnedItemOverflow ? (
                <SidebarShowMoreActions
                  canCollapse={canCollapsePinnedItems}
                  canShowMore={canShowMorePinnedItems}
                  onCollapse={() => setVisiblePinnedLimit(PINNED_INITIAL_LIMIT)}
                  onShowMore={() =>
                    setVisiblePinnedLimit(current =>
                      Math.min(
                        current + PINNED_LIMIT_STEP,
                        pinnedItems.length,
                      ),
                    )
                  }
                />
              ) : null}
            </SidebarSection>
            </SidebarSectionPresence>
          ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
          {organization === "projects" ? (
            <SidebarSectionPresence key="projects" reducedMotion={reducedMotion}>
            <SidebarSection
              action={
                <SidebarSectionActions>
                  <SidebarOrganizeMenu
                    organization={organization}
                    sort={projectSort}
                    onOrganizationChange={onOrganizationChange}
                    onSortChange={onProjectSortChange}
                  />
                  <IconButton
                    color="ghostSecondary"
                    onClick={onChooseWorkspace}
                    size="toolbar"
                    title="添加项目"
                  >
                    <Plus size={APP_ICON_SIZE} />
                  </IconButton>
                </SidebarSectionActions>
              }
              disclosureStore={disclosureStore}
              sectionId="projects"
              title="项目"
            >
              {projectCatalogState.status === 'loading' ? (
                <SidebarEmptyRow role="status">正在加载项目…</SidebarEmptyRow>
              ) : projectCatalogState.status === 'unavailable' &&
                projectCatalogState.projects.length === 0 ? (
                <SidebarEmptyRow role="status">
                  {projectCatalogState.error || '项目目录暂时不可用。'}
                </SidebarEmptyRow>
              ) : null}
              {projectWorkspaces.length > 0 ? (
                <>
                  <Reorder.Group
                    as="div"
                    axis="y"
                    className="sidebar-reorder-group"
                    values={orderedProjects.map(sidebarProjectKey)}
                    onReorder={nextOrder => {
                      if (sameStringOrder(projectOrderRef.current, nextOrder)) return
                      projectOrderRef.current = nextOrder
                      setProjectOrder(nextOrder)
                    }}
                  >
                    {displayedProjects.map(renderProject)}
                  </Reorder.Group>
                  {hasProjectOverflow ? (
                    <SidebarShowMoreActions
                      canCollapse={canCollapseProjects}
                      canShowMore={canShowMoreProjects}
                      onCollapse={() => setVisibleProjectLimit(5)}
                      onShowMore={() =>
                        setVisibleProjectLimit((current) =>
                          Math.min(current + 5, projectWorkspaces.length),
                        )
                      }
                    />
                  ) : null}
                </>
              ) : projectCatalogState.status === 'ready' ? (
                <SidebarEmptyRow>暂无项目</SidebarEmptyRow>
              ) : null}
            </SidebarSection>
            </SidebarSectionPresence>
        ) : null}
          </AnimatePresence>

          <SidebarSection
            action={
              <SidebarSectionActions>
                <SidebarOrganizeMenu
                  organization={organization}
                  sort={sessionSort}
                  onOrganizationChange={onOrganizationChange}
                  onSortChange={onSessionSortChange}
                />
                <IconButton
                  color="ghostSecondary"
                  onClick={() => onCreateSession(null)}
                  size="toolbar"
                  title="新建无项目任务"
                >
                  <SquarePen size={APP_ICON_SIZE} />
                </IconButton>
              </SidebarSectionActions>
            }
            disclosureStore={disclosureStore}
            sectionId="recent"
            title="最近"
          >
            {recentSessions.length === 0 ? (
              <SidebarEmptyRow>
                {organization === "flat" ? "暂无任务" : "暂无无项目任务"}
              </SidebarEmptyRow>
            ) : (
              <SidebarSessionGroup
                activeSessionId={activeSessionId}
                groupKey="recent"
                manualOrderByScope={manualOrderByScope}
                now={now}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                titleLoadingIds={titleLoadingIds}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={recentSessions}
                sort={sessionSort}
                onArchiveSessions={onArchiveSessions}
                onManualOrderChange={onManualOrderChange}
                onPinSession={onPinSession}
                onSelectSession={onSelectSession}
                onToggleSessionUnread={onToggleSessionUnread}
                onRenameSession={onRenameSession}
                onSortChange={onSessionSortChange}
                onUnpinSession={onUnpinSession}
              />
            )}
          </SidebarSection>
        </div>
        )}
      </div>
    </ScrollArea>
  );
}

function Timeline({
  activeSessionId,
  hasArchivableAttention,
  hasUnreadAttention,
  now,
  pendingPermissionSessionIds,
  showWork,
  showChat,
  showPinned,
  timeline,
  titleLoadingIds,
  sessionFallbackTitles,
  onArchiveSessions,
  onMarkAttentionRead,
  onPinSession,
  onRequestArchiveAttention,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onShowWorkChange,
  onShowChatChange,
  onShowPinnedChange,
  onUnpinSession,
}: {
  activeSessionId: string | null
  hasArchivableAttention: boolean
  hasUnreadAttention: boolean
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  showWork: boolean
  showChat: boolean
  showPinned: boolean
  timeline: SidebarTimelineModel
  titleLoadingIds: ReadonlySet<string>
  sessionFallbackTitles: Record<string, string>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onMarkAttentionRead: () => void
  onPinSession: (session: SessionListItem) => void
  onRequestArchiveAttention: () => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onShowWorkChange: (value: boolean) => void
  onShowChatChange: (value: boolean) => void
  onShowPinnedChange: (value: boolean) => void
  onUnpinSession: (session: SessionListItem) => void
}): React.ReactNode {
  const [visibleLimit, setVisibleLimit] = useState(10)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const previousTotalRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    setVisibleLimit(10)
  }, [showWork, showChat, showPinned])

  const sliced = useMemo(
    () => sliceSidebarTimelineModel(timeline, visibleLimit),
    [timeline, visibleLimit],
  )

  useEffect(() => {
    const nextTotal = sliced.totalCount
    const previousTotal = previousTotalRef.current
    setVisibleLimit(current =>
      clampTimelineVisibleLimit({
        previousTotal,
        nextTotal,
        currentLimit: current,
      }),
    )
    previousTotalRef.current = nextTotal
  }, [sliced.totalCount])

  useEffect(() => {
    if (!sliced.hasMore || !sentinelRef.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setVisibleLimit(prev => prev + 10)
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [sliced.hasMore])

  const sharedSessionProps = {
    activeSessionId,
    now,
    pendingPermissionSessionIds,
    titleLoadingIds,
    sessionFallbackTitles,
    onArchiveSessions,
    onPinSession,
    onSelectSession,
    onToggleSessionUnread,
    onRenameSession,
    onUnpinSession,
  }

  const isCompletelyEmpty = sliced.totalCount === 0

  if (isCompletelyEmpty) {
    return (
      <div className="sidebar-timeline">
        <FocusSectionGroup
          action={
            <TimelinePriorityMenu
              hasArchivableAttention={hasArchivableAttention}
              hasUnreadAttention={hasUnreadAttention}
              showWork={showWork}
              showChat={showChat}
              showPinned={showPinned}
              onMarkAttentionRead={onMarkAttentionRead}
              onRequestArchiveAttention={onRequestArchiveAttention}
              onShowWorkChange={onShowWorkChange}
              onShowChatChange={onShowChatChange}
              onShowPinnedChange={onShowPinnedChange}
            />
          }
          emptyState="当前筛选下没有活动"
          section={{
            id: 'priority',
            label: '优先级',
            sessions: [],
          }}
          sort="preserve"
          {...sharedSessionProps}
        />
      </div>
    )
  }

  return (
    <div className="sidebar-timeline">
      {sliced.prioritySessions.length > 0 ? (
        <FocusSectionGroup
          action={
            <TimelinePriorityMenu
              hasArchivableAttention={hasArchivableAttention}
              hasUnreadAttention={hasUnreadAttention}
              showWork={showWork}
              showChat={showChat}
              showPinned={showPinned}
              onMarkAttentionRead={onMarkAttentionRead}
              onRequestArchiveAttention={onRequestArchiveAttention}
              onShowWorkChange={onShowWorkChange}
              onShowChatChange={onShowChatChange}
              onShowPinnedChange={onShowPinnedChange}
            />
          }
          section={{
            id: 'priority',
            label: '优先级',
            sessions: sliced.prioritySessions,
          }}
          sort="preserve"
          {...sharedSessionProps}
        />
      ) : (
        <div className="sidebar-focus-section-header tw:flex tw:justify-between tw:items-center">
          <h3 className="sidebar-focus-section-title">优先级</h3>
          <TimelinePriorityMenu
            hasArchivableAttention={hasArchivableAttention}
            hasUnreadAttention={hasUnreadAttention}
            showWork={showWork}
            showChat={showChat}
            showPinned={showPinned}
            onMarkAttentionRead={onMarkAttentionRead}
            onRequestArchiveAttention={onRequestArchiveAttention}
            onShowWorkChange={onShowWorkChange}
            onShowChatChange={onShowChatChange}
            onShowPinnedChange={onShowPinnedChange}
          />
        </div>
      )}
      {sliced.pinnedSessions.length > 0 ? (
        <FocusSectionGroup
          section={{
            id: 'pinned',
            label: '置顶',
            sessions: sliced.pinnedSessions,
          }}
          sort="updated"
          {...sharedSessionProps}
        />
      ) : null}
      {sliced.dateSections.map(section => (
        <FocusSectionGroup
          key={section.id}
          section={section}
          sort="updated"
          {...sharedSessionProps}
        />
      ))}
      {sliced.hasMore ? (
        <div ref={sentinelRef} className="sidebar-activity-sentinel tw:h-4 tw:w-full" />
      ) : null}
    </div>
  )
}

function TimelinePriorityMenu({
  hasArchivableAttention,
  hasUnreadAttention,
  showWork,
  showChat,
  showPinned,
  onMarkAttentionRead,
  onRequestArchiveAttention,
  onShowWorkChange,
  onShowChatChange,
  onShowPinnedChange,
}: {
  hasArchivableAttention: boolean
  hasUnreadAttention: boolean
  showWork: boolean
  showChat: boolean
  showPinned: boolean
  onMarkAttentionRead: () => void
  onRequestArchiveAttention: () => void
  onShowWorkChange: (value: boolean) => void
  onShowChatChange: (value: boolean) => void
  onShowPinnedChange: (value: boolean) => void
}): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <PopoverMenu
      align="start"
      className="sidebar-timeline-menu"
      modal
      open={menuOpen}
      side="bottom"
      sideOffset={4}
      width={208}
      trigger={
        <IconButton
          aria-label="优先级显示选项"
          className="sidebar-timeline-menu-button"
          color="ghostSecondary"
          size="toolbar"
          title="优先级显示选项"
        >
          <Ellipsis size={APP_ICON_SIZE} />
        </IconButton>
      }
      onOpenChange={setMenuOpen}
    >
      <PopoverLabel>显示</PopoverLabel>
      <PopoverCheckboxItem
        checked={showWork}
        keepOpen
        onCheckedChange={onShowWorkChange}
      >
        Work
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={showChat}
        keepOpen
        onCheckedChange={onShowChatChange}
      >
        Chat
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={showPinned}
        keepOpen
        onCheckedChange={onShowPinnedChange}
      >
        置顶
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={false}
        disabled
        meta="自动化任务将在后续版本接入"
        onCheckedChange={() => undefined}
      >
        已安排
      </PopoverCheckboxItem>
      <PopoverSeparator />
      <PopoverItem
        disabled={!hasUnreadAttention}
        onClick={onMarkAttentionRead}
      >
        全部标为已读
      </PopoverItem>
      <PopoverItem
        disabled={!hasArchivableAttention}
        onClick={onRequestArchiveAttention}
      >
        归档任务
      </PopoverItem>
    </PopoverMenu>
  )
}

function FocusSectionGroup({
  action,
  activeSessionId,
  emptyState,
  now,
  pendingPermissionSessionIds,
  section,
  sort,
  titleLoadingIds,
  sessionFallbackTitles,
  onArchiveSessions,
  onPinSession,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onUnpinSession,
}: {
  action?: React.ReactNode
  activeSessionId: string | null
  emptyState?: React.ReactNode
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  section: SidebarFocusSection
  sort: 'updated' | 'preserve'
  titleLoadingIds: ReadonlySet<string>
  sessionFallbackTitles: Record<string, string>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onPinSession: (session: SessionListItem) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinSession: (session: SessionListItem) => void
}): React.ReactNode {
  return (
    <section className="sidebar-section sidebar-focus-section tw:grid">
      <div className="sidebar-focus-section-header">
        <h3 className="sidebar-focus-section-title">{section.label}</h3>
        {action}
      </div>
      <div className="sidebar-focus-section-clip-window">
        <div className="sidebar-focus-section-clip-content">
          {section.sessions.length === 0 && emptyState != null ? (
            <SidebarEmptyRow>{emptyState}</SidebarEmptyRow>
          ) : (
            <SidebarSessionGroup
              activeSessionId={activeSessionId}
              groupKey={`focus:${section.id}`}
              now={now}
              pagination="all"
              pendingPermissionSessionIds={pendingPermissionSessionIds}
              presentation="workspace-meta"
              sort={sort}
              titleLoadingIds={titleLoadingIds}
              sessionFallbackTitles={sessionFallbackTitles}
              sessions={section.sessions}
              onArchiveSessions={onArchiveSessions}
              onPinSession={onPinSession}
              onSelectSession={onSelectSession}
              onToggleSessionUnread={onToggleSessionUnread}
              onRenameSession={onRenameSession}
              onUnpinSession={onUnpinSession}
            />
          )}
        </div>
      </div>
    </section>
  )
}

const EMPTY_PROJECT_SESSION_BUCKET: SidebarProjectSessionBucket = {
  allSessions: [],
  displaySessions: [],
  openCount: 0,
  unreadCount: 0,
};

const SIDEBAR_SORT_OPTIONS: Array<{
  label: string;
  value: DesktopSidebarSort;
}> = [
  { label: "优先级", value: "priority" },
  { label: "最近更新", value: "updated" },
  { label: "手动排序", value: "manual" },
];

function SidebarOrganizeMenu({
  organization,
  sort,
  onOrganizationChange,
  onSortChange,
}: {
  organization: DesktopSidebarOrganization;
  sort: DesktopSidebarSort;
  onOrganizationChange: (organization: DesktopSidebarOrganization) => void;
  onSortChange: (sort: DesktopSidebarSort) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <PopoverMenu
      align="end"
      className="popover-sidebar-organize popover-menu--flex"
      open={open}
      side="bottom"
      trigger={
        <IconButton color="ghostSecondary" size="toolbar" title="整理侧栏">
          <Ellipsis size={APP_ICON_SIZE} />
        </IconButton>
      }
      width={208}
      onOpenChange={setOpen}
    >
      <PopoverLabel className="popover-sidebar-organize-heading">整理</PopoverLabel>
      <PopoverRadioGroup
        value={organization}
        onValueChange={value =>
          onOrganizationChange(value as DesktopSidebarOrganization)
        }
      >
        <PopoverRadioItem value="projects">按项目</PopoverRadioItem>
        <PopoverRadioItem value="flat">在一个列表中</PopoverRadioItem>
      </PopoverRadioGroup>
      <PopoverLabel className="popover-sidebar-organize-heading">排序方式</PopoverLabel>
      <PopoverRadioGroup
        value={sort}
        onValueChange={value => onSortChange(value as DesktopSidebarSort)}
      >
        {SIDEBAR_SORT_OPTIONS.map((option) => (
          <PopoverRadioItem key={option.value} value={option.value}>
            {option.label}
          </PopoverRadioItem>
        ))}
      </PopoverRadioGroup>
    </PopoverMenu>
  );
}

function SidebarSectionActions({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="sidebar-section-actions tw:flex tw:items-center">
      {children}
    </div>
  );
}

function SidebarShowMoreActions({
  canCollapse,
  canShowMore,
  onCollapse,
  onShowMore,
}: {
  canCollapse: boolean;
  canShowMore: boolean;
  onCollapse: () => void;
  onShowMore: () => void;
}): React.ReactNode {
  return (
    <div className="sidebar-show-more-actions">
      <div
        className={cx(
          "sidebar-row-main",
          "u-min-w-0",
          "u-flex",
          "u-items-center",
        )}
      >
        {canShowMore ? (
          <Button
            aria-expanded={canCollapse}
            className="u-w-auto sidebar-show-more-button"
            color="ghostTertiary"
            onClick={onShowMore}
            size="compact"
            type="button"
          >
            <span>展开显示</span>
          </Button>
        ) : null}
        {canCollapse ? (
          <Button
            className="u-w-auto sidebar-show-more-button"
            color="ghostTertiary"
            onClick={onCollapse}
            size="compact"
            type="button"
          >
            <span>折叠显示</span>
          </Button>
        ) : null}
      </div>
      <span
        aria-hidden="true"
        className={cx(
          "sidebar-row-trailing",
          "u-min-w-0",
          "u-flex",
          "u-items-center",
          "u-w-full",
          "u-justify-end",

        )}
      />
    </div>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

function orderItemsByKeys<T>(
  items: readonly T[],
  order: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map(items.map(item => [keyOf(item), item]))
  const ordered = order.flatMap(key => {
    const item = byKey.get(key)
    return item ? [item] : []
  })
  const knownKeys = new Set(ordered.map(keyOf))
  return [...ordered, ...items.filter(item => !knownKeys.has(keyOf(item)))]
}

function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function SidebarSection({
  action,
  children,
  disclosureStore,
  sectionId,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  disclosureStore: KeyedDisclosureStore;
  sectionId: SidebarSectionId;
  title: string;
}): React.ReactNode {
  const contentId = useId();
  const disclosureKey = sidebarSectionDisclosureKey(sectionId);
  const expanded = useDisclosureExpanded(disclosureStore, disclosureKey);

  return (
    <section className="sidebar-section tw:grid">
      <div className="sidebar-section-header">
        <h2 className="sidebar-section-title">
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="sidebar-section-toggle"
            data-sidebar-section-id={sectionId}
            type="button"
            onClick={() => disclosureStore.setExpanded(disclosureKey, !expanded)}
          >
            <span
              className={cx("sidebar-section-label", "u-min-w-0", "u-truncate")}
            >
              {title}
            </span>
            <span className="sidebar-section-main">
              <span
                aria-hidden="true"
                className="sidebar-section-chevron"
              >
                <ChevronDown size={APP_ICON_SIZE} />
              </span>
            </span>
          </button>
        </h2>
        <div className="sidebar-section-trailing">
          {action}
        </div>
      </div>
      <DisclosureContent
        className="sidebar-section-disclosure"
        contentClassName="sidebar-section-content tw:grid"
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        {children}
      </DisclosureContent>
    </section>
  );
}

function SidebarSectionPresence({
  children,
  reducedMotion,
  ref,
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
  ref?: React.Ref<HTMLDivElement | null>;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      ref={ref}
      animate={{ height: "auto", opacity: 1 }}
      aria-hidden={!isPresent ? true : undefined}
      data-presence={isPresent ? "present" : "exiting"}
      exit={{
        height: 0,
        opacity: 0,
        transition: motionTransition(reducedMotion, fastTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={{ height: 0, opacity: 0 }}
      style={{
        overflow: "hidden",
        pointerEvents: isPresent ? undefined : "none",
      }}
      transition={motionTransition(reducedMotion, standardTween)}
    >
      {children}
    </motion.div>
  );
}
