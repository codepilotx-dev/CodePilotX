import { useEffect, useMemo, useRef, useState } from 'react'
import { Gantt, type GanttStatic, type Task as GanttTask } from 'dhtmlx-gantt'
import type { TaskboardWorkflowStatus, TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import type { TaskboardGanttZoom } from '../state/taskboardViewPreferences.js'
import '../../../styles/lazy/taskboard-gantt-vendor.scss'
import {
  formatTaskboardLocalDate,
  parseTaskboardLocalDate,
  projectTaskboardGanttTask,
  TASKBOARD_GANTT_GROUPS,
  taskboardInclusiveDatesFromGanttRange,
} from '../taskboardGanttModel.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  pendingTaskIds: ReadonlySet<string>
  projectNames: ReadonlyMap<string, string>
  zoom: TaskboardGanttZoom
  hideCompleted: boolean
  todayRequest: number
  hasActiveFilters: boolean
  onOpen: (taskId: string) => void
  onUpdateDates: (taskId: string, startDate: string, dueDate: string) => Promise<void>
}

type TaskboardGanttItem = GanttTask & {
  taskboardGroup: boolean
  taskboardStatus: TaskboardWorkflowStatus
  taskboardTitle: string
  taskboardNumber: number
  taskboardUnread: boolean
  taskboardCount: number
}

let pendingViewport: { signature: string; x: number; y: number } | null = null

