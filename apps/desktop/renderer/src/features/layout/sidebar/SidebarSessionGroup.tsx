import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Archive, Copy, LoaderCircle, Pencil, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import { sessionDisplayTitle, type SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../../motion/motionTransitions.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import { sortSessionsForSidebar } from '../../session/sessionSorting.js'
import { SidebarRow } from "./SidebarRow.js";
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { cx } from "../../../utils/cx.js";
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from "./SidebarContextMenu.js";

const GROUP_LIMIT = 5;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Props = {
  activeSessionId: string | null;
  groupKey: string;
  now: number;
  pendingPermissionSessionIds: ReadonlySet<string>;
  sessionFallbackTitles: Record<string, string>;
  sessions: SessionListItem[];
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarSessionGroup({
  activeSessionId,
  groupKey,
  now,
  pendingPermissionSessionIds,
  sessionFallbackTitles,
  sessions,
  onArchiveSessions,
  onPinSession,
  onSelectSession,
  onRenameSession,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<
    string | null
  >(null);
  const [visibleLimit, setVisibleLimit] = useState(GROUP_LIMIT);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [renameSession, setRenameSession] = useState<SessionListItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const {
    sidebarSort,
    sidebarManualOrder,
    setSidebarManualOrder,
  } = useDesktopSettings()
  const needsInputSessionIds = pendingPermissionSessionIds
  const unreadSessionIds = useMemo(
    () => new Set(sessions.filter(session => session.unreadAt).map(session => session.id)),
    [sessions],
  )
  const sortedSessions = useMemo(
    () =>
      sortSessionsForSidebar(sessions, {
        sort: sidebarSort,
        needsInputSessionIds,
        unreadSessionIds,
        scopeKey: groupKey,
        manualOrderByScope: sidebarManualOrder,
      }),
    [
      groupKey,
      needsInputSessionIds,
      sidebarManualOrder,
      sidebarSort,
      sessions,
      unreadSessionIds,
    ],
  )
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(sortedSessions, visibleLimit);

  useEffect(() => {
    setVisibleLimit(GROUP_LIMIT);
  }, [groupKey]);

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
          setRenameValue(sessionDisplayTitle(session, sessionFallbackTitles[session.id]))
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
    const awaitingApproval =
      session.status === "waiting" ||
      pendingPermissionSessionIds.has(session.id);
    const metaClassName = cx(
      "sidebar-session-meta",
      "u-flex",
      "u-items-center",
      "u-justify-end",
      awaitingApproval ? "u-w-auto" : "u-w-full",
      awaitingApproval && "sidebar-session-meta--approval",
      confirmArchiveSessionId === session.id && "confirming-archive",
    );
    const row = (
      <SidebarRow
        active={session.id === activeSessionId}
        as="li"
        className="sidebar-session-row"
        draggable={sidebarSort === 'manual'}
        indent="session"
        key={session.id}
        onDragOver={event => {
          if (sidebarSort === 'manual') event.preventDefault()
        }}
        onDragStart={event => {
          if (sidebarSort !== 'manual') return
          setDraggedSessionId(session.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDrop={event => {
          event.preventDefault()
          if (sidebarSort !== 'manual' || !draggedSessionId || draggedSessionId === session.id) {
            setDraggedSessionId(null)
            return
          }
          const order = sortedSessions.map(item => item.id)
          const fromIndex = order.indexOf(draggedSessionId)
          const toIndex = order.indexOf(session.id)
          if (fromIndex < 0 || toIndex < 0) {
            setDraggedSessionId(null)
            return
          }
          order.splice(fromIndex, 1)
          order.splice(toIndex, 0, draggedSessionId)
          setSidebarManualOrder({ ...sidebarManualOrder, [groupKey]: order })
          setDraggedSessionId(null)
        }}
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
        onKeyDown={event => {
          if (
            sidebarSort !== 'manual' ||
            !event.altKey ||
            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
          ) {
            return
          }
          event.preventDefault()
          const order = sortedSessions.map(item => item.id)
          const currentIndex = order.indexOf(session.id)
          const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
          if (nextIndex < 0 || nextIndex >= order.length) return
          ;[order[currentIndex], order[nextIndex]] = [order[nextIndex]!, order[currentIndex]!]
          setSidebarManualOrder({ ...sidebarManualOrder, [groupKey]: order })
        }}
        trailing={
          <div className={metaClassName}>
            {awaitingApproval ? (
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
            ) : confirmArchiveSessionId === session.id ? (
              <button
                className="sidebar-session-confirm-archive-button"
                onClick={() => void onArchiveSessions([session])}
                title="确认归档"
                type="button"
              >
                确认
              </button>
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
            ) : (
              <span className="sidebar-session-time">
                {formatRelativeConversationTime(
                  session.lastMessageAt ?? session.createdAt,
                  now,
                )}
              </span>
            )}
          </div>
        }
      >
        <button
          className="sidebar-session-button"
          onClick={() => {
            onSelectSession(session);
          }}
          type="button"
        >
          <span className={cx('sidebar-session-title', 'u-min-w-0', 'u-truncate')}>
            {sessionDisplayTitle(session, sessionFallbackTitles[session.id])}
            {session.unreadAt ? (
              <span aria-label="未读" className="sidebar-session-unread-dot" />
            ) : null}
          </span>
        </button>
      </SidebarRow>
    );
    return (
      <SidebarContextMenu
        key={session.id}
        actions={getSessionContextMenuActions(session)}
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
      <ConfirmationDialog
        actionDisabled={renaming || renameValue.trim().length === 0}
        actionLabel={renaming ? '重命名中…' : '重命名'}
        input={{
          value: renameValue,
          onChange: setRenameValue,
          maxLength: 160,
          placeholder: '输入任务名称',
        }}
        open={renameSession !== null}
        title="重命名任务"
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

export function getSidebarSessionDisplayGroups<T>(
  sessions: readonly T[],
  visibleLimit: number,
): {
  baseSessions: T[];
  canCollapse: boolean;
  canShowMore: boolean;
  extraSessions: T[];
  hasOverflow: boolean;
} {
  const hasOverflow = sessions.length > GROUP_LIMIT;
  const clampedVisibleLimit = Math.min(
    Math.max(GROUP_LIMIT, visibleLimit),
    sessions.length,
  );
  return {
    baseSessions: sessions.slice(0, GROUP_LIMIT),
    canCollapse: clampedVisibleLimit > GROUP_LIMIT,
    canShowMore: clampedVisibleLimit < sessions.length,
    extraSessions: hasOverflow
      ? sessions.slice(GROUP_LIMIT, clampedVisibleLimit)
      : [],
    hasOverflow,
  };
}

function formatRelativeConversationTime(
  timestamp: string | null | undefined,
  now: number,
): string {
  const time = new Date(timestamp ?? "").getTime();
  if (Number.isNaN(time)) return "刚刚";

  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return "刚刚";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时`;

  // Calendar-based comparison using local timezone date boundaries
  const from = new Date(time);
  const to = new Date(now);

  const fromDate = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  );
  const toDate = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const calendarDayDiff = Math.round(
    (toDate.getTime() - fromDate.getTime()) / DAY_MS,
  );

  if (calendarDayDiff < 7) {
    return `${calendarDayDiff} 天`;
  }

  // Check for full natural year
  const yearDiff = to.getFullYear() - from.getFullYear();
  const totalMonthDiff =
    to.getFullYear() * 12 +
    to.getMonth() -
    (from.getFullYear() * 12 + from.getMonth());

  if (yearDiff >= 1) {
    if (
      to.getMonth() > from.getMonth() ||
      (to.getMonth() === from.getMonth() && to.getDate() >= from.getDate())
    ) {
      return `${yearDiff} 年`;
    }
    if (yearDiff > 1) {
      return `${yearDiff - 1} 年`;
    }
  }

  // Check for full natural month
  if (totalMonthDiff >= 1) {
    if (to.getDate() >= from.getDate()) {
      return `${totalMonthDiff} 月`;
    }
    if (totalMonthDiff > 1) {
      return `${totalMonthDiff - 1} 月`;
    }
  }

  // Weeks
  return `${Math.floor(calendarDayDiff / 7)} 周`;
}
