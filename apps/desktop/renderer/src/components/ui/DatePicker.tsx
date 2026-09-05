import React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../../utils/cx.js'

export type DatePickerProps = {
  value: string
  ariaLabel: string
  min?: string
  max?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  onValueChange: (value: string) => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateValue(value: string | undefined): Date | null {
  if (!value) return null
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 12)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null
}

export function formatDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12)
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12)
}

export function addCalendarMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate()
  target.setDate(Math.min(date.getDate(), lastDay))
  return target
}

function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

function displayDate(value: string): string {
  const date = parseDateValue(value)
  return date
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    : value
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(date)
}

function dayLabel(date: Date, today: string, selected: string): string {
  const value = formatDateValue(date)
  const states = [value === today ? '今天' : '', value === selected ? '已选择' : ''].filter(Boolean)
  const label = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
  return states.length ? `${label}，${states.join('，')}` : label
}

export function DatePicker({
  value,
  ariaLabel,
  min,
  max,
  disabled = false,
  placeholder = '选择日期',
  className,
  onValueChange,
}: DatePickerProps): React.ReactNode {
  const today = React.useMemo(() => new Date(), [])
  const todayValue = formatDateValue(today)
  const selectedDate = parseDateValue(value)
  const [open, setOpen] = React.useState(false)
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(selectedDate ?? today))
  const [focusedDate, setFocusedDate] = React.useState(() => selectedDate ?? today)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const calendarRef = React.useRef<HTMLDivElement | null>(null)
  const minDate = parseDateValue(min)
  const maxDate = parseDateValue(max)

  function clampToRange(date: Date): Date {
    const dateValue = formatDateValue(date)
    if (minDate && dateValue < formatDateValue(minDate)) return minDate
    if (maxDate && dateValue > formatDateValue(maxDate)) return maxDate
    return date
  }

  React.useEffect(() => {
    if (!selectedDate || open) return
    setVisibleMonth(startOfMonth(selectedDate))
    setFocusedDate(selectedDate)
  }, [open, value])

  const calendarStart = addDays(visibleMonth, -mondayIndex(visibleMonth))
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index))

  function isUnavailable(date: Date): boolean {
    const dateValue = formatDateValue(date)
    return Boolean(
      (minDate && dateValue < formatDateValue(minDate)) ||
      (maxDate && dateValue > formatDateValue(maxDate)),
    )
  }

  function focusDay(date: Date): void {
    const focusableDate = clampToRange(date)
    setFocusedDate(focusableDate)
    setVisibleMonth(startOfMonth(focusableDate))
    requestAnimationFrame(() => {
      calendarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${formatDateValue(focusableDate)}"]`)
        ?.focus()
    })
  }

  function chooseDate(date: Date): void {
    if (isUnavailable(date)) return
    onValueChange(formatDateValue(date))
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function handleDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: Date): void {
    let nextDate: Date | null = null
    switch (event.key) {
      case 'ArrowLeft': nextDate = addDays(date, -1); break
      case 'ArrowRight': nextDate = addDays(date, 1); break
      case 'ArrowUp': nextDate = addDays(date, -7); break
      case 'ArrowDown': nextDate = addDays(date, 7); break
      case 'Home': nextDate = addDays(date, -mondayIndex(date)); break
      case 'End': nextDate = addDays(date, 6 - mondayIndex(date)); break
      case 'PageUp': nextDate = addCalendarMonths(date, event.shiftKey ? -12 : -1); break
      case 'PageDown': nextDate = addCalendarMonths(date, event.shiftKey ? 12 : 1); break
      case 'Enter':
      case ' ':
        event.preventDefault()
        chooseDate(date)
        return
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
        return
      default:
        return
    }
    event.preventDefault()
    if (nextDate) focusDay(nextDate)
  }

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      const initialDate = clampToRange(selectedDate ?? today)
      setVisibleMonth(startOfMonth(initialDate))
      setFocusedDate(initialDate)
      requestAnimationFrame(() => focusDay(initialDate))
    }
  }

  function navigateMonth(amount: number): void {
    focusDay(addCalendarMonths(focusedDate, amount))
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          aria-label={ariaLabel}
          className={cx('ui-date-picker-trigger', className)}
          disabled={disabled}
          type="button"
        >
          <CalendarDays aria-hidden="true" className="ui-date-picker-trigger-icon" />
          <span className={cx('ui-date-picker-value', !value && 'ui-date-picker-value--placeholder')}>
            {value ? displayDate(value) : placeholder}
          </span>
          <ChevronDown aria-hidden="true" className="ui-date-picker-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          aria-label={`${ariaLabel}日历`}
          className="popover-surface ui-date-picker-content"
          collisionPadding={8}
          sideOffset={4}
          onEscapeKeyDown={() => requestAnimationFrame(() => triggerRef.current?.focus())}
        >
          <div className="ui-date-picker-header">
            <button aria-label="上个月" className="ui-date-picker-nav" type="button" onClick={() => navigateMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <div aria-live="polite" className="ui-date-picker-month">{monthLabel(visibleMonth)}</div>
            <button aria-label="下个月" className="ui-date-picker-nav" type="button" onClick={() => navigateMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div ref={calendarRef} aria-label={monthLabel(visibleMonth)} className="ui-date-picker-grid" role="grid">
            <div className="ui-date-picker-weekdays" role="row">
              {WEEKDAYS.map((weekday) => (
                <span aria-label={`星期${weekday}`} className="ui-date-picker-weekday" key={weekday} role="columnheader">{weekday}</span>
              ))}
            </div>
            <div className="ui-date-picker-days" role="rowgroup">
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div className="ui-date-picker-week" key={weekIndex} role="row">
                  {calendarDates.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                    const dateValue = formatDateValue(date)
                    const unavailable = isUnavailable(date)
                    const selected = dateValue === value
                    const currentMonth = date.getMonth() === visibleMonth.getMonth()
                    const focused = dateValue === formatDateValue(focusedDate)
                    return (
                      <button
                        aria-current={dateValue === todayValue ? 'date' : undefined}
                        aria-label={dayLabel(date, todayValue, value)}
                        aria-selected={selected}
                        className="ui-date-picker-day"
                        data-date={dateValue}
                        data-outside={!currentMonth || undefined}
                        disabled={unavailable}
                        key={dateValue}
                        role="gridcell"
                        tabIndex={focused ? 0 : -1}
                        type="button"
                        onClick={() => chooseDate(date)}
                        onFocus={() => setFocusedDate(date)}
                        onKeyDown={(event) => handleDayKeyDown(event, date)}
                      >
                        <span>{date.getDate()}</span>
                        {dateValue === todayValue ? <span className="ui-date-picker-state">今</span> : null}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="ui-date-picker-footer">
            <button
              className="ui-date-picker-footer-action"
              disabled={isUnavailable(today)}
              type="button"
              onClick={() => chooseDate(today)}
            >
              今天
            </button>
            <button
              className="ui-date-picker-footer-action"
              disabled={!value}
              type="button"
              onClick={() => {
                onValueChange('')
                setOpen(false)
                requestAnimationFrame(() => triggerRef.current?.focus())
              }}
            >
              清除日期
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
