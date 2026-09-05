import { describe, expect, test } from 'bun:test'
import type { CalendarOccurrence } from '@codepilotx/shared/calendar'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AutomationCalendar } from '../src/features/automation/AutomationCalendar.js'
import {
  calendarDates,
  calendarOccurrencesByDate,
  calendarWeekDates,
  filterCalendarOccurrences,
  groupOccurrencesForList,
} from '../src/features/automation/calendarDates.js'

describe('automation calendar projection', () => {
  test('renders up to 5 occurrences in month view, and folds beyond 5 into +N items button', () => {
    // 5 occurrences: all 5 displayed, no +N button
    const html5 = renderToStaticMarkup(createElement(AutomationCalendar, {
      defaultSelectedDate: '2026-09-05',
      occurrences: Array.from({ length: 5 }, (_, index) =>
        occurrence(`task-${index}`, new Date(2026, 8, 5, 9 + index).getTime()),
      ),
      onOccurrenceSelect: () => {},
    }))

    expect(html5.match(/role="gridcell"/g)).toHaveLength(42)
    expect(html5.match(/class="automation-calendar__day-item"/g)).toHaveLength(5)
    expect(html5).not.toContain('automation-calendar__day-more')

    // 7 occurrences: 5 items displayed + "+2 项" button
    const html7 = renderToStaticMarkup(createElement(AutomationCalendar, {
      defaultSelectedDate: '2026-09-05',
      occurrences: Array.from({ length: 7 }, (_, index) =>
        occurrence(`task-${index}`, new Date(2026, 8, 5, 9 + index).getTime()),
      ),
      onOccurrenceSelect: () => {},
    }))

    expect(html7.match(/class="automation-calendar__day-item"/g)).toHaveLength(5)
    expect(html7).toMatch(/<button[^>]*class="[^"]*automation-calendar__day-more[^"]*"[^>]*>\+2 项<\/button>/)
    expect(html7).not.toContain('<aside')
    expect(html7).not.toContain('收起当日议程')
    expect(html7).not.toContain('automation-calendar__focus-popover')
  })

  test('builds a Monday-first 6 × 7 month and groups occurrences in time order', () => {
    const dates = calendarDates(new Date(2026, 8, 18), new Date(2026, 8, 5))

    expect(dates).toHaveLength(42)
    expect(dates[0]).toMatchObject({
      value: '2026-08-31',
      currentMonth: false,
    })
    expect(dates[5]).toMatchObject({ value: '2026-09-05', today: true })
    expect(dates[41]).toMatchObject({
      value: '2026-10-11',
      currentMonth: false,
    })

    const occurrences = [
      occurrence('later', new Date(2026, 8, 5, 16).getTime()),
      occurrence('earlier', new Date(2026, 8, 5, 9).getTime()),
    ]
    expect(
      calendarOccurrencesByDate(occurrences)
        .get('2026-09-05')
        ?.map(item => item.id),
    ).toEqual(['earlier', 'later'])
  })

  test('builds Monday-first 7-day week dates for week view', () => {
    // 2026-09-05 is Saturday
    const week = calendarWeekDates(new Date(2026, 8, 5), new Date(2026, 8, 5))
    expect(week).toHaveLength(7)
    expect(week[0]).toMatchObject({ value: '2026-08-31', day: 31 })
    expect(week[5]).toMatchObject({ value: '2026-09-05', day: 5, today: true })
    expect(week[6]).toMatchObject({ value: '2026-09-06', day: 6 })
  })

  test('groups occurrences chronologically for list view', () => {
    const occurrences = [
      occurrence('task-2', new Date(2026, 8, 6, 10).getTime()),
      occurrence('task-1', new Date(2026, 8, 5, 9).getTime()),
    ]
    const groups = groupOccurrencesForList(occurrences, new Date(2026, 8, 5))
    expect(groups).toHaveLength(2)
    expect(groups[0].dateValue).toBe('2026-09-05')
    expect(groups[0].isToday).toBe(true)
    expect(groups[0].occurrences[0].id).toBe('task-1')
    expect(groups[1].dateValue).toBe('2026-09-06')
    expect(groups[1].isTomorrow).toBe(true)
    expect(groups[1].occurrences[0].id).toBe('task-2')
  })

  test('filters the loaded range locally by source, execution, and title', () => {
    const planned = occurrence('Review API', new Date(2026, 8, 5, 9).getTime())
    const automation = {
      ...occurrence('Daily cleanup', new Date(2026, 8, 5, 10).getTime()),
      source: { kind: 'automation' as const, id: 'automation:cleanup' },
      definitionKind: 'recurring' as const,
    }
    const execution = {
      ...planned,
      id: 'run:review',
      runId: 'run:review',
      status: 'completed' as const,
    }
    const occurrences = [planned, automation, execution]

    expect(filterCalendarOccurrences(occurrences, '', 'scheduled-task')).toEqual([planned])
    expect(filterCalendarOccurrences(occurrences, '', 'automation')).toEqual([automation])
    expect(filterCalendarOccurrences(occurrences, '', 'execution')).toEqual([execution])
    expect(filterCalendarOccurrences(occurrences, 'review', 'all')).toEqual([planned, execution])
  })
})

function occurrence(id: string, scheduledFor: number): CalendarOccurrence {
  return {
    id,
    source: { kind: 'scheduled-task', id: `task:${id}` },
    definitionKind: 'one-off',
    title: id,
    scheduledFor,
    status: 'scheduled',
    runId: null,
    threadId: null,
    proposalId: null,
  }
}
