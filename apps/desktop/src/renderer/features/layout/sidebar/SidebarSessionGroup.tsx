import type React from "react";
import { useEffect, useState } from "react";
import { Archive, Copy, Loader2, Pencil, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import { sessionDisplayTitle, type SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'
import { motionTransition, standardTween } from '../../motion/motionTransitions.js'
import { SidebarRow } from "./SidebarRow.js";
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
  sessions: SessionListItem[];
  onArchiveSession: (session: SessionListItem) => void;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarSessionGroup({
  activeSessionId,
  groupKey,
  now,
  sessions,
  onArchiveSession,
  onPinSession,
  onSelectSession,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<
    string | null
  >(null);
  const [visibleLimit, setVisibleLimit] = useState(GROUP_LIMIT);
  const reducedMotion = usePrefersReducedMotion()
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(sessions, visibleLimit);

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
          // eslint-disable-next-line no-console
          console.log("[TODO] rename session", session.id);
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
        onSelect: () => onArchiveSession(session),
      },
    ];
  }

  function renderSessionRow(session: SessionListItem): React.ReactNode {
    const row = (
      <SidebarRow
        active={session.id === activeSessionId}
        as="li"
        className="sidebar-session-row"
        indent="session"
        key={session.id}
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() => {
          setHoveredSessionId((current) =>
            current === session.id ? null : current,
          );
          setConfirmArchiveSessionId((current) =>
            current === session.id ? null : current,
          );
        }}
        trailing={
          <div
            className={
              confirmArchiveSessionId === session.id
                ? "sidebar-session-meta confirming-archive"
                : "sidebar-session-meta"
            }
          >
            {session.status === "running" ? (
              <Loader2
                aria-label="加载中"
                className="sidebar-session-spinner"
                size={APP_ICON_SIZE}
              />
            ) : confirmArchiveSessionId === session.id ? (
              <button
                className="sidebar-session-confirm-archive-button"
                onClick={() => onArchiveSession(session)}
                title="确认归档"
                type="button"
              >
                确认
              </button>
            ) : hoveredSessionId === session.id ? (
              <div className="sidebar-session-actions">
                {session.pinnedAt ? (
                  <IconButton
                    className="icon-button sidebar-session-action-button"
                    onClick={() => onUnpinSession(session)}
                    title="取消置顶"
                  >
                    <PinOff size={APP_ICON_SIZE} />
                  </IconButton>
                ) : (
                  <IconButton
                    className="icon-button sidebar-session-action-button"
                    onClick={() => onPinSession(session)}
                    title="置顶"
                  >
                    <Pin size={APP_ICON_SIZE} />
                  </IconButton>
                )}
                <IconButton
                  className="icon-button sidebar-session-action-button"
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
          <span className="sidebar-session-title">
            {sessionDisplayTitle(session)}
          </span>
        </button>
      </SidebarRow>
    );
    return (
      <SidebarContextMenu
        key={session.id}
        actions={getSessionContextMenuActions(session)}
        trigger={row}
      />
    );
  }

  return (
    <>
      <ul className="sidebar-session-list">
        {baseSessions.map(renderSessionRow)}
      </ul>
      <AnimatePresence initial={false}>
        {extraSessions.length > 0 ? (
          <motion.ul
            animate={{ height: "auto", opacity: 1 }}
            className="sidebar-session-list sidebar-session-list-extra"
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
          {canShowMore ? (
            <button
              aria-expanded={canCollapse}
              className="sidebar-show-more-button"
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
              className="sidebar-show-more-button"
              onClick={() => setVisibleLimit(GROUP_LIMIT)}
              type="button"
            >
              <span>折叠显示</span>
            </button>
          ) : null}
        </div>
      ) : null}
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
