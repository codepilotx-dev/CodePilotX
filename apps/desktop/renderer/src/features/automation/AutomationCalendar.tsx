import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { CalendarOccurrence } from '@codepilotx/shared/calendar'
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import {
  addCalendarMonths,
  formatDateValue,
  parseDateValue,
} from '../../components/ui/DatePicker.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import {
  calendarDates,
  calendarStatusLabel as statusLabel,
  calendarOccurrencesByDate,
  calendarWeekDates,
  groupOccurrencesForList,
  type CalendarDateCell,
} from './calendarDates.js'

const WEEKDAYS = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
] as const

export type CalendarViewMode = 'month' | 'week' | 'list'

type Props = {
  occurrences: readonly CalendarOccurrence[]
  refreshing?: boolean
  refreshError?: string | null
  truncated?: boolean
  highlightProposalId?: string
  selectedDate?: string
  defaultSelectedDate?: string
  viewMode?: CalendarViewMode
  defaultViewMode?: CalendarViewMode
  onViewModeChange?: (mode: CalendarViewMode) => void
  onSelectedDateChange?: (value: string) => void
  onVisibleRangeChange?: (range: { from: number; to: number }) => void
  onRefresh?: () => void
  onOccurrenceSelect: (occurrence: CalendarOccurrence) => void
  onAgendaOpen?: (request: CalendarOpenRequest) => void
  onQuickCreate?: (dateValue: string, trigger?: HTMLElement | null) => void
  onRunOccurrence?: (occurrence: CalendarOccurrence) => void
  onOpenThread?: (threadId: string) => void
}

export type CalendarOpenRequest = {
  dateValue: string
  occurrence: CalendarOccurrence | null
  occurrences: readonly CalendarOccurrence[]
  trigger: HTMLElement | null
}

