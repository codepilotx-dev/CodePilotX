import type React from 'react'
import type { CalendarOccurrence } from '@codepilotx/shared/calendar'
import { MessageSquare, Play, Plus, X } from 'lucide-react'
import { parseDateValue } from '../../components/ui/DatePicker.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { calendarStatusLabel as statusLabel } from './calendarDates.js'
import { sourceLabel, timeLabel } from './AutomationCalendar.js'

type Props = {
  dateValue: string
  occurrences: readonly CalendarOccurrence[]
  highlightedOccurrenceId: string | null
  onOccurrenceSelect: (occurrence: CalendarOccurrence) => void
  onQuickCreate?: (dateValue: string, trigger?: HTMLElement | null) => void
  onClose: () => void
  onRunOccurrence?: (occurrence: CalendarOccurrence) => void
  onOpenThread?: (threadId: string) => void
}

export function AutomationAgenda({
  dateValue,
  occurrences,
  highlightedOccurrenceId,
  onOccurrenceSelect,
  onQuickCreate,
  onClose,
  onRunOccurrence,
  onOpenThread,
}: Props): React.ReactNode {
  const agendaGroups = [
    {
      label: '上午',
      occurrences: occurrences.filter(
        item => new Date(item.scheduledFor).getHours() < 12,
      ),
    },
    {
      label: '下午',
      occurrences: occurrences.filter(item => {
        const hour = new Date(item.scheduledFor).getHours()
        return hour >= 12 && hour < 18
      }),
    },
    {
      label: '晚上',
      occurrences: occurrences.filter(
        item => new Date(item.scheduledFor).getHours() >= 18,
      ),
    },
  ].filter(group => group.occurrences.length > 0)

  return (
    <section className="automation-calendar__focus-agenda">
      <header className="automation-calendar__agenda-header">
        <div className="automation-calendar__agenda-header-text">
          <h3>{fullDateLabel(dateValue)}</h3>
        </div>
        <div className="automation-calendar__agenda-header-actions">
          {onQuickCreate ? (
            <Button
              color="ghostSecondary"
              size="compact"
              aria-label={`在 ${dateValue} 新建任务`}
              onClick={event => onQuickCreate(dateValue, event.currentTarget)}
            >
              <Plus aria-hidden="true" size={12} />
              <span>新建</span>
            </Button>
          ) : null}
          <IconButton
            color="ghostSecondary"
            size="toolbar"
            title="关闭当日议程"
            onClick={onClose}
          >
            <X aria-hidden="true" size={APP_ICON_SIZE} />
          </IconButton>
        </div>
      </header>
      <div className="automation-calendar__agenda-groups">
        {agendaGroups.map(group => (
          <section key={group.label}>
            <h4>{group.label}</h4>
            <ol>
              {group.occurrences.map(occurrence => (
                <li key={occurrence.id}>
                  <div
                    className="automation-calendar__agenda-item"
                    data-highlighted={
                      occurrence.id === highlightedOccurrenceId || undefined
                    }
                    data-status={occurrence.status}
                  >
                    <span
                      className="automation-calendar__status-bar"
                      data-status={occurrence.status}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="automation-calendar__agenda-content"
                      data-agenda-occurrence-id={occurrence.id}
                      onClick={() => onOccurrenceSelect(occurrence)}
                    >
                      <span className="automation-calendar__agenda-title">
                        <time>{timeLabel(occurrence.scheduledFor)}</time>
                        <strong>{occurrence.title}</strong>
                      </span>
                      <span className="automation-calendar__agenda-meta">
                        {sourceLabel(occurrence)} ·{' '}
                        {statusLabel(occurrence.status)}
                      </span>
                    </button>
                    <div className="automation-calendar__agenda-item-actions">
                      {onRunOccurrence && occurrence.source.kind === 'automation' ? (
                        <IconButton
                          color="ghostSecondary"
                          size="toolbar"
                          title="立即运行"
                          onClick={() => onRunOccurrence(occurrence)}
                        >
                          <Play aria-hidden="true" size={12} />
                        </IconButton>
                      ) : null}
                      {occurrence.threadId && onOpenThread ? (
                        <IconButton
                          color="ghostSecondary"
                          size="toolbar"
                          title="查看会话"
                          onClick={() => onOpenThread(occurrence.threadId!)}
                        >
                          <MessageSquare aria-hidden="true" size={12} />
                        </IconButton>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  )
}

function fullDateLabel(value: string): string {
  const date = parseDateValue(value)
  return date
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(date)
    : value
}