export default function TaskboardGantt({
  tasks,
  pendingTaskIds,
  projectNames,
  zoom,
  hideCompleted,
  todayRequest,
  hasActiveFilters,
  onOpen,
  onUpdateDates,
}: Props): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<GanttStatic | null>(null)
  const tasksRef = useRef(tasks)
  const pendingRef = useRef(pendingTaskIds)
  const projectNamesRef = useRef(projectNames)
  const onOpenRef = useRef(onOpen)
  const onUpdateDatesRef = useRef(onUpdateDates)
  const viewportSignatureRef = useRef('empty')
  const restoringRef = useRef(new Set<string>())
  const parsedRef = useRef(false)
  const gridCollapsedRef = useRef(false)
  const expandedGridWidthRef = useRef(360)
  const [gridCollapsed, setGridCollapsed] = useState(false)
  const [gridWidth, setGridWidth] = useState(360)
  const [todayMarkerLeft, setTodayMarkerLeft] = useState<number | null>(null)

  tasksRef.current = tasks
  pendingRef.current = pendingTaskIds
  projectNamesRef.current = projectNames
  onOpenRef.current = onOpen
  onUpdateDatesRef.current = onUpdateDates

  const visibleTasks = useMemo(() => (
    hideCompleted
      ? tasks.filter(task => task.status !== 'done' && task.status !== 'canceled')
      : tasks
  ), [hideCompleted, tasks])
  const viewportSignature = useMemo(() => (
    [...new Set(visibleTasks.map(task => task.projectId))].sort().join(':') || 'empty'
  ), [visibleTasks])
  viewportSignatureRef.current = viewportSignature

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const instance = Gantt.getGanttInstance()
    ganttRef.current = instance
    instance.config.date_format = '%Y-%m-%d'
    instance.config.xml_date = '%Y-%m-%d'
    instance.config.row_height = 52
    instance.config.bar_height = 34
    instance.config.scale_height = 62
    instance.config.scroll_size = 8
    instance.config.grid_width = 360
    instance.config.min_column_width = 38
    instance.config.drag_progress = false
    instance.config.drag_links = false
    instance.config.show_progress = false
    instance.config.show_unscheduled = true
    instance.config.smart_rendering = true
    instance.config.details_on_dblclick = false
    instance.config.round_dnd_dates = true
    instance.config.select_task = false
    instance.config.columns = [{
      name: 'text',
      label: '任务',
      tree: true,
      width: '*',
      min_width: 210,
      template: item => {
        const task = item as TaskboardGanttItem
        if (task.taskboardGroup) {
          return `<span class="taskboard-gantt__group"><strong>${escapeHtml(task.taskboardTitle)}</strong><small>${task.taskboardCount}</small></span>`
        }
        return `<span class="taskboard-gantt__issue"><small>#${task.taskboardNumber}</small><strong>${escapeHtml(task.taskboardTitle)}</strong>${task.taskboardUnread ? '<i aria-label="有未读更新"></i>' : ''}</span>`
      },
    }]
    instance.templates.grid_folder = () => ''
    instance.templates.grid_file = () => ''
    instance.templates.grid_blank = () => ''
    instance.templates.task_class = (_start, _end, item) => {
      const task = item as TaskboardGanttItem
      return task.taskboardGroup
        ? `taskboard-gantt__group-bar taskboard-gantt__status-${task.taskboardStatus}`
        : `taskboard-gantt__bar taskboard-gantt__status-${task.taskboardStatus}`
    }
    const rowClass = (item: GanttTask): string => {
      const task = item as TaskboardGanttItem
      return task.taskboardGroup
        ? `taskboard-gantt__group-row taskboard-gantt__status-${task.taskboardStatus}`
        : `taskboard-gantt__task-row taskboard-gantt__status-${task.taskboardStatus}${task.taskboardUnread ? ' is-unread' : ''}`
    }
    instance.templates.grid_row_class = (_start, _end, item) => rowClass(item)
    instance.templates.task_row_class = (_start, _end, item) => rowClass(item)
    instance.templates.scale_cell_class = ganttDateCellClass
    instance.templates.timeline_cell_class = (_item, date) => ganttDateCellClass(date)
    instance.templates.task_text = (start, end, item) => {
      const task = item as TaskboardGanttItem
      if (task.taskboardGroup) return ''
      const dueDate = addTaskboardGanttDays(end, -1)
      return `<span class="taskboard-gantt__bar-copy"><strong>${escapeHtml(task.taskboardTitle)}</strong><small>${formatDisplayDate(start)} – ${formatDisplayDate(dueDate)}</small></span>`
    }
    const monthFormat = (date: Date): string => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(date)
    const dayFormat = (date: Date): string => `<span class="taskboard-gantt__scale-day"><small>${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}</small><strong>${date.getDate()}</strong></span>`
    instance.ext.zoom.init({
      levels: [
        { name: 'day', scale_height: 62, min_column_width: 58, scales: [{ unit: 'month', step: 1, format: monthFormat }, { unit: 'day', step: 1, format: dayFormat, css: ganttDateCellClass }] },
        { name: 'week', scale_height: 62, min_column_width: 42, scales: [{ unit: 'month', step: 1, format: monthFormat }, { unit: 'day', step: 1, format: dayFormat, css: ganttDateCellClass }] },
        { name: 'month', scale_height: 62, min_column_width: 82, scales: [{ unit: 'year', step: 1, format: (date: Date) => `${date.getFullYear()}年` }, { unit: 'month', step: 1, format: (date: Date) => `${date.getMonth() + 1}月` }] },
      ],
    })

    const updateTodayMarker = (): void => {
      if (!containerRef.current) return
      const gridOffset = instance.config.show_grid === false ? 0 : Number(instance.config.grid_width)
      const left = gridOffset + instance.posFromDate(taskboardGanttLocalDate(formatTaskboardLocalDate(new Date()))) - instance.getScrollState().x
      setTodayMarkerLeft(left >= gridOffset && left <= containerRef.current.clientWidth ? left : null)
    }
    instance.attachEvent('onGanttScroll', updateTodayMarker)
    instance.attachEvent('onGanttRender', updateTodayMarker)
    instance.attachEvent('onBeforeTaskDrag', id => {
      const task = tasksRef.current.find(candidate => candidate.id === String(id))
      return Boolean(task && isTaskEditable(task, pendingRef.current, projectNamesRef.current))
    })
    instance.attachEvent('onAfterTaskUpdate', (id, item) => {
      const taskId = String(id)
      if (restoringRef.current.delete(taskId)) return
      const source = tasksRef.current.find(candidate => candidate.id === taskId)
      const ganttTask = item as TaskboardGanttItem
      if (!source || ganttTask.taskboardGroup || item.unscheduled || !item.start_date || !item.end_date) return
      const { startDate, dueDate } = taskboardInclusiveDatesFromGanttRange(
        item.start_date as Date,
        item.end_date as Date,
      )
      if (source.startDate === startDate && source.dueDate === dueDate) return
      void onUpdateDatesRef.current(taskId, startDate, dueDate).catch(() => {
        const current = ganttRef.current
        const schedule = taskboardGanttSchedule(source)
        if (!current || !schedule || !current.isTaskExists(taskId)) return
        const staleItem = current.getTask(taskId)
        restoringRef.current.add(taskId)
        staleItem.start_date = schedule.start
        staleItem.end_date = schedule.end
        current.updateTask(taskId)
      })
    })
    instance.attachEvent('onTaskDblClick', id => {
      const task = tasksRef.current.find(candidate => candidate.id === String(id))
      if (!task) return false
      const scroll = instance.getScrollState()
      pendingViewport = { signature: viewportSignatureRef.current, x: scroll.x, y: scroll.y }
      onOpenRef.current(task.id)
      return false
    })
    instance.init(container)
    instance.ext.zoom.setLevel(zoom)
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(Math.max(260, Math.min(430, entry.contentRect.width * 0.3)))
      expandedGridWidthRef.current = nextWidth
      setGridWidth(nextWidth)
      if (!gridCollapsedRef.current) instance.config.grid_width = nextWidth
      instance.setSizes()
    })
    resizeObserver.observe(container)
    const markerFrame = requestAnimationFrame(updateTodayMarker)
    return () => {
      cancelAnimationFrame(markerFrame)
      resizeObserver.disconnect()
      ganttRef.current = null
      instance.destructor()
    }
  }, [])

  useEffect(() => {
    const instance = ganttRef.current
    if (!instance) return
    const groupOpenState = new Map<string, boolean>()
    for (const group of TASKBOARD_GANTT_GROUPS) {
      const id = `taskboard-gantt-group-${group.status}`
      if (instance.isTaskExists(id)) groupOpenState.set(id, Boolean(instance.getTask(id).$open))
    }
    const data: TaskboardGanttItem[] = []
    for (const group of TASKBOARD_GANTT_GROUPS) {
      const grouped = visibleTasks.filter(task => task.status === group.status)
      if (grouped.length === 0) continue
      const groupId = `taskboard-gantt-group-${group.status}`
      data.push({
        id: groupId,
        text: group.label,
        type: 'project',
        open: groupOpenState.get(groupId) ?? (group.status !== 'done' && group.status !== 'canceled'),
        readonly: true,
        unscheduled: true,
        row_height: 42,
        bar_height: 3,
        taskboardGroup: true,
        taskboardStatus: group.status,
        taskboardTitle: group.label,
        taskboardNumber: 0,
        taskboardUnread: grouped.some(task => task.attention.unread),
        taskboardCount: grouped.length,
      } as TaskboardGanttItem)
      for (const task of grouped) {
        const schedule = taskboardGanttSchedule(task)
        data.push({
          id: task.id,
          parent: groupId,
          text: task.title,
          readonly: !isTaskEditable(task, pendingTaskIds, projectNames),
          ...(schedule ? { start_date: schedule.start, end_date: schedule.end } : { unscheduled: true }),
          taskboardGroup: false,
          taskboardStatus: task.status,
          taskboardTitle: task.title,
          taskboardNumber: task.number,
          taskboardUnread: task.attention.unread,
          taskboardCount: 0,
        } as TaskboardGanttItem)
      }
    }
    const scheduled = visibleTasks.map(taskboardGanttSchedule).filter((value): value is NonNullable<typeof value> => value !== null)
    const today = taskboardGanttLocalDate(formatTaskboardLocalDate(new Date()))
    const starts = scheduled.map(item => item.start.getTime())
    const ends = scheduled.map(item => addTaskboardGanttDays(item.end, -1).getTime())
    const rangeStart = new Date(Math.min(today.getTime(), ...starts))
    const rangeEnd = new Date(Math.max(today.getTime(), ...ends))
    const previousScroll = instance.getScrollState()
    const timelineWidth = containerRef.current?.querySelector<HTMLElement>('.gantt_task')?.clientWidth ?? 0
    const anchorDate = parsedRef.current && timelineWidth
      ? instance.dateFromPos(previousScroll.x + timelineWidth / 2)
      : null
    const restored = pendingViewport?.signature === viewportSignature ? pendingViewport : null
    instance.config.start_date = addTaskboardGanttDays(rangeStart, -7)
    instance.config.end_date = addTaskboardGanttDays(rangeEnd, 8)
    instance.clearAll()
    instance.parse({ data })
    if (restored) instance.scrollTo(restored.x, restored.y)
    else if (anchorDate) instance.scrollTo(Math.max(0, instance.posFromDate(anchorDate) - timelineWidth / 2), previousScroll.y)
    else if (starts.length > 0) instance.showDate(new Date(Math.min(...starts)))
    if (restored) pendingViewport = null
    parsedRef.current = true
  }, [pendingTaskIds, projectNames, viewportSignature, visibleTasks])

  useEffect(() => {
    ganttRef.current?.ext.zoom.setLevel(zoom)
  }, [zoom])

  useEffect(() => {
    if (todayRequest > 0) ganttRef.current?.showDate(new Date())
  }, [todayRequest])

  const toggleGrid = (): void => {
    const instance = ganttRef.current
    if (!instance) return
    const next = !gridCollapsedRef.current
    const scroll = instance.getScrollState()
    gridCollapsedRef.current = next
    setGridCollapsed(next)
    instance.config.show_grid = !next
    instance.config.grid_width = next ? 0 : expandedGridWidthRef.current
    instance.render()
    instance.scrollTo(scroll.x, scroll.y)
  }

  return (
    <div className="taskboard-gantt" aria-label="任务甘特图">
      <div className="taskboard-gantt__canvas" ref={containerRef} />
      {todayMarkerLeft !== null ? <div className="taskboard-gantt__today" style={{ left: todayMarkerLeft }}><span>今天</span></div> : null}
      <button
        aria-expanded={!gridCollapsed}
        aria-label={gridCollapsed ? '展开任务标题' : '收起任务标题'}
        className="taskboard-gantt__grid-toggle"
        style={{ left: gridCollapsed ? 12 : gridWidth }}
        type="button"
        onClick={toggleGrid}
      >
        {gridCollapsed ? '›' : '‹'}
      </button>
      {visibleTasks.length === 0 ? (
        <div className="taskboard-gantt__empty">
          {hasActiveFilters ? '当前筛选下没有任务' : '创建任务后，可在这里安排时间线'}
        </div>
      ) : null}
    </div>
  )
}

function isTaskEditable(
  task: TaskboardWorkflowTaskSummary,
  pendingTaskIds: ReadonlySet<string>,
  projectNames: ReadonlyMap<string, string>,
): boolean {
  return task.archivedAt === null && !pendingTaskIds.has(task.id) && projectNames.has(task.projectId)
}

function taskboardGanttLocalDate(value: string): Date {
  return parseTaskboardLocalDate(value) ?? new Date()
}

function ganttDateCellClass(date: Date): string {
  const classes: string[] = []
  if (date.getDay() === 0 || date.getDay() === 6) classes.push('is-weekend')
  if (formatTaskboardLocalDate(date) === formatTaskboardLocalDate(new Date())) classes.push('is-today')
  return classes.join(' ')
}

function addTaskboardGanttDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

function taskboardGanttSchedule(
  task: TaskboardWorkflowTaskSummary,
): { start: Date; end: Date } | null {
  const projected = projectTaskboardGanttTask(task)
  return projected.scheduled
    ? { start: projected.startDate, end: projected.endDateExclusive }
    : null
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character]!)
}