export function AutomationCalendar({
  occurrences,
  refreshing = false,
  refreshError = null,
  truncated = false,
  highlightProposalId,
  selectedDate,
  defaultSelectedDate,
  viewMode: controlledViewMode,
  defaultViewMode = 'month',
  onViewModeChange,
  onSelectedDateChange,
  onVisibleRangeChange,
  onRefresh,
  onOccurrenceSelect,
  onAgendaOpen,
  onQuickCreate,
  onRunOccurrence,
  onOpenThread,
}: Props): React.ReactNode {
  const today = useMemo(() => new Date(), [])
  const initialDate =
    parseDateValue(selectedDate ?? defaultSelectedDate) ?? today
  const [internalSelectedDate, setInternalSelectedDate] = useState(
    formatDateValue(initialDate),
  )
  const [internalViewMode, setInternalViewMode] =
    useState<CalendarViewMode>(defaultViewMode)
  const currentViewMode = controlledViewMode ?? internalViewMode

  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1, 12),
  )
  const [focusedDate, setFocusedDate] = useState(initialDate)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const daysRef = useRef<HTMLDivElement | null>(null)
  const [cellCapacity, setCellCapacity] = useState<number>(3)
  const activeDateValue = selectedDate ?? internalSelectedDate

  useEffect(() => {
    const el = daysRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const updateCapacity = () => {
      const totalHeight = el.clientHeight
      if (!totalHeight) return
      const rowHeight = totalHeight / 6
      const availableHeight = rowHeight - 32
      const capacity = Math.max(3, Math.floor(availableHeight / 24))
      setCellCapacity(capacity)
    }
    updateCapacity()
    const observer = new ResizeObserver(() => updateCapacity())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cells = useMemo(
    () => calendarDates(visibleMonth, today),
    [today, visibleMonth],
  )
  const weekCells = useMemo(
    () => calendarWeekDates(focusedDate, today),
    [focusedDate, today],
  )
  const occurrencesByDate = useMemo(
    () => calendarOccurrencesByDate(occurrences),
    [occurrences],
  )
  const listGroups = useMemo(
    () => groupOccurrencesForList(occurrences, today),
    [occurrences, today],
  )

  useEffect(() => {
    const date = parseDateValue(selectedDate)
    if (!date) return
    setFocusedDate(date)
    setVisibleMonth(current =>
      calendarDates(current, today).some(cell => cell.value === selectedDate)
        ? current
        : new Date(date.getFullYear(), date.getMonth(), 1, 12),
    )
  }, [selectedDate, today])

  useEffect(() => {
    const first = cells[0]?.date
    const last = cells.at(-1)?.date
    if (!first || !last) return
    onVisibleRangeChange?.({
      from: new Date(
        first.getFullYear(),
        first.getMonth(),
        first.getDate(),
      ).getTime(),
      to: new Date(
        last.getFullYear(),
        last.getMonth(),
        last.getDate() + 1,
      ).getTime(),
    })
  }, [cells, onVisibleRangeChange])

  function openAgenda(
    cell: CalendarDateCell,
    occurrence: CalendarOccurrence | null,
    dayOccurrences: readonly CalendarOccurrence[],
    trigger: HTMLElement,
  ): void {
    selectDate(cell.date)
    if (onAgendaOpen) {
      onAgendaOpen({
        dateValue: cell.value,
        occurrence,
        occurrences: dayOccurrences,
        trigger,
      })
    } else {
      const selected = occurrence ?? dayOccurrences[0]
      if (selected) onOccurrenceSelect(selected)
    }
  }

  function handleViewModeChange(mode: CalendarViewMode): void {
    setInternalViewMode(mode)
    onViewModeChange?.(mode)
  }

  function selectDate(date: Date): void {
    const value = formatDateValue(date)
    if (selectedDate === undefined) setInternalSelectedDate(value)
    setFocusedDate(date)
    if (!cells.some(cell => cell.value === value)) {
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    }
    onSelectedDateChange?.(value)
  }

  function focusDate(date: Date): void {
    setFocusedDate(date)
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(
          `[data-calendar-date="${formatDateValue(date)}"]`,
        )
        ?.focus()
    })
  }

  function navigateMonth(amount: number): void {
    const current = parseDateValue(activeDateValue) ?? visibleMonth
    const date = addCalendarMonths(current, amount)
    selectDate(date)
    focusDate(date)
  }

  function navigateWeek(amount: number): void {
    const current = parseDateValue(activeDateValue) ?? focusedDate
    const date = addDays(current, amount * 7)
    selectDate(date)
    focusDate(date)
  }

  function handleDayKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    cell: CalendarDateCell,
    dayOccurrences: readonly CalendarOccurrence[],
  ): void {
    if (event.target !== event.currentTarget) return
    const date = cell.date
    const mondayOffset = (date.getDay() + 6) % 7
    let nextDate: Date | null = null

    switch (event.key) {
      case 'ArrowLeft':
        nextDate = addDays(date, -1)
        break
      case 'ArrowRight':
        nextDate = addDays(date, 1)
        break
      case 'ArrowUp':
        nextDate = addDays(date, -7)
        break
      case 'ArrowDown':
        nextDate = addDays(date, 7)
        break
      case 'Home':
        nextDate = addDays(date, -mondayOffset)
        break
      case 'End':
        nextDate = addDays(date, 6 - mondayOffset)
        break
      case 'PageUp':
        nextDate = addCalendarMonths(date, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        nextDate = addCalendarMonths(date, event.shiftKey ? 12 : 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectDate(date)
        if (dayOccurrences.length) {
          openAgenda(cell, null, dayOccurrences, event.currentTarget)
        }
        return
      default:
        return
    }

    event.preventDefault()
    if (nextDate) focusDate(nextDate)
  }

  function selectToday(): void {
    selectDate(today)
    focusDate(today)
  }

  return (
    <section className="automation-calendar" aria-label="任务日历">
      <header className="automation-calendar__toolbar">
        <div className="automation-calendar__month-navigation">
          <IconButton
            color="ghostSecondary"
            size="toolbar"
            title={currentViewMode === 'week' ? '上一周' : '上个月'}
            onClick={() =>
              currentViewMode === 'week' ? navigateWeek(-1) : navigateMonth(-1)
            }
          >
            <ChevronLeft aria-hidden="true" size={APP_ICON_SIZE} />
          </IconButton>
          <span className="automation-calendar__period">
            <h2 aria-live="polite">
              {currentViewMode === 'week'
                ? weekRangeLabel(weekCells)
                : monthLabel(visibleMonth)}
            </h2>
            {refreshing ? (
              <span className="automation-calendar__sync-status" role="status">
                <Spinner />
                <span>同步中</span>
              </span>
            ) : refreshError ? (
              <button
                className="automation-calendar__sync-retry"
                type="button"
                onClick={onRefresh}
              >
                同步失败 · 重试
              </button>
            ) : truncated ? (
              <span className="automation-calendar__sync-status" role="status">
                仅显示前 2,000 项
              </span>
            ) : null}
          </span>
          <IconButton
            color="ghostSecondary"
            size="toolbar"
            title={currentViewMode === 'week' ? '下一周' : '下个月'}
            onClick={() =>
              currentViewMode === 'week' ? navigateWeek(1) : navigateMonth(1)
            }
          >
            <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
          </IconButton>
        </div>

        <div className="automation-calendar__toolbar-actions">
          <SegmentedControl<CalendarViewMode>
            ariaLabel="日历视图"
            value={currentViewMode}
            options={[
              { value: 'month', label: '月' },
              { value: 'week', label: '周' },
              { value: 'list', label: '列表' },
            ]}
            onChange={handleViewModeChange}
          />
          <Button color="ghostSecondary" size="compact" onClick={selectToday}>
            今天
          </Button>
        </div>
      </header>

      <div
        className="automation-calendar__layout"
        data-view-mode={currentViewMode}
      >
        <div className="automation-calendar__main-container">
          {currentViewMode === 'month' ? (
            <div className="automation-calendar__grid-scroll">
              <div
                ref={gridRef}
                aria-label={monthLabel(visibleMonth)}
                className="automation-calendar__grid"
                role="grid"
              >
                <div className="automation-calendar__weekdays" role="row">
                  {WEEKDAYS.map(weekday => (
                    <span key={weekday} role="columnheader">
                      {weekday}
                    </span>
                  ))}
                </div>
                <div ref={daysRef} className="automation-calendar__days" role="rowgroup">
                  {Array.from({ length: 6 }, (_, weekIndex) => (
                    <div
                      key={weekIndex}
                      className="automation-calendar__week"
                      role="row"
                    >
                      {cells
                        .slice(weekIndex * 7, weekIndex * 7 + 7)
                        .map(cell => {
                          const dayOccurrences =
                            occurrencesByDate.get(cell.value) ?? []
                          const selected = cell.value === activeDateValue
                          const focused =
                            cell.value === formatDateValue(focusedDate)
                          const maxVisible = 5
                          const hasMore = dayOccurrences.length > maxVisible
                          const visibleOccurrences = hasMore
                            ? dayOccurrences.slice(0, maxVisible)
                            : dayOccurrences
                          const moreCount = dayOccurrences.length - maxVisible
                          return (
                            <div
                              key={cell.value}
                              aria-current={cell.today ? 'date' : undefined}
                              aria-label={dayLabel(
                                cell.date,
                                dayOccurrences.length,
                              )}
                              aria-selected={selected}
                              className="automation-calendar__day"
                              data-calendar-date={cell.value}
                              data-outside={!cell.currentMonth || undefined}
                              data-today={cell.today || undefined}
                              role="gridcell"
                              tabIndex={focused ? 0 : -1}
                              onClick={event => {
                                selectDate(cell.date)
                                if (dayOccurrences.length) {
                                  openAgenda(
                                    cell,
                                    null,
                                    dayOccurrences,
                                    event.currentTarget,
                                  )
                                }
                              }}
                              onFocus={() => setFocusedDate(cell.date)}
                              onKeyDown={event =>
                                handleDayKeyDown(event, cell, dayOccurrences)
                              }
                            >
                              <div className="automation-calendar__day-heading">
                                <span className="automation-calendar__day-num">
                                  {cell.day}
                                </span>
                                {cell.today ? <small>今天</small> : null}
                                <button
                                  type="button"
                                  className="automation-calendar__day-add"
                                  title={`在 ${cell.value} 新建任务`}
                                  aria-label={`在 ${cell.value} 新建任务`}
                                  onClick={event => {
                                    event.stopPropagation()
                                    onQuickCreate
                                      ? onQuickCreate(
                                          cell.value,
                                          event.currentTarget,
                                        )
                                      : selectDate(cell.date)
                                  }}
                                >
                                  <Plus aria-hidden="true" size={12} />
                                </button>
                              </div>
                              {dayOccurrences.length ? (
                                <div className="automation-calendar__day-items">
                                  {visibleOccurrences
                                    .map(occurrence => (
                                      <button
                                        key={occurrence.id}
                                        type="button"
                                        className="automation-calendar__day-item"
                                        data-calendar-occurrence-id={
                                          occurrence.id
                                        }
                                        data-highlighted={
                                          occurrence.proposalId ===
                                            highlightProposalId || undefined
                                        }
                                        data-status={occurrence.status}
                                        title={`${occurrence.title} (${timeLabel(occurrence.scheduledFor)} · ${statusLabel(occurrence.status)})`}
                                        onClick={event => {
                                          event.stopPropagation()
                                          openAgenda(
                                            cell,
                                            occurrence,
                                            dayOccurrences,
                                            event.currentTarget,
                                          )
                                        }}
                                      >
                                        <span
                                          className="automation-calendar__status-bar"
                                          data-status={occurrence.status}
                                          aria-hidden="true"
                                        />
                                        <span
                                          className="automation-calendar__item-icon"
                                          aria-hidden="true"
                                        >
                                          {occurrence.source.kind ===
                                          'automation' ? (
                                            <RefreshCw size={10} />
                                          ) : (
                                            <CalendarCheck2 size={10} />
                                          )}
                                        </span>
                                        <time>
                                          {timeLabel(occurrence.scheduledFor)}
                                        </time>
                                        <span className="automation-calendar__item-title">
                                          {occurrence.title}
                                        </span>
                                      </button>
                                    ))}
                                  {hasMore ? (
                                    <Button
                                      color="ghostTertiary"
                                      size="compact"
                                      className="automation-calendar__day-more"
                                      onClick={event => {
                                        event.stopPropagation()
                                        openAgenda(
                                          cell,
                                          null,
                                          dayOccurrences,
                                          event.currentTarget,
                                        )
                                      }}
                                    >
                                      +{moreCount} 项
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : currentViewMode === 'week' ? (
            <div
              className="automation-calendar__week-view"
              role="region"
              aria-label="周视图"
            >
              <div ref={gridRef} className="automation-calendar__week-grid">
                {weekCells.map(cell => {
                  const dayOccurrences = occurrencesByDate.get(cell.value) ?? []
                  const selected = cell.value === activeDateValue
                  return (
                    <div
                      key={cell.value}
                      className="automation-calendar__week-col"
                      data-calendar-date={cell.value}
                      data-today={cell.today || undefined}
                      data-selected={selected || undefined}
                      tabIndex={
                        cell.value === formatDateValue(focusedDate) ? 0 : -1
                      }
                      onClick={() => selectDate(cell.date)}
                      onFocus={() => setFocusedDate(cell.date)}
                      onKeyDown={event => handleDayKeyDown(event, cell, dayOccurrences)}
                    >
                      <header className="automation-calendar__week-col-header">
                        <div className="automation-calendar__week-col-info">
                          <span className="automation-calendar__week-col-weekday">
                            {WEEKDAYS[(cell.date.getDay() + 6) % 7]}
                          </span>
                          <span className="automation-calendar__week-col-daynum">
                            {cell.day}
                          </span>
                        </div>
                        {cell.today ? (
                          <small className="automation-calendar__week-today-pill">
                            今天
                          </small>
                        ) : null}
                        <button
                          type="button"
                          className="automation-calendar__week-col-add"
                          title={`在 ${cell.value} 新建任务`}
                          aria-label={`在 ${cell.value} 新建任务`}
                          onClick={event => {
                            event.stopPropagation()
                            onQuickCreate
                              ? onQuickCreate(cell.value, event.currentTarget)
                              : selectDate(cell.date)
                          }}
                        >
                          <Plus aria-hidden="true" size={12} />
                        </button>
                      </header>

                      <div className="automation-calendar__week-col-body">
                        {dayOccurrences.length ? (
                          dayOccurrences.map(occurrence => (
                            <button
                              key={occurrence.id}
                              type="button"
                              className="automation-calendar__week-card"
                              data-calendar-occurrence-id={occurrence.id}
                              data-highlighted={
                                occurrence.proposalId === highlightProposalId ||
                                undefined
                              }
                              data-status={occurrence.status}
                              onClick={event => {
                                event.stopPropagation()
                                openAgenda(
                                  cell,
                                  occurrence,
                                  dayOccurrences,
                                  event.currentTarget,
                                )
                              }}
                            >
                              <span
                                className="automation-calendar__status-bar"
                                data-status={occurrence.status}
                                aria-hidden="true"
                              />
                              <div className="automation-calendar__week-card-inner">
                                <div className="automation-calendar__week-card-header">
                                  <span className="automation-calendar__week-card-type">
                                    {occurrence.source.kind === 'automation' ? (
                                      <RefreshCw aria-hidden="true" size={11} />
                                    ) : (
                                      <CalendarCheck2
                                        aria-hidden="true"
                                        size={11}
                                      />
                                    )}
                                    <span>
                                      {occurrence.source.kind === 'automation'
                                        ? '自动化'
                                        : '计划'}
                                    </span>
                                  </span>
                                  <time>
                                    {timeLabel(occurrence.scheduledFor)}
                                  </time>
                                </div>
                                <div className="automation-calendar__week-card-title">
                                  {occurrence.title}
                                </div>
                                <div className="automation-calendar__week-card-footer">
                                  <span
                                    className="automation-calendar__status-dot"
                                    data-status={occurrence.status}
                                    aria-hidden="true"
                                  />
                                  <span className="automation-calendar__status-text">
                                    {statusLabel(occurrence.status)}
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="automation-calendar__week-col-empty">
                            <span>无任务</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div
              className="automation-calendar__list-view"
              role="region"
              aria-label="日程列表视图"
            >
              {listGroups.length ? (
                <div className="automation-calendar__list-groups">
                  {listGroups.map(group => (
                    <section
                      key={group.dateValue}
                      className="automation-calendar__list-group"
                    >
                      <header className="automation-calendar__list-group-header">
                        <div className="automation-calendar__list-group-title">
                          <span
                            className="automation-calendar__list-group-label"
                            data-today={group.isToday || undefined}
                            data-tomorrow={group.isTomorrow || undefined}
                          >
                            {group.label}
                          </span>
                          <span className="automation-calendar__list-group-count">
                            {group.occurrences.length} 项任务
                          </span>
                        </div>
                        <button
                          type="button"
                          className="automation-calendar__list-group-add"
                          onClick={event =>
                            onQuickCreate
                              ? onQuickCreate(
                                  group.dateValue,
                                  event.currentTarget,
                                )
                              : selectDate(group.date)
                          }
                        >
                          <Plus aria-hidden="true" size={12} />
                          <span>新建</span>
                        </button>
                      </header>
                      <div className="automation-calendar__list-cards">
                        {group.occurrences.map(occurrence => (
                          <div
                            key={occurrence.id}
                            className="automation-calendar__list-card"
                            data-highlighted={
                              occurrence.proposalId === highlightProposalId ||
                              undefined
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
                              className="automation-calendar__list-card-content"
                              onClick={() => onOccurrenceSelect(occurrence)}
                            >
                              <div className="automation-calendar__list-card-title-row">
                                <span
                                  className="automation-calendar__list-card-type-icon"
                                  aria-hidden="true"
                                >
                                  {occurrence.source.kind === 'automation' ? (
                                    <RefreshCw size={14} />
                                  ) : (
                                    <CalendarCheck2 size={14} />
                                  )}
                                </span>
                                <strong className="automation-calendar__list-card-title">
                                  {occurrence.title}
                                </strong>
                                <span
                                  className="automation-calendar__status-badge"
                                  data-status={occurrence.status}
                                >
                                  <span
                                    className="automation-calendar__status-dot"
                                    data-status={occurrence.status}
                                    aria-hidden="true"
                                  />
                                  {statusLabel(occurrence.status)}
                                </span>
                              </div>
                              <div className="automation-calendar__list-card-meta">
                                <time>
                                  {timeLabel(occurrence.scheduledFor)}
                                </time>
                                <span>·</span>
                                <span>{sourceLabel(occurrence)}</span>
                              </div>
                            </button>
                            {onRunOccurrence ||
                            (occurrence.threadId && onOpenThread) ? (
                              <div
                                className="automation-calendar__list-card-actions"
                                onClick={event => event.stopPropagation()}
                              >
                                {onRunOccurrence ? (
                                  <IconButton
                                    color="ghostSecondary"
                                    size="toolbar"
                                    title="立即运行"
                                    onClick={() => onRunOccurrence(occurrence)}
                                  >
                                    <Play
                                      aria-hidden="true"
                                      size={APP_ICON_SIZE}
                                    />
                                  </IconButton>
                                ) : null}
                                {occurrence.threadId && onOpenThread ? (
                                  <IconButton
                                    color="ghostSecondary"
                                    size="toolbar"
                                    title="查看会话"
                                    onClick={() =>
                                      onOpenThread(occurrence.threadId!)
                                    }
                                  >
                                    <MessageSquare
                                      aria-hidden="true"
                                      size={APP_ICON_SIZE}
                                    />
                                  </IconButton>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="automation-calendar__list-empty" role="status">
                  <CalendarCheck2 aria-hidden="true" size={36} />
                  <p>当前没有已安排的任务或执行记录。</p>
                  <Button
                    color="secondary"
                    size="compact"
                    onClick={event =>
                      onQuickCreate
                        ? onQuickCreate(activeDateValue, event.currentTarget)
                        : undefined
                    }
                  >
                    <Plus aria-hidden="true" size={APP_ICON_SIZE} />
                    <span>创建计划任务</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
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

function weekRangeLabel(cells: readonly CalendarDateCell[]): string {
  if (!cells.length) return ''
  const first = cells[0].date
  const last = cells[cells.length - 1].date
  const formatDay = (d: Date, withYear = false) =>
    new Intl.DateTimeFormat('zh-CN', {
      ...(withYear ? { year: 'numeric' } : {}),
      month: 'numeric',
      day: 'numeric',
    }).format(d)
  const sameYear = first.getFullYear() === last.getFullYear()
  if (sameYear) {
    return `${first.getFullYear()}年${formatDay(first)} - ${formatDay(last)}`
  }
  return `${formatDay(first, true)} - ${formatDay(last, true)}`
}

function dayLabel(date: Date, count: number): string {
  const label = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
  return count ? `${label}，${count} 项任务` : `${label}，没有任务`
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
