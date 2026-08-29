import type React from "react";
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Archive, Copy, Eye, EyeOff, Folder, MessageSquare, Pencil, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import { ProjectAppearanceGlyph } from "../../projects/projectAppearance.js";
import {
  sessionDisplayTitle,
  sessionEditableTitle,
  type SessionListItem,
} from "../../../uiTypes.js";
import { Button } from "../../../components/ui/Button.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { Spinner } from "../../../components/ui/Spinner.js";
import { SkeletonBlock } from "../../../components/ui/Skeleton.js";
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import { motionTransition, layoutTween } from '../../motion/motionTransitions.js'
import { sortSessionsForSidebar } from '../../session/state/sessionSorting.js'
import { SidebarRow } from "./SidebarRow.js";
import { SidebarReorderItem } from './SidebarReorderItem.js'
import { useEverOpened } from '../../../hooks/usePresenceRetention.js'
import { cx } from "../../../utils/cx.js";
import {
  AppContextMenu as SidebarContextMenu,
  type AppContextMenuAction as ContextMenuAction,
} from "../../../components/ui/AppContextMenu.js";
import type { DesktopSidebarSort } from '../../../../shared/types.js'
import { deriveSidebarSessionVisualState } from './sidebarViewModel.js'
import { desktopClient, desktopClipboard } from '../../../services/desktop-client/index.js'

const SidebarSessionHoverCard = lazy(async () => {
  const module = await import('./SidebarSessionHoverCard.js')
  return { default: module.SidebarSessionHoverCard }
})

const InputDialog = lazy(async () => {
  const module = await import('../../../components/ui/ConfirmationDialog.js')
  return { default: module.InputDialog }
})

const GROUP_LIMIT = 5;
const TITLE_SCROLL_MIN_SECONDS = 2;
const TITLE_SCROLL_PIXELS_PER_SECOND = 40;

type Props = {
  activeSessionId: string | null;
  groupKey: string;
  now: number;
  pendingPermissionSessionIds: ReadonlySet<string>;
  titleLoadingIds: ReadonlySet<string>;
  sessionFallbackTitles: Record<string, string>;
  sessions: SessionListItem[];
  /** 'preserve' 表示调用方已排好序，不再重排（时间线优先任务组使用） */
  sort?: DesktopSidebarSort | 'preserve'
  manualOrderByScope?: Record<string, string[]>
  presentation?: 'compact' | 'workspace-meta'
  pagination?: 'incremental' | 'all'
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>;
  onManualOrderChange?: (scopeKey: string, order: string[]) => void
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleSessionUnread: (session: SessionListItem) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onSortChange?: (sort: 'manual') => void
  onUnpinSession: (session: SessionListItem) => void;
};

