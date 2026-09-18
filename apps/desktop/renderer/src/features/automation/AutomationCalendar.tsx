import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { CalendarOccurrence } from '@codepilotx/shared/calendar'
import * as Popover from '@radix-ui/react-popover'
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Play,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  addCalendarMonths,
  formatDateValue,
  parseDateValue,
} from '../../components/ui/DatePicker.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { cx } from '../../utils/cx.js'
import {
  calendarDates,
  calendarStatusLabel as statusLabel,
  calendarOccurrencesByDate,
  type CalendarDateCell,
} from './calendarDates.js'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

const MONTH_LABELS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
] as const

export type CalendarStatusKind =
  | 'info'
  | 'warning'
  | 'accent'
  | 'success'
  | 'danger'

type Props = {
  occurrences: readonly CalendarOccurrence[]
  refreshing?: boolean
  refreshError?: string | null
  truncated?: boolean
  highlightProposalId?: string
  selectedDate?: string
  defaultSelectedDate?: string
  onSelectedDateChange?: (value: string) => void
  onVisibleRangeChange?: (range: { from: number; to: number }) => void
  onRefresh?: () => void
  onOccurrenceSelect: (occurrence: CalendarOccurrence) => void
  onRunOccurrence?: (occurrence: CalendarOccurrence) => void
  onOpenThread?: (threadId: string) => void
}

