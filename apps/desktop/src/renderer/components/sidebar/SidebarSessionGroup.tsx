import type React from "react";
import { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pin,
  PinOff,
} from "lucide-react";
import { sessionDisplayTitle, type SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";

const GROUP_LIMIT = 5;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Props = {
  activeSessionId: string | null;
  groupKey: string;
  isExpanded: boolean;
  now: number;
  sessions: SessionListItem[];
  onArchiveSession: (session: SessionListItem) => void;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleExpanded: (groupKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarSessionGroup({
  activeSessionId,
  groupKey,
  isExpanded,
  now,
  sessions,
  onArchiveSession,
  onPinSession,
  onSelectSession,
  onToggleExpanded,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<
    string | null
  >(null);
  const visibleSessions = isExpanded ? sessions : sessions.slice(0, GROUP_LIMIT);

  return (
    <>
      <ul className="sidebar-session-list">
        {visibleSessions.map((session) => (
          <li
            className={
              session.id === activeSessionId
                ? "sidebar-session-row active"
                : "sidebar-session-row"
            }
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
                  size={14}
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
                      <PinOff size={14} />
                    </IconButton>
                  ) : (
                    <IconButton
                      className="icon-button sidebar-session-action-button"
                      onClick={() => onPinSession(session)}
                      title="置顶"
                    >
                      <Pin size={14} />
                    </IconButton>
                  )}
                  <IconButton
                    className="icon-button sidebar-session-action-button"
                    onClick={() => setConfirmArchiveSessionId(session.id)}
                    title="归档"
                  >
                    <Archive size={14} />
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
          </li>
        ))}
      </ul>
      {sessions.length > GROUP_LIMIT ? (
        <button
          className="sidebar-show-more-button"
          onClick={() => onToggleExpanded(groupKey)}
          type="button"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{isExpanded ? "收起" : "展开显示"}</span>
        </button>
      ) : null}
    </>
  );
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