function SidebarSessionGroupComponent({
  activeSessionId,
  groupKey,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  sessionFallbackTitles,
  sessions,
  sort = 'priority',
  manualOrderByScope = {},
  presentation = 'compact',
  pagination = 'incremental',
  onArchiveSessions,
  onManualOrderChange,
  onPinSession,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onSortChange,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<
    string | null
  >(null);
  const [visibleLimit, setVisibleLimit] = useState(GROUP_LIMIT);
  const [renameSession, setRenameSession] = useState<SessionListItem | null>(null)
  const renameDialogMounted = useEverOpened(renameSession !== null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const needsInputSessionIds = pendingPermissionSessionIds
  const unreadSessionIds = useMemo(
    () => new Set(sessions.filter(session => session.unreadAt).map(session => session.id)),
    [sessions],
  )
  const sortedSessions = useMemo(
    () =>
      sort === 'preserve'
        ? sessions
        : sortSessionsForSidebar(sessions, {
            sort,
            needsInputSessionIds,
            unreadSessionIds,
            scopeKey: groupKey,
            manualOrderByScope,
          }),
    [
      groupKey,
      manualOrderByScope,
      needsInputSessionIds,
      sessions,
      sort,
      unreadSessionIds,
    ],
  )
  const [reorderSessionIds, setReorderSessionIds] = useState<string[]>(() =>
    sortedSessions.map(session => session.id),
  )
  const reorderSessionIdsRef = useRef(reorderSessionIds)
  const orderedSessions = useMemo(() => {
    const byId = new Map(sortedSessions.map(session => [session.id, session]))
    const ordered = reorderSessionIds.flatMap(id => {
      const session = byId.get(id)
      return session ? [session] : []
    })
    const knownIds = new Set(ordered.map(session => session.id))
    return [
      ...ordered,
      ...sortedSessions.filter(session => !knownIds.has(session.id)),
    ]
  }, [reorderSessionIds, sortedSessions])
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(orderedSessions, visibleLimit);
  const extraSessionIds = useMemo(
    () => new Set(extraSessions.map(session => session.id)),
    [extraSessions],
  )
  const previousGroupKeyRef = useRef(groupKey)

  useEffect(() => {
    if (draggedSessionId) return
    const canonicalOrder = sortedSessions.map(session => session.id)
    reorderSessionIdsRef.current = canonicalOrder
    setReorderSessionIds(current =>
      sameStringOrder(current, canonicalOrder) ? current : canonicalOrder,
    )
  }, [draggedSessionId, sortedSessions])

  useEffect(() => {
    const groupChanged = previousGroupKeyRef.current !== groupKey
    previousGroupKeyRef.current = groupKey
    if (pagination === 'all') {
      return
    }
    const activeIndex = orderedSessions.findIndex(
      session => session.id === activeSessionId,
    )
    if (groupChanged) {
      setVisibleLimit(
        activeIndex < 0 ? GROUP_LIMIT : Math.max(GROUP_LIMIT, activeIndex + 1),
      )
      return
    }
    if (activeIndex >= 0) {
      // 排序或异步数据变化后，继续让当前激活项处于已渲染分页内。
      // 用户单独点击“折叠显示”只改变 visibleLimit，不会重新触发本 effect。
      setVisibleLimit(current => Math.max(current, activeIndex + 1))
    }
  }, [activeSessionId, groupKey, orderedSessions, pagination])

  function persistManualOrder(order: string[]): void {
    if (!onManualOrderChange) return
    onManualOrderChange(groupKey, order)
    if (sort !== 'manual') onSortChange?.('manual')
  }

  function moveSessionByKeyboard(
    sessionId: string,
    offset: -1 | 1,
  ): void {
    if (!onManualOrderChange) return
    const order = orderedSessions.map(session => session.id)
    const currentIndex = order.indexOf(sessionId)
    const nextIndex = currentIndex + offset
    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= order.length
    ) {
      return
    }
    const [moved] = order.splice(currentIndex, 1)
    if (!moved) return
    order.splice(nextIndex, 0, moved)
    setVisibleLimit(current => Math.max(current, nextIndex + 1))
    persistManualOrder(order)
  }

  function getSessionContextMenuActions(
    session: SessionListItem,
  ): ContextMenuAction[] {
    return [
      {
        kind: 'item',
        label: session.status === 'running' || session.status === 'waiting' || session.status === 'queued'
          ? '当前 Turn 结束后可切换'
          : session.sessionGroupId ? '切换或移出会话组' : '加入会话组',
        disabled: session.status === 'running' || session.status === 'waiting' || session.status === 'queued',
        onSelect: () => {
          void chooseSessionGroupForThread(session.id)
        },
      },
      { kind: 'separator' },
      {
        kind: "item",
        label: "重命名",
        icon: <Pencil size={APP_ICON_SIZE} />,
        onSelect: () => {
          setRenameSession(session)
          setRenameValue(sessionEditableTitle(session, sessionFallbackTitles[session.id]))
        },
      },
      {
        kind: "item",
        label: "复制会话 ID",
        icon: <Copy size={APP_ICON_SIZE} />,
        onSelect: () => {
          void desktopClipboard.writeText(session.id);
        },
      },
      {
        kind: "item",
        label: sessionReadStatusActionLabel(session),
        icon: session.unreadAt
          ? <Eye size={APP_ICON_SIZE} />
          : <EyeOff size={APP_ICON_SIZE} />,
        onSelect: () => onToggleSessionUnread(session),
      },
      { kind: "separator" },
      session.pinnedAt
        ? {
            kind: "item" as const,
            label: "取消置顶",
            icon: <PinOff size={APP_ICON_SIZE} />,
            onSelect: () => onUnpinSession(session),
          }
        : {
            kind: "item" as const,
            label: "置顶",
            icon: <Pin size={APP_ICON_SIZE} />,
            onSelect: () => onPinSession(session),
          },
      {
        kind: "item",
        label: "归档",
        icon: <Archive size={APP_ICON_SIZE} />,
        onSelect: () => setConfirmArchiveSessionId(session.id),
      },
    ];
  }

  function renderSessionRow(session: SessionListItem): React.ReactNode {
    const regeneratingTitle = titleLoadingIds.has(session.id)
    const visualState = deriveSidebarSessionVisualState(
      session,
      pendingPermissionSessionIds,
    )
    const awaitingApproval = visualState === 'needs-input'
    const metaClassName = cx(
      "sidebar-session-meta",
      "u-flex",
      "u-items-center",
      "u-justify-end",
      "u-w-auto",
      awaitingApproval && "sidebar-session-meta--approval",
      confirmArchiveSessionId === session.id && "confirming-archive",
    );
    const sessionButton = (
      <button
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className="sidebar-session-button"
        onClick={() => {
          onSelectSession(session);
        }}
        onKeyDown={event => {
          if (
            !event.altKey ||
            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          moveSessionByKeyboard(
            session.id,
            event.key === 'ArrowUp' ? -1 : 1,
          )
        }}
        type="button"
      >
        <span className={cx('sidebar-session-button-lines', presentation === 'workspace-meta' && 'sidebar-session-button-lines--meta')}>
        {regeneratingTitle ? (
          <SkeletonBlock
            className="sidebar-session-title sidebar-session-title--loading"
            label="正在更新会话标题"
          />
        ) : (
          <SidebarSessionTitle
            active={
              hoveredSessionId === session.id ||
              focusedSessionId === session.id
            }
            reducedMotion={reducedMotion}
          >
            {sessionDisplayTitle(session, sessionFallbackTitles[session.id])}
          </SidebarSessionTitle>
        )}
        {presentation === 'workspace-meta' ? (
          <SidebarSessionSubtitle session={session} />
        ) : null}
        </span>
      </button>
    )
    const rowContent = (
      <Suspense fallback={sessionButton}>
        {regeneratingTitle ? (
          sessionButton
        ) : (
          <SidebarSessionHoverCard
            fallbackTitle={sessionFallbackTitles[session.id]}
            now={now}
            regeneratingTitle={regeneratingTitle}
            session={session}
            onRename={title => onRenameSession(session.id, title)}
          >
            {sessionButton}
          </SidebarSessionHoverCard>
        )}
      </Suspense>
    )
    const row = (
      <SidebarRow
        active={session.id === activeSessionId}
        asChild
        className="sidebar-session-row"
        data-sidebar-session-id={session.id}
        indent="session"
        layout="grid"
        leadingMode="none"
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() => {
          setHoveredSessionId((current) =>
            current === session.id ? null : current,
          );
          setConfirmArchiveSessionId((current) =>
            current === session.id ? null : current,
          );
        }}
        onFocusCapture={() => setFocusedSessionId(session.id)}
        onBlurCapture={event => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setFocusedSessionId(current => current === session.id ? null : current)
        }}
        trailing={
          <div className={metaClassName}>
            {confirmArchiveSessionId === session.id ? (
              <button
                className="sidebar-session-confirm-archive-button"
                onClick={() => void onArchiveSessions([session])}
                title="确认归档"
                type="button"
              >
                确认
              </button>
            ) : awaitingApproval ? (
              <>
                <span className="sidebar-session-approval" title="等待审批">
                  等待审批
                </span>
                <Spinner className="sidebar-session-spinner" label="加载中" />
              </>
            ) : hoveredSessionId === session.id || focusedSessionId === session.id ? (
              <div className="sidebar-session-actions">
                {session.pinnedAt ? (
                  <IconButton
                    className="sidebar-session-action-button"
                    color="ghostSecondary"
                    onClick={() => onUnpinSession(session)}
                    size="iconMd"
                    title="取消置顶"
                  >
                    <PinOff size={APP_ICON_SIZE} />
                  </IconButton>
                ) : (
                  <IconButton
                    className="sidebar-session-action-button"
                    color="ghostSecondary"
                    onClick={() => onPinSession(session)}
                    size="iconMd"
                    title="置顶"
                  >
                    <Pin size={APP_ICON_SIZE} />
                  </IconButton>
                )}
                <IconButton
                  className="sidebar-session-action-button"
                  color="ghostSecondary"
                  onClick={() => setConfirmArchiveSessionId(session.id)}
                  size="iconMd"
                  title="归档"
                >
                  <Archive size={APP_ICON_SIZE} />
                </IconButton>
              </div>
            ) : visualState === 'unread' ? (
              <span
                aria-label="未读"
                className="sidebar-session-unread-dot"
              />
            ) : visualState === 'running' ? (
              <Spinner className="sidebar-session-spinner" label="加载中" />
            ) : null}
          </div>
        }
      >
        {onManualOrderChange ? (
          <SidebarReorderItem
            as="li"
            data-sidebar-session-extra={extraSessionIds.has(session.id) || undefined}
            presenceMotion={extraSessionIds.has(session.id)}
            reducedMotion={reducedMotion}
            value={session.id}
            onReorderDragEnd={() => {
              const finalOrder = reorderSessionIdsRef.current
              setDraggedSessionId(null)
              persistManualOrder(finalOrder)
            }}
            onReorderDragStart={() => {
              reorderSessionIdsRef.current = orderedSessions.map(item => item.id)
              setDraggedSessionId(session.id)
            }}
          >
            {rowContent}
          </SidebarReorderItem>
        ) : (
          <li>{rowContent}</li>
        )}
      </SidebarRow>
    );
    return (
      <SidebarContextMenu
        key={session.id}
        actions={getSessionContextMenuActions(session)}
        layout="grid"
        width={240}
        trigger={row}
      />
    );
  }

  const visibleSessions = pagination === 'all'
    ? orderedSessions
    : [...baseSessions, ...extraSessions]
  const reorderValues = orderedSessions.map(session => session.id)
  const sessionListClassName =
    'sidebar-session-list tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-px tw:p-0'
  const sessionRows = visibleSessions.map(renderSessionRow)

  return (
    <>
      {onManualOrderChange ? (
        <Reorder.Group
          axis="y"
          className={sessionListClassName}
          values={reorderValues}
          onReorder={nextOrder => {
            if (sameStringOrder(reorderSessionIdsRef.current, nextOrder)) return
            reorderSessionIdsRef.current = nextOrder
            setReorderSessionIds(nextOrder)
          }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {sessionRows}
          </AnimatePresence>
        </Reorder.Group>
      ) : (
        <ul className={sessionListClassName}>{sessionRows}</ul>
      )}
      {pagination !== 'all' ? (
      <>
      {hasOverflow ? (
        <motion.div
          className="sidebar-show-more-actions"
          layout="position"
          transition={motionTransition(reducedMotion, layoutTween)}
        >
          <div className={cx('sidebar-row-main', 'u-min-w-0', 'u-flex', 'u-items-center')}>
            {canShowMore ? (
              <Button
                aria-expanded={canCollapse}
                className="u-w-auto sidebar-show-more-button"
                color="ghostTertiary"
                onClick={() =>
                  setVisibleLimit((current) =>
                    Math.min(current + GROUP_LIMIT, sessions.length),
                  )
                }
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
                onClick={() => setVisibleLimit(GROUP_LIMIT)}
                size="compact"
                type="button"
              >
                <span>折叠显示</span>
              </Button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
      </>
      ) : null}
      {renameDialogMounted ? (
        <Suspense fallback={null}>
          <InputDialog
            actionDisabled={renaming || renameValue.trim().length === 0}
            actionLabel={renaming ? '重命名中…' : '重命名'}
            description="输入新的对话名称。"
            input={{
              value: renameValue,
              onChange: setRenameValue,
              maxLength: 160,
              placeholder: '输入对话名称',
            }}
            open={renameSession !== null}
            title="重命名对话"
            onAction={() => {
              if (!renameSession || renaming) return
              setRenaming(true)
              void onRenameSession(renameSession.id, renameValue).then(success => {
                setRenaming(false)
                if (success) setRenameSession(null)
              })
            }}
            onCancel={() => {
              if (renaming) return
              setRenameSession(null)
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export const SidebarSessionGroup = memo(SidebarSessionGroupComponent);

export function sessionReadStatusActionLabel(
  session: Pick<SessionListItem, 'unreadAt'>,
): '标记为已读' | '标记为未读' {
  return session.unreadAt ? '标记为已读' : '标记为未读'
}

async function chooseSessionGroupForThread(threadId: string): Promise<void> {
  const groups = await desktopClient.listSessionGroups()
  const choices = groups.map((group, index) => `${index + 1}. ${group.name}`).join('\n')
  const answer = globalThis.prompt(`输入会话组序号；输入 0 移出会话组：\n${choices}`)?.trim()
  if (answer === undefined) return
  const index = Number(answer)
  const groupId = index === 0 ? null : groups[index - 1]?.id
  if (index !== 0 && !groupId) return
  await desktopClient.setSessionGroupMembership({ threadId, groupId })
}

function SidebarSessionTitle({
  active,
  children,
  reducedMotion,
}: {
  active: boolean;
  children: React.ReactNode;
  reducedMotion: boolean;
}): React.ReactNode {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [overflowDistance, setOverflowDistance] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setOverflowDistance(null);
      return;
    }
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const updateOverflowDistance = (): void => {
      const distance =
        viewport.clientWidth > 0
          ? Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth))
          : 0;
      const nextDistance = distance > 0 ? distance : null;
      setOverflowDistance(current =>
        current === nextDistance ? current : nextDistance,
      );
    };

    updateOverflowDistance();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateOverflowDistance);
    observer.observe(viewport);
    observer.observe(track);
    return () => observer.disconnect();
  }, [active, children]);

  const scrolling = overflowDistance !== null && !reducedMotion;
  const style =
    overflowDistance === null
      ? undefined
      : ({
          "--sidebar-title-scroll-distance": `${overflowDistance}px`,
          "--sidebar-title-scroll-duration": `${Math.max(
            TITLE_SCROLL_MIN_SECONDS,
            overflowDistance / TITLE_SCROLL_PIXELS_PER_SECOND,
          ).toFixed(2)}s`,
        } as React.CSSProperties);

  return (
    <span
      aria-live="polite"
      className="sidebar-session-title"
      data-overflowing={overflowDistance !== null || undefined}
      data-scrolling={scrolling || undefined}
      ref={viewportRef}
      style={style}
    >
      <span
        className="sidebar-session-title-track"
        data-scrolling={scrolling || undefined}
        ref={trackRef}
      >
        {children}
      </span>
    </span>
  );
}

export function getSidebarSessionDisplayGroups<T>(
  sessions: readonly T[],
  visibleLimit: number,
  baseLimit = GROUP_LIMIT,
): {
  baseSessions: T[];
  canCollapse: boolean;
  canShowMore: boolean;
  extraSessions: T[];
  hasOverflow: boolean;
} {
  const hasOverflow = sessions.length > baseLimit;
  const clampedVisibleLimit = Math.min(
    Math.max(baseLimit, visibleLimit),
    sessions.length,
  );
  return {
    baseSessions: sessions.slice(0, baseLimit),
    canCollapse: clampedVisibleLimit > baseLimit,
    canShowMore: clampedVisibleLimit < sessions.length,
    extraSessions: hasOverflow
      ? sessions.slice(baseLimit, clampedVisibleLimit)
      : [],
    hasOverflow,
  };
}

export function sessionSnippet(session: SessionListItem): string | null {
  const raw = session.summary || session.preview || session.firstPrompt || null
  if (!raw) return null
  const cleaned = raw
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

function SidebarSessionSubtitle({
  session,
}: {
  session: SessionListItem
}): React.ReactNode {
  const snippet = sessionSnippet(session)
  if (snippet) {
    return (
      <span className="sidebar-session-snippet" title={snippet}>
        {snippet}
      </span>
    )
  }
  return <SidebarSessionWorkspaceMeta session={session} />
}

function SidebarSessionWorkspaceMeta({
  session,
}: {
  session: SessionListItem
}): React.ReactNode {
  if (session.standalone) {
    return (
      <span className="sidebar-session-workspace-meta">
        <MessageSquare className="sidebar-session-workspace-meta__icon" size={12} />
        <span className="sidebar-session-workspace-meta__name">会话</span>
      </span>
    )
  }
  if (session.projectId) {
    return (
      <span className="sidebar-session-workspace-meta">
        <ProjectAppearanceGlyph
          className="sidebar-session-workspace-meta__glyph"
          size={12}
        />
        <span className="sidebar-session-workspace-meta__name">
          {session.workspaceName}
        </span>
      </span>
    )
  }
  return (
    <span className="sidebar-session-workspace-meta">
      <Folder className="sidebar-session-workspace-meta__icon" size={12} />
      <span className="sidebar-session-workspace-meta__name">
        {session.workspaceName}
      </span>
    </span>
  )
}

function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
