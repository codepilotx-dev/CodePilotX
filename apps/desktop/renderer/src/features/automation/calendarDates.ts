import type { CalendarOccurrence } from '@codepilotx/shared/calendar'
import { formatDateValue } from '../../components/ui/DatePicker.js'

export type CalendarFilter = 'all' | 'scheduled-task' | 'automation' | 'execution'

export type CalendarDateCell = {
  date: Date
  value: string
  day: number
  currentMonth: boolean
  today: boolean
}

export function calendarDates(
  month: Date,
  today: Date = new Date(),
): readonly CalendarDateCell[] {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const start = new Date(
    firstDay.getFullYear(),
    firstDay.getMonth(),
    firstDay.getDate() - mondayOffset,
    12,
  )
  const todayValue = formatDateValue(today)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
      12,
    )
    const value = formatDateValue(date)
    return {
      date,
      value,
      day: date.getDate(),
      currentMonth:
        date.getFullYear() === firstDay.getFullYear() &&
        date.getMonth() === firstDay.getMonth(),
      today: value === todayValue,
    }
  })
}

export function calendarOccurrencesByDate(
  occurrences: readonly CalendarOccurrence[],
): ReadonlyMap<string, readonly CalendarOccurrence[]> {
  const grouped = new Map<string, CalendarOccurrence[]>()

  for (const occurrence of occurrences) {
    const value = formatDateValue(new Date(occurrence.scheduledFor))
    const items = grouped.get(value)
    if (items) items.push(occurrence)
    else grouped.set(value, [occurrence])
  }

  for (const items of grouped.values()) {
    items.sort(
      (left, right) =>
        left.scheduledFor - right.scheduledFor ||
        left.title.localeCompare(right.title, 'zh-CN') ||
        left.id.localeCompare(right.id),
    )
  }

  return grouped
}

export function filterCalendarOccurrences(
  occurrences: readonly CalendarOccurrence[],
  query: string,
  filter: CalendarFilter,
): readonly CalendarOccurrence[] {
  const needle = query.trim().toLocaleLowerCase()
  return occurrences.filter(occurrence => {
    if (needle && !occurrence.title.toLocaleLowerCase().includes(needle)) return false
    if (filter === 'execution') return occurrence.runId !== null
    if (filter === 'scheduled-task') {
      return occurrence.source.kind === 'scheduled-task' && occurrence.runId === null
    }
    if (filter === 'automation') {
      return occurrence.source.kind === 'automation' && occurrence.runId === null
    }
    return true
  })
}

export function calendarWeekDates(
  targetDate: Date,
  today: Date = new Date(),
): readonly CalendarDateCell[] {
  const mondayOffset = (targetDate.getDay() + 6) % 7
  const start = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate() - mondayOffset,
    12,
  )
  const todayValue = formatDateValue(today)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
      12,
    )
    const value = formatDateValue(date)
    return {
      date,
      value,
      day: date.getDate(),
      currentMonth: date.getMonth() === targetDate.getMonth(),
      today: value === todayValue,
    }
  })
}

export type CalendarListGroup = {
  dateValue: string
  date: Date
  isToday: boolean
  isTomorrow: boolean
  label: string
  occurrences: readonly CalendarOccurrence[]
}

export function groupOccurrencesForList(
  occurrences: readonly CalendarOccurrence[],
  today: Date = new Date(),
): readonly CalendarListGroup[] {
  const grouped = calendarOccurrencesByDate(occurrences)
  const todayValue = formatDateValue(today)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12)
  const tomorrowValue = formatDateValue(tomorrow)

  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))
  return sortedKeys.map(key => {
    const items = grouped.get(key) ?? []
    const date = new Date(key + 'T12:00:00')
    const isToday = key === todayValue
    const isTomorrow = key === tomorrowValue

    const dateStr = new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(date)

    const label = isToday ? `今天 · ${dateStr}` : isTomorrow ? `明天 · ${dateStr}` : dateStr

    return {
      dateValue: key,
      date,
      isToday,
      isTomorrow,
      label,
      occurrences: items,
    }
  })
}

export function calendarStatusLabel(status: CalendarOccurrence['status'] | 'cancelled'): string {
  return {
    scheduled: '已安排',
    paused: '已暂停',
    claimed: '已领取',
    preparing: '准备中',
    queued: '排队中',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
    cancelled: '已取消',
  }[status]
}
