import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Ellipsis, Plus, SquarePen } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import type {
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopWorkspace,
  SidebarSectionId,
} from "../../../../shared/types.js";
import type { SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion.js";
import {
  fastTween,
  motionTransition,
  standardTween,
} from "../../motion/motionTransitions.js";
import { SidebarEmptyRow } from "./SidebarRow.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import {
  getSidebarSessionDisplayGroups,
  SidebarSessionGroup,
} from "./SidebarSessionGroup.js";
import {
  buildSidebarPinnedItems,
  normalizeSidebarPath,
  reorderSidebarPinnedItemKeys,
  sidebarProjectKey,
  type SidebarPinnedItem,
  type SidebarProjectSessionBucket,
} from "./sidebarViewModel.js";
import { cx } from "../../../utils/cx.js";

const PINNED_INITIAL_LIMIT = 20;
const PINNED_LIMIT_STEP = 20;

type Props = {
  activeSessionId: string | null;
  collapsedProjectPaths: Set<string>;
  organization: DesktopSidebarOrganization;
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
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onPinSession: (session: SessionListItem) => void;
  onPinWorkspace: (workspace: DesktopWorkspace) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onToggleProjectCollapsed: (projectKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void;
  collapsedSidebarSections: SidebarSectionId[];
  onToggleSidebarSection: (section: SidebarSectionId) => void;
  onReport: (message: string) => void;
  onManualOrderChange: (scopeKey: string, order: string[]) => void;
  onOrganizationChange: (organization: DesktopSidebarOrganization) => void;
  onProjectSortChange: (sort: DesktopSidebarSort) => void;
  onSessionSortChange: (sort: DesktopSidebarSort) => void;
};

export function SidebarBody({
  activeSessionId,
  collapsedProjectPaths,
  organization,
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
  onArchiveSessions,
  onChooseWorkspace,
  onCreateSession,
  onPinSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onRenameSession,
  onToggleProjectCollapsed,
  onUnpinSession,
  onUnpinWorkspace,
  collapsedSidebarSections,
  onToggleSidebarSection,
  onReport,
  onManualOrderChange,
  onOrganizationChange,
  onProjectSortChange,
  onSessionSortChange,
}: Props): React.ReactNode {
  const [visibleProjectLimit, setVisibleProjectLimit] = useState(5);
  const [visiblePinnedLimit, setVisiblePinnedLimit] = useState(
    PINNED_INITIAL_LIMIT,
  );
  const [draggingProject, setDraggingProject] = useState<{
    key: string;
    scopeKey: string;
  } | null>(null);
  const [dragOverProjectKey, setDragOverProjectKey] = useState<string | null>(
    null,
  );
  const [draggingPinnedItemKey, setDraggingPinnedItemKey] = useState<
    string | null
  >(null);
  const [dragOverPinnedItemKey, setDragOverPinnedItemKey] = useState<
    string | null
  >(null);
  const unavailablePaths = useMemo(
    () =>
      new Set(
        [...unavailableWorkspacePaths].map((path) =>
          normalizeSidebarPath(path),
        ),
      ),
    [unavailableWorkspacePaths],
  );
  const {
    baseSessions: baseProjects,
    canCollapse: canCollapseProjects,
    canShowMore: canShowMoreProjects,
    extraSessions: extraProjects,
    hasOverflow: hasProjectOverflow,
  } = getSidebarSessionDisplayGroups(projectWorkspaces, visibleProjectLimit);
  const displayedProjects = [...baseProjects, ...extraProjects];
  const pinnedItems = useMemo(
    () =>
      buildSidebarPinnedItems({
        pinnedSessions,
        pinnedWorkspaces,
        storedOrder: manualOrderByScope["pinned-items"] ?? [],
      }),
    [manualOrderByScope, pinnedSessions, pinnedWorkspaces],
  );
  const {
    baseSessions: basePinnedItems,
    canCollapse: canCollapsePinnedItems,
    canShowMore: canShowMorePinnedItems,
    extraSessions: extraPinnedItems,
    hasOverflow: hasPinnedItemOverflow,
  } = getSidebarSessionDisplayGroups(
    pinnedItems,
    visiblePinnedLimit,
    PINNED_INITIAL_LIMIT,
  );
  const displayedPinnedItems = [...basePinnedItems, ...extraPinnedItems];

  useEffect(() => {
    setVisibleProjectLimit(5);
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
  }

  function renderProjectGroup(project: DesktopWorkspace): React.ReactNode {
    return (
      <SidebarProjectGroup
        activeSessionId={activeSessionId}
        bucket={
          projectSessionBuckets.get(sidebarProjectKey(project)) ??
          EMPTY_PROJECT_SESSION_BUCKET
        }
        collapsedProjectPaths={collapsedProjectPaths}
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
        onRenameSession={onRenameSession}
        onSortChange={onProjectSortChange}
        onToggleProjectCollapsed={onToggleProjectCollapsed}
        onUnpinSession={onUnpinSession}
        onUnpinWorkspace={onUnpinWorkspace}
      />
    );
  }

  function renderProject(
    project: DesktopWorkspace,
    projects: readonly DesktopWorkspace[],
    scopeKey: string,
  ): React.ReactNode {
    const key = sidebarProjectKey(project);
    return (
      <div
        className={cx(
          "sidebar-project-sortable",
          draggingProject?.key === key && "is-dragging",
          dragOverProjectKey === key && "is-drag-over",
        )}
        draggable
        key={key}
        onDragEnd={() => {
          setDraggingProject(null);
          setDragOverProjectKey(null);
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          setDragOverProjectKey((current) =>
            current === key ? null : current,
          );
        }}
        onDragOver={(event) => {
          if (
            draggingProject?.scopeKey !== scopeKey ||
            draggingProject.key === key
          ) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverProjectKey(key);
        }}
        onDragStart={(event) => {
          if (event.target !== event.currentTarget) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          setDraggingProject({ key, scopeKey });
        }}
        onDrop={(event) => {
          if (draggingProject?.scopeKey !== scopeKey) return;
          event.preventDefault();
          moveProject(projects, scopeKey, draggingProject.key, key);
          setDraggingProject(null);
          setDragOverProjectKey(null);
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
          const order = projects.map(sidebarProjectKey);
          const index = order.indexOf(key);
          const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
          const target = order[targetIndex];
          if (index < 0 || !target) return;
          event.preventDefault();
          moveProject(projects, scopeKey, key, target);
        }}
      >
        {renderProjectGroup(project)}
      </div>
    );
  }

  function movePinnedItem(sourceKey: string, targetKey: string): void {
    const order = reorderSidebarPinnedItemKeys(
      pinnedItems,
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
      <div
        className={cx(
          "sidebar-project-sortable",
          draggingPinnedItemKey === item.key && "is-dragging",
          dragOverPinnedItemKey === item.key && "is-drag-over",
        )}
        data-sidebar-pinned-item-key={item.key}
        draggable
        key={item.key}
        onDragEnd={() => {
          setDraggingPinnedItemKey(null);
          setDragOverPinnedItemKey(null);
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          setDragOverPinnedItemKey((current) =>
            current === item.key ? null : current,
          );
        }}
        onDragOver={(event) => {
          if (!draggingPinnedItemKey || draggingPinnedItemKey === item.key) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverPinnedItemKey(item.key);
        }}
        onDragStart={(event) => {
          if (event.target !== event.currentTarget) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(
            "application/x-codepilotx-sidebar-pinned-item",
            item.key,
          );
          setDraggingPinnedItemKey(item.key);
        }}
        onDrop={(event) => {
          if (!draggingPinnedItemKey) return;
          event.preventDefault();
          movePinnedItem(draggingPinnedItemKey, item.key);
          setDraggingPinnedItemKey(null);
          setDragOverPinnedItemKey(null);
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
          const index = pinnedItems.findIndex(
            (entry) => entry.key === item.key,
          );
          const targetIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
          const target = pinnedItems[targetIndex];
          if (index < 0 || !target) return;
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
            onArchiveSessions={onArchiveSessions}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onUnpinSession={onUnpinSession}
          />
        )}
      </div>
    );
  }

  return (
    <ScrollArea
      className="sidebar-scroll-area tw:mt-4.5 tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="sidebar-scroll-content"
    >
      <div className="sidebar-section-group tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-1.5">
        {pinnedItems.length > 0 ? (
          <SidebarSection
            collapsed={collapsedSidebarSections.includes("pinned")}
            sectionId="pinned"
            title="置顶"
            onToggle={onToggleSidebarSection}
          >
            {displayedPinnedItems.map(renderPinnedItem)}
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
        ) : null}

        {organization === "projects" ? (
          <SidebarSection
            action={
              <SidebarSectionActions>
                <SidebarOrganizeMenu
                  organization={organization}
                  sort={projectSort}
                  onOrganizationChange={onOrganizationChange}
                  onSortChange={onProjectSortChange}
                />
                <IconButton onClick={onChooseWorkspace} title="添加项目">
                  <Plus size={APP_ICON_SIZE} />
                </IconButton>
              </SidebarSectionActions>
            }
            collapsed={collapsedSidebarSections.includes("projects")}
            sectionId="projects"
            title="项目"
            onToggle={onToggleSidebarSection}
          >
            {projectWorkspaces.length === 0 ? (
              <SidebarEmptyRow>暂无项目</SidebarEmptyRow>
            ) : (
              <>
                {displayedProjects.map((project) =>
                  renderProject(project, projectWorkspaces, "projects"),
                )}
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
            )}
          </SidebarSection>
        ) : null}

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
                onClick={() => onCreateSession(null)}
                title="新建无项目任务"
              >
                <SquarePen size={APP_ICON_SIZE} />
              </IconButton>
            </SidebarSectionActions>
          }
          collapsed={collapsedSidebarSections.includes("recent")}
          sectionId="recent"
          title="最近"
          onToggle={onToggleSidebarSection}
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
              onRenameSession={onRenameSession}
              onSortChange={onSessionSortChange}
              onUnpinSession={onUnpinSession}
            />
          )}
        </SidebarSection>
      </div>
    </ScrollArea>
  );
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
      triggerTabIndex={0}
      trigger={
        <IconButton title="整理侧栏">
          <Ellipsis size={APP_ICON_SIZE} />
        </IconButton>
      }
      width={208}
      onOpenChange={setOpen}
    >
      <div className="popover-sidebar-organize-heading">整理</div>
      <PopoverItem
        selected={organization === "projects"}
        withCheck
        onClick={() => onOrganizationChange("projects")}
      >
        按项目
      </PopoverItem>
      <PopoverItem
        selected={organization === "flat"}
        withCheck
        onClick={() => onOrganizationChange("flat")}
      >
        在一个列表中
      </PopoverItem>
      <div className="popover-sidebar-organize-heading">排序方式</div>
      {SIDEBAR_SORT_OPTIONS.map((option) => (
        <PopoverItem
          key={option.value}
          selected={sort === option.value}
          withCheck
          onClick={() => onSortChange(option.value)}
        >
          {option.label}
        </PopoverItem>
      ))}
    </PopoverMenu>
  );
}

