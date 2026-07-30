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
import { Archive, Copy, LoaderCircle, Pencil, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import {
  sessionDisplayTitle,
  sessionEditableTitle,
  type SessionListItem,
} from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../../motion/motionTransitions.js'
import { sortSessionsForSidebar } from '../../session/state/sessionSorting.js'
import { SidebarRow } from "./SidebarRow.js";
import { InputDialog } from '../../../components/ui/ConfirmationDialog.js'
import { cx } from "../../../utils/cx.js";
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from "./SidebarContextMenu.js";
import type { DesktopSidebarSort } from '../../../../shared/types.js'

const SidebarSessionHoverCard = lazy(async () => {
  const module = await import('./SidebarSessionHoverCard.js')
  return { default: module.SidebarSessionHoverCard }
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
  sort?: DesktopSidebarSort
  manualOrderByScope?: Record<string, string[]>
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>;
  onManualOrderChange?: (scopeKey: string, order: string[]) => void
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
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
  onArchiveSessions,
  onManualOrderChange,
  onPinSession,
  onSelectSession,
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
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const needsInputSessionIds = pendingPermissionSessionIds
  const unreadSessionIds = useMemo(
    () => new Set(sessions.filter(session => session.unreadAt).map(session => session.id)),
    [sessions],
  )
  const sortedSessions = useMemo(
    () =>
      sortSessionsForSidebar(sessions, {
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
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(sortedSessions, visibleLimit);

  useEffect(() => {
    setVisibleLimit(GROUP_LIMIT);
  }, [groupKey]);

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
    const order = sortedSessions.map(session => session.id)
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

  function handleDragStart(
    event: React.DragEvent<HTMLElement>,
    sessionId: string,
  ): void {
    if (!onManualOrderChange) {
      event.preventDefault()
      return
    }
    const target = event.target as Element
    if (
      target.closest(
        '.sidebar-session-actions, .sidebar-session-confirm-archive-button',
      )
    ) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      'application/x-codepilotx-sidebar-session',
      sessionId,
    )
    setDraggedSessionId(sessionId)
  }

  function handleDrop(
    event: React.DragEvent<HTMLElement>,
    targetSessionId: string,
  ): void {
    const sourceSessionId =
      draggedSessionId ||
      event.dataTransfer.getData(
        'application/x-codepilotx-sidebar-session',
      )
    if (!sourceSessionId || sourceSessionId === targetSessionId) {
      setDragOverSessionId(null)
      return
    }
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2
    const order = reorderSessionIds(
      sortedSessions,
      sourceSessionId,
      targetSessionId,
      placeAfter,
    )
    if (order) persistManualOrder(order)
    setDraggedSessionId(null)
    setDragOverSessionId(null)
  }

  function getSessionContextMenuActions(
    session: SessionListItem,
  ): ContextMenuAction[] {
    return [
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
          void navigator.clipboard.writeText(session.id);
        },
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
    const awaitingApproval =
      session.status === "waiting" ||
      pendingPermissionSessionIds.has(session.id);
    const metaClassName = cx(
      "sidebar-session-meta",
      "u-flex",
      "u-items-center",
      "u-justify-end",
      "u-w-auto",
      "tw:gap-3",
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
        {regeneratingTitle ? (
          <span
            aria-busy="true"
            aria-label="正在更新会话标题"
            aria-live="polite"
            className="sidebar-session-title sidebar-session-title--loading ui-skeleton-block"
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
      </button>
    )
    const row = (
      <SidebarRow
        active={session.id === activeSessionId}
        as="li"
        className={cx(
          'sidebar-session-row',
          draggedSessionId === session.id && 'is-dragging',
          dragOverSessionId === session.id && 'is-drag-over',
        )}
        draggable={Boolean(onManualOrderChange)}
        indent="session"
        key={session.id}
        layout="grid"
        onDragEnd={() => {
          setDraggedSessionId(null)
          setDragOverSessionId(null)
        }}
        onDragLeave={event => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return
          }
          setDragOverSessionId(current =>
            current === session.id ? null : current,
          )
        }}
        onDragOver={event => {
          if (!draggedSessionId || draggedSessionId === session.id) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOverSessionId(session.id)
        }}
        onDragStart={event => handleDragStart(event, session.id)}
        onDrop={event => handleDrop(event, session.id)}
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
                <LoaderCircle
                  aria-label="加载中"
                  className="sidebar-session-spinner"
                  size={APP_ICON_SIZE}
                />
              </>
            ) : session.status === "running" ? (
              <LoaderCircle
                aria-label="加载中"
                className="sidebar-session-spinner"
                size={APP_ICON_SIZE}
              />
            ) : hoveredSessionId === session.id || focusedSessionId === session.id ? (
              <div className="sidebar-session-actions">
                {session.pinnedAt ? (
                  <IconButton
                    className="sidebar-session-action-button"
                    onClick={() => onUnpinSession(session)}
                    title="取消置顶"
                  >
                    <PinOff size={APP_ICON_SIZE} />
                  </IconButton>
                ) : (
                  <IconButton
                    className="sidebar-session-action-button"
                    onClick={() => onPinSession(session)}
                    title="置顶"
                  >
                    <Pin size={APP_ICON_SIZE} />
                  </IconButton>
                )}
                <IconButton
                  className="sidebar-session-action-button"
                  onClick={() => setConfirmArchiveSessionId(session.id)}
                  title="归档"
                >
                  <Archive size={APP_ICON_SIZE} />
                </IconButton>
              </div>
            ) : null}
            {session.unreadAt && confirmArchiveSessionId !== session.id ? (
              <span
                aria-label="未读"
                className="sidebar-session-unread-dot"
              />
            ) : null}
          </div>
        }
      >
        <Suspense fallback={sessionButton}>
          <SidebarSessionHoverCard
            fallbackTitle={sessionFallbackTitles[session.id]}
            now={now}
            regeneratingTitle={regeneratingTitle}
            session={session}
            onRename={title => onRenameSession(session.id, title)}
          >
            {sessionButton}
          </SidebarSessionHoverCard>
        </Suspense>
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

  return (
    <>
      <ul className="sidebar-session-list tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-0.5 tw:p-0">
        {baseSessions.map(renderSessionRow)}
      </ul>
      <AnimatePresence initial={false}>
        {extraSessions.length > 0 ? (
          <motion.ul
            animate={{ height: "auto", opacity: 1 }}
            className="sidebar-session-list sidebar-session-list-extra tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-0.5 tw:overflow-hidden tw:p-0"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key={`${groupKey}-extra-sessions`}
            transition={motionTransition(reducedMotion, standardTween)}
          >
            {extraSessions.map(renderSessionRow)}
          </motion.ul>
        ) : null}
      </AnimatePresence>
      {hasOverflow ? (
        <div className="sidebar-show-more-actions">
          <span
            aria-hidden="true"
            className={cx(
              'sidebar-row-leading',
              'sidebar-row-leading-spacer',
              'u-min-w-0',
              'u-flex',
              'u-items-center',
            )}
          />
          <div className={cx('sidebar-row-main', 'u-min-w-0', 'u-flex', 'u-items-center')}>
            {canShowMore ? (
              <button
                aria-expanded={canCollapse}
                className={cx(
                  'sidebar-show-more-button',
                  'u-type-control',
                  'u-w-auto',
                  'u-p-0',
                )}
                onClick={() =>
                  setVisibleLimit((current) =>
                    Math.min(current + GROUP_LIMIT, sessions.length),
                  )
                }
                type="button"
              >
                <span>展开显示</span>
              </button>
            ) : null}
            {canCollapse ? (
              <button
                className={cx(
                  'sidebar-show-more-button',
                  'u-type-control',
                  'u-w-auto',
                  'u-p-0',
                )}
                onClick={() => setVisibleLimit(GROUP_LIMIT)}
                type="button"
              >
                <span>折叠显示</span>
              </button>
            ) : null}
          </div>
          <span
            aria-hidden="true"
            className={cx(
              'sidebar-row-trailing',
              'u-min-w-0',
              'u-flex',
              'u-items-center',
              'u-w-full',
              'u-justify-end',
            )}
          />
        </div>
      ) : null}
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
    </>
  );
}

export const SidebarSessionGroup = memo(SidebarSessionGroupComponent);

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

function reorderSessionIds(
  sessions: readonly SessionListItem[],
  sourceSessionId: string,
  targetSessionId: string,
  placeAfter: boolean,
): string[] | null {
  const order = sessions.map(session => session.id)
  const sourceIndex = order.indexOf(sourceSessionId)
  if (sourceIndex < 0 || !order.includes(targetSessionId)) return null
  const [source] = order.splice(sourceIndex, 1)
  if (!source) return null
  const targetIndex = order.indexOf(targetSessionId)
  order.splice(targetIndex + (placeAfter ? 1 : 0), 0, source)
  return order
}
