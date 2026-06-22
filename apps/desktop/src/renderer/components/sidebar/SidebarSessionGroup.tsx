import type React from "react";
import { useEffect, useState } from "react";
import { Archive, Loader2, Pin, PinOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { APP_ICON_SIZE } from "../ui/iconTokens.js";
import { sessionDisplayTitle, type SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { SidebarRow } from "./SidebarRow.js";

const GROUP_LIMIT = 5;
const EXTRA_SESSIONS_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
} as const;
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
  const {
    baseSessions,
    canCollapse,
    canShowMore,
    extraSessions,
    hasOverflow,
  } = getSidebarSessionDisplayGroups(sessions, visibleLimit);

  useEffect(() => {
    setVisibleLimit(GROUP_LIMIT);
  }, [groupKey]);

  function renderSessionRow(session: SessionListItem): React.ReactNode {
    return (
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
            console.log("[desktop-title-debug] sidebar_select", {
              id: session.id,
              isActive: session.id === activeSessionId,
              sessionName: session.sessionName,
              customTitle: session.customTitle,
              aiTitle: session.aiTitle,
              firstPrompt: session.firstPrompt,
              displayTitle: sessionDisplayTitle(session),
            });
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
            transition={EXTRA_SESSIONS_TRANSITION}
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
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时`;
  return `${Math.floor(elapsed / DAY_MS)} 天`;
}
