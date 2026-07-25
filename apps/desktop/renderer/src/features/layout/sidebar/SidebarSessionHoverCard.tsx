import type React from 'react'
import { Folder, GitBranch } from 'lucide-react'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { sessionDisplayTitle, type SessionListItem } from '../../../uiTypes.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

export type SidebarSessionHoverCardModel = {
  title: string
  relativeTime: string
  projectLabel: string
  gitBranch: string | null
}

export function formatSidebarSessionRelativeTime(
  timestamp: string | null | undefined,
  now: number,
): string {
  const time = new Date(timestamp ?? '').getTime()
  if (Number.isNaN(time)) return '刚刚'

  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE_MS) return '刚刚'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时`
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / DAY_MS)} 天`
  if (elapsed < YEAR_MS) return `${Math.floor(elapsed / MONTH_MS)} 月`
  return `${Math.floor(elapsed / YEAR_MS)} 年`
}

export function buildSidebarSessionHoverCardModel(
  session: SessionListItem,
  fallbackTitle: string | undefined,
  now: number,
): SidebarSessionHoverCardModel {
  const projectLabel = session.standalone
    ? '会话'
    : session.workspaceName.trim() || '会话'
  const gitBranch = session.gitBranch?.trim() || null
  return {
    title: sessionDisplayTitle(session, fallbackTitle),
    relativeTime: formatSidebarSessionRelativeTime(
      session.lastMessageAt ?? session.createdAt,
      now,
    ),
    projectLabel,
    gitBranch,
  }
}

type Props = {
  children: React.ReactNode
  fallbackTitle: string | undefined
  now: number
  session: SessionListItem
}

export function SidebarSessionHoverCard({
  children,
  fallbackTitle,
  now,
  session,
}: Props): React.ReactNode {
  const model = buildSidebarSessionHoverCardModel(session, fallbackTitle, now)
  return (
    <Tooltip
      align="center"
      className="sidebar-session-hover-card"
      content={(
        <div className="sidebar-session-hover-card-content">
          <div className="sidebar-session-hover-card-header">
            <span className="sidebar-session-hover-card-title">{model.title}</span>
            <span className="sidebar-session-hover-card-time">{model.relativeTime}</span>
          </div>
          <div className="sidebar-session-hover-card-row">
            <Folder aria-hidden="true" size={16} />
            <span>{model.projectLabel}</span>
          </div>
          {model.gitBranch ? (
            <div className="sidebar-session-hover-card-row">
              <GitBranch aria-hidden="true" size={16} />
              <span>{model.gitBranch}</span>
            </div>
          ) : null}
        </div>
      )}
      delayDuration={400}
      side="right"
      sideOffset={6}
      variant="unstyled"
    >
      {children}
    </Tooltip>
  )
}