export function AutomationCalendar({
  occurrences,
  refreshing = false,
  refreshError = null,
  selectedDate,
  defaultSelectedDate,
  onSelectedDateChange,
  onVisibleRangeChange,
  onOccurrenceSelect,
  onRunOccurrence,
  onOpenThread,
}: Props): React.ReactNode {
  const today = useMemo(() => new Date(), [])
  const initialDate =
    parseDateValue(selectedDate ?? defaultSelectedDate) ?? today
  const [internalSelectedDate, setInternalSelectedDate] = useState(
    formatDateValue(initialDate),
  )
  const activeDateValue = selectedDate ?? internalSelectedDate

  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12),
  )
  const [focusedDate, setFocusedDate] = useState(initialDate)

  // Month picker popover state
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => visibleMonth.getFullYear())

  // Monthly tasks list popover state
  const [tasksPopoverOpen, setTasksPopoverOpen] = useState(false)

  useEffect(() => {
    if (monthPickerOpen) {
      setPickerYear(visibleMonth.getFullYear())
    }
  }, [monthPickerOpen, visibleMonth])

  const currentMonthOccurrences = useMemo(() => {
    const targetYear = visibleMonth.getFullYear()
    const targetMonth = visibleMonth.getMonth()
    return occurrences
      .filter(item => {
        const d = new Date(item.scheduledFor)
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth
      })
      .slice()
      .sort((a, b) => a.scheduledFor - b.scheduledFor || a.title.localeCompare(b.title, 'zh-CN'))
  }, [occurrences, visibleMonth])

  const occurrencesByDate = useMemo(
    () => calendarOccurrencesByDate(occurrences),
    [occurrences],
  )

  const monthCells = useMemo(
    () => calendarDates(visibleMonth, today),
    [visibleMonth, today],
  )

  // Notify visible 42-day range
  useEffect(() => {
    if (!onVisibleRangeChange || monthCells.length === 0) return
    const first = monthCells[0].date
    const last = monthCells[monthCells.length - 1].date
    const from = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate(),
      0,
      0,
      0,
      0,
    ).getTime()
    const to = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate(),
      23,
      59,
      59,
      999,
    ).getTime()
    onVisibleRangeChange({ from, to })
  }, [monthCells, onVisibleRangeChange])

  // Sync selectedDate from prop
  useEffect(() => {
    if (!selectedDate) return
    const parsed = parseDateValue(selectedDate)
    if (!parsed) return
    setInternalSelectedDate(selectedDate)
    setFocusedDate(parsed)
    if (
      parsed.getFullYear() !== visibleMonth.getFullYear() ||
      parsed.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(
        new Date(parsed.getFullYear(), parsed.getMonth(), 1, 12),
      )
    }
  }, [selectedDate, visibleMonth])


  function selectDate(date: Date): void {
    const value = formatDateValue(date)
    setInternalSelectedDate(value)
    setFocusedDate(date)
    onSelectedDateChange?.(value)
    if (
      date.getFullYear() !== visibleMonth.getFullYear() ||
      date.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    }
  }

  function handleMonthChange(delta: number): void {
    const nextMonth = addCalendarMonths(visibleMonth, delta)
    setVisibleMonth(nextMonth)
    setFocusedDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1, 12))
  }

  function handleToday(): void {
    const now = new Date()
    selectDate(now)
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    let next: Date | null = null
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(focusedDate, -1)
        break
      case 'ArrowRight':
        next = addDays(focusedDate, 1)
        break
      case 'ArrowUp':
        next = addDays(focusedDate, -7)
        break
      case 'ArrowDown':
        next = addDays(focusedDate, 7)
        break
      case 'Home': {
        const dayOfWeek = (focusedDate.getDay() + 6) % 7
        next = addDays(focusedDate, -dayOfWeek)
        break
      }
      case 'End': {
        const dayOfWeek = (focusedDate.getDay() + 6) % 7
        next = addDays(focusedDate, 6 - dayOfWeek)
        break
      }
      case 'PageUp':
        next = addCalendarMonths(focusedDate, -1)
        break
      case 'PageDown':
        next = addCalendarMonths(focusedDate, 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectDate(focusedDate)
        return
      default:
        return
    }
    if (next) {
      event.preventDefault()
      setFocusedDate(next)
      if (
        next.getFullYear() !== visibleMonth.getFullYear() ||
        next.getMonth() !== visibleMonth.getMonth()
      ) {
        setVisibleMonth(
          new Date(next.getFullYear(), next.getMonth(), 1, 12),
        )
      }
      const nextValue = formatDateValue(next)
      const target = document.querySelector<HTMLElement>(
        `[data-calendar-date="${nextValue}"]`,
      )
      target?.focus()
    }
  }
  const selectedDateObj = useMemo(
    () => parseDateValue(activeDateValue) ?? initialDate,
    [activeDateValue, initialDate],
  )

  const selectedDayOccurrences = useMemo(
    () => occurrencesByDate.get(activeDateValue) ?? [],
    [occurrencesByDate, activeDateValue],
  )

  const sortedOccurrences = useMemo(() => {
    return [...selectedDayOccurrences].sort((a, b) => {
      if (a.scheduledFor !== b.scheduledFor) {
        return a.scheduledFor - b.scheduledFor
      }
      const titleComp = a.title.localeCompare(b.title)
      if (titleComp !== 0) return titleComp
      return a.id.localeCompare(b.id)
    })
  }, [selectedDayOccurrences])

  return (
    <div className="automation-calendar">
      {/* Top Section: Month Toolbar */}
      <div className="automation-calendar__toolbar">
        <div className="automation-calendar__title-group">
          {/* Month Picker Dropdown */}
          <Popover.Root open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="automation-calendar__month-trigger"
                aria-label={`选择年月，当前为 ${monthLabel(visibleMonth)}`}
              >
                <h2 className="automation-calendar__period">
                  {monthLabel(visibleMonth)}
                </h2>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className="automation-calendar__month-trigger-icon"
                />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="popover-surface automation-calendar__month-picker-popover"
                side="bottom"
                align="start"
                sideOffset={6}
              >
                <div className="automation-calendar__year-nav">
                  <IconButton
                    size="iconSm"
                    color="ghost"
                    title="上一年"
                    aria-label="上一年"
                    onClick={() => setPickerYear(y => y - 1)}
                  >
                    <ChevronLeft size={14} />
                  </IconButton>
                  <span className="automation-calendar__year-label">
                    {pickerYear}年
                  </span>
                  <IconButton
                    size="iconSm"
                    color="ghost"
                    title="下一年"
                    aria-label="下一年"
                    onClick={() => setPickerYear(y => y + 1)}
                  >
                    <ChevronRight size={14} />
                  </IconButton>
                </div>
                <div className="automation-calendar__month-grid">
                  {MONTH_LABELS.map((name, index) => {
                    const isCurrent =
                      visibleMonth.getFullYear() === pickerYear &&
                      visibleMonth.getMonth() === index
                    return (
                      <button
                        key={name}
                        type="button"
                        className={cx(
                          'automation-calendar__month-grid-btn',
                          isCurrent && 'automation-calendar__month-grid-btn--active',
                        )}
                        onClick={() => {
                          const nextMonth = new Date(pickerYear, index, 1, 12)
                          setVisibleMonth(nextMonth)
                          setFocusedDate(nextMonth)
                          setMonthPickerOpen(false)
                        }}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {/* Monthly Tasks Button & Popover */}
          <Popover.Root open={tasksPopoverOpen} onOpenChange={setTasksPopoverOpen}>
            <Popover.Trigger asChild>
              <Button
                color="secondary"
                size="compact"
                className="automation-calendar__tasks-trigger"
                aria-label={`查看当月任务列表，共 ${currentMonthOccurrences.length} 项`}
              >
                {currentMonthOccurrences.length} 项任务
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="popover-surface automation-calendar__tasks-popover"
                side="bottom"
                align="start"
                sideOffset={6}
              >
                <div className="automation-calendar__tasks-popover-header">
                  <span className="automation-calendar__tasks-popover-title">
                    {monthLabel(visibleMonth)}任务清单
                  </span>
                  <span className="automation-calendar__tasks-popover-count">
                    共 {currentMonthOccurrences.length} 项
                  </span>
                </div>
                <div className="automation-calendar__tasks-popover-list" role="list">
                  {currentMonthOccurrences.length === 0 ? (
                    <div className="automation-calendar__tasks-popover-empty">
                      当月暂无任务
                    </div>
                  ) : (
                    currentMonthOccurrences.map(occ => {
                      const occDate = new Date(occ.scheduledFor)
                      const dateText = `${occDate.getMonth() + 1}月${occDate.getDate()}日`
                      const timeText = timeLabel(occ.scheduledFor)
                      return (
                        <button
                          key={occ.id}
                          type="button"
                          className="automation-calendar__tasks-popover-item"
                          onClick={() => {
                            selectDate(occDate)
                            setTasksPopoverOpen(false)
                          }}
                        >
                          <span className="automation-calendar__tasks-popover-time">
                            {dateText} {timeText}
                          </span>
                          <span
                            className="automation-calendar__agenda-dot"
                            data-status={occurrenceStatusKind(occ)}
                            aria-hidden="true"
                          />
                          <span className="automation-calendar__tasks-popover-item-title">
                            {occ.title}
                          </span>
                          <span className="automation-calendar__tasks-popover-source">
                            {sourceLabel(occ)}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {refreshing ? (
            <span className="automation-calendar__sync-status">
              <Spinner size="small" />
              正在同步...
            </span>
          ) : refreshError ? (
            <span className="automation-calendar__sync-status automation-calendar__sync-status--error">
              同步失败
            </span>
          ) : null}
        </div>
        <div className="automation-calendar__nav">
          <IconButton
            size="compact"
            color="ghost"
            title="上个月"
            aria-label="上个月"
            onClick={() => handleMonthChange(-1)}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <Button size="compact" color="secondary" onClick={handleToday}>
            今天
          </Button>
          <IconButton
            size="compact"
            color="ghost"
            title="下个月"
            aria-label="下个月"
            onClick={() => handleMonthChange(1)}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>

      {/* Compact Month Calendar Grid */}
      <div className="automation-calendar__month-view">
        <div className="automation-calendar__weekdays" role="row">
          {WEEKDAYS.map(name => (
            <span
              key={name}
              className="automation-calendar__weekday"
              role="columnheader"
            >
              {name}
            </span>
          ))}
        </div>
        <div
          className="automation-calendar__grid"
          role="grid"
          aria-label="任务日历"
          onKeyDown={handleGridKeyDown}
        >
          {monthCells.map(cell => {
            const cellOccurrences = occurrencesByDate.get(cell.value) ?? []
            const visibleDots = cellOccurrences.slice(0, 4)
            const overflow = cellOccurrences.length - 4
            const isSelected = cell.value === activeDateValue
            const isFocused = isSameDate(cell.date, focusedDate)

            return (
              <button
                key={cell.value}
                type="button"
                role="gridcell"
                className="automation-calendar__day"
                data-calendar-date={cell.value}
                data-today={cell.today ? '' : undefined}
                data-selected={isSelected ? '' : undefined}
                data-other-month={!cell.currentMonth ? '' : undefined}
                aria-selected={isSelected}
                aria-label={dayLabel(cell.date, cellOccurrences.length)}
                tabIndex={isFocused ? 0 : -1}
                onClick={() => selectDate(cell.date)}
              >
                <span className="automation-calendar__day-num">{cell.day}</span>
                <div className="automation-calendar__dots" aria-hidden="true">
                  {visibleDots.map((occ, idx) => (
                    <span
                      key={occ.id || idx}
                      className="automation-calendar__dot"
                      data-status={occurrenceStatusKind(occ)}
                    />
                  ))}
                  {overflow > 0 ? (
                    <span className="automation-calendar__dot-overflow">
                      +{overflow}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Residing Agenda Below */}
      <section className="automation-calendar__residing-agenda">
        <div className="automation-calendar__agenda-header">
          <div className="automation-calendar__agenda-title-group">
            <h3 className="automation-calendar__agenda-title">
              {agendaDateHeading(selectedDateObj)}
            </h3>
            <span className="automation-calendar__agenda-count">
              {selectedDayOccurrences.length} 项任务
            </span>
          </div>
        </div>

        {/* Task List */}
        <div className="automation-calendar__agenda-list">
          {sortedOccurrences.length === 0 ? (
            <div className="automation-calendar__agenda-empty">
              <Calendar
                className="automation-calendar__agenda-empty-icon"
                size={24}
                aria-hidden="true"
              />
              <p className="automation-calendar__agenda-empty-text">
                当日暂无任务
              </p>
            </div>
          ) : (
            sortedOccurrences.map(occurrence => (
              <div
                key={occurrence.id}
                className="automation-calendar__agenda-item"
                role="button"
                tabIndex={0}
                onClick={() => onOccurrenceSelect(occurrence)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOccurrenceSelect(occurrence)
                  }
                }}
              >
                <div className="automation-calendar__agenda-time">
                  <span className="automation-calendar__agenda-time-text">
                    {timeLabel(occurrence.scheduledFor)}
                  </span>
                  <span
                    className="automation-calendar__agenda-dot"
                    data-status={occurrenceStatusKind(occurrence)}
                  />
                </div>
                <div className="automation-calendar__agenda-main">
                  <span className="automation-calendar__agenda-item-title">
                    {occurrence.title}
                  </span>
                  <span className="automation-calendar__agenda-item-meta">
                    {sourceLabel(occurrence)} · {statusLabel(occurrence.status)}
                  </span>
                </div>
                <div className="automation-calendar__agenda-actions">
                  {occurrence.source.kind === 'automation' && onRunOccurrence ? (
                    <IconButton
                      size="iconSm"
                      color="ghost"
                      title="立即运行"
                      aria-label="立即运行"
                      onClick={e => {
                        e.stopPropagation()
                        onRunOccurrence(occurrence)
                      }}
                    >
                      <Play size={12} />
                    </IconButton>
                  ) : null}
                  {occurrence.threadId && onOpenThread ? (
                    <IconButton
                      size="iconSm"
                      color="ghost"
                      title="查看会话"
                      aria-label="查看会话"
                      onClick={e => {
                        e.stopPropagation()
                        onOpenThread(occurrence.threadId!)
                      }}
                    >
                      <MessageSquare size={12} />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function addDays(date: Date, amount: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + amount,
    12,
  )
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

function agendaDateHeading(date: Date): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
}

function dayLabel(date: Date, count: number): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
  const dateText = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`
  return count ? `${dateText}，${count} 项任务` : `${dateText}，没有任务`
}

export function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function sourceLabel(occurrence: CalendarOccurrence): string {
  if (occurrence.source.kind === 'automation') return '自动化执行'
  return occurrence.definitionKind === 'recurring' ? '重复计划' : '计划任务'
}

export function occurrenceStatusKind(
  occurrence: CalendarOccurrence,
): CalendarStatusKind {
  if (occurrence.source.kind === 'automation') {
    if (occurrence.status === 'completed') return 'success'
    if (
      occurrence.status === 'failed' ||
      occurrence.status === 'interrupted'
    ) {
      return 'danger'
    }
    if (
      occurrence.status === 'running' ||
      occurrence.status === 'preparing' ||
      occurrence.status === 'queued' ||
      occurrence.status === 'claimed'
    ) {
      return 'accent'
    }
    if (occurrence.status === 'paused') return 'warning'
    return 'info'
  }
  switch (occurrence.status) {
    case 'completed':
      return 'success'
    case 'failed':
    case 'interrupted':
      return 'danger'
    case 'running':
    case 'queued':
    case 'preparing':
    case 'claimed':
      return 'accent'
    case 'paused':
      return 'warning'
    case 'scheduled':
    default:
      return 'info'
  }
}

export function defaultTimeStringForDate(value: string): string {
  const ts = scheduledTimeForDate(value)
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function scheduledTimeForDate(value: string): number {
  const date = new Date(`${value}T09:00`)
  const now = new Date()
  const todayVal = formatDateValue(now)
  if (todayVal !== value) return date.getTime()
  if (date.getTime() > now.getTime()) return date.getTime()
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  return next.getTime()
}

export function parseDateTimeToTimestamp(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0)
  return date.getTime()
}