function SidebarSectionActions({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="sidebar-section-actions tw:flex tw:items-center tw:gap-3">
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
      <span
        aria-hidden="true"
        className={cx(
          "sidebar-row-leading",
          "sidebar-row-leading-spacer",
          "u-min-w-0",
          "u-flex",
          "u-items-center",
        )}
      />
      <div
        className={cx(
          "sidebar-row-main",
          "u-min-w-0",
          "u-flex",
          "u-items-center",
        )}
      >
        {canShowMore ? (
          <button
            aria-expanded={canCollapse}
            className={cx(
              "sidebar-show-more-button",
              "u-type-control",
              "u-w-auto",
              "u-p-0",
            )}
            onClick={onShowMore}
            type="button"
          >
            <span>展开显示</span>
          </button>
        ) : null}
        {canCollapse ? (
          <button
            className={cx(
              "sidebar-show-more-button",
              "u-type-control",
              "u-w-auto",
              "u-p-0",
            )}
            onClick={onCollapse}
            type="button"
          >
            <span>折叠显示</span>
          </button>
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

function SidebarSection({
  action,
  children,
  collapsed,
  sectionId,
  title,
  onToggle,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsed: boolean;
  sectionId: SidebarSectionId;
  title: string;
  onToggle: (section: SidebarSectionId) => void;
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <section className="sidebar-section tw:grid tw:gap-1">
      <div
        aria-expanded={!collapsed}
        className="sidebar-section-header tw:rounded-md tw:px-2 tw:py-1.25 tw:text-sm tw:text-app-text-soft"
        data-sidebar-section-id={sectionId}
        role="button"
        tabIndex={0}
        onClick={() => onToggle(sectionId)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle(sectionId);
        }}
      >
        <h2 className="sidebar-section-title">
          <span
            className={cx("sidebar-section-label", "u-min-w-0", "u-truncate")}
          >
            {title}
          </span>
        </h2>
        <span className="sidebar-section-main">
          <motion.span
            aria-hidden="true"
            animate={{ rotate: collapsed ? -90 : 0 }}
            className="sidebar-section-chevron"
            initial={false}
            transition={motionTransition(reducedMotion, standardTween)}
          >
            <ChevronDown size={APP_ICON_SIZE} />
          </motion.span>
        </span>
        <div
          className="sidebar-section-trailing"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {action}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <SidebarSectionContent
            key={`sidebar-section-content-${sectionId}`}
            reducedMotion={reducedMotion}
          >
            {children}
          </SidebarSectionContent>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function SidebarSectionContent({
  children,
  reducedMotion,
}: {
  children: React.ReactNode;
  reducedMotion: boolean;
}): React.ReactNode {
  const isPresent = useIsPresent();

  return (
    <motion.div
      aria-hidden={!isPresent ? true : undefined}
      animate={{ height: "auto", opacity: 1 }}
      className="sidebar-section-content tw:grid tw:gap-1"
      exit={{
        height: 0,
        opacity: 0,
        transition: motionTransition(reducedMotion, fastTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={{ height: 0, opacity: 0 }}
      transition={motionTransition(reducedMotion, standardTween)}
    >
      {children}
    </motion.div>
  );
}
