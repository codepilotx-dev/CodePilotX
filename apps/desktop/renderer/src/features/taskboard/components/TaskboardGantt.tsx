import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react'
import { Gantt, type GanttStatic, type Task as GanttTask } from 'dhtmlx-gantt'
import type { TaskboardPlanStep, TaskboardWorkflowStatus, TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import type { TaskboardGanttZoom } from '../state/taskboardViewPreferences.js'
import type { TaskboardPlanningNode } from '../state/taskboardStore.js'
import '../../../styles/lazy/taskboard-gantt-vendor.scss'
import {
  formatTaskboardLocalDate,
  getTaskboardThisWeekRange,
  getTaskboardTodayRange,
  isTaskboardTaskOverdue,
  parseTaskboardLocalDate,
  projectTaskboardGanttHierarchy,
  taskboardInclusiveDatesFromGanttRange,
} from '../taskboardGanttModel.js'
import { taskboardStatusLabel } from '../taskboardConstants.js'
import { focusTaskboardReturnAnchor } from '../state/taskboardNavigationRestore.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  planningNodes?: Readonly<Record<string, TaskboardPlanningNode>>
  pendingTaskIds: ReadonlySet<string>
  projectNames: ReadonlyMap<string, string>
  zoom: TaskboardGanttZoom
  hideCompleted: boolean
  todayRequest: number
  fitAllRequest?: number
  hasActiveFilters: boolean
  restoreViewport: { taskId: string; scrollLeft: number; scrollTop: number } | null
  onOpen: (taskId: string, viewport?: { scrollLeft: number; scrollTop: number }) => void
  onViewportRestored: () => void
  onUpdateDates: (taskId: string, startDate: string, dueDate: string) => Promise<void>
  planningSteps: readonly TaskboardPlanStep[]
}

type TaskboardGanttItem = GanttTask & {
  taskboardStatus: TaskboardWorkflowStatus
  taskboardTitle: string
  taskboardNumber: number
  taskboardUnread: boolean
  taskboardIsParent: boolean
  taskboardIsOverdue: boolean
}

export default function TaskboardGantt({
  tasks,
  planningNodes = {},
  pendingTaskIds,
  projectNames,
  zoom,
  hideCompleted,
  todayRequest,
  fitAllRequest = 0,
  hasActiveFilters,
  restoreViewport,
  onOpen,
  onViewportRestored,
  onUpdateDates,
  planningSteps,
}: Props): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<GanttStatic | null>(null)
  const tasksRef = useRef(tasks)
  const pendingRef = useRef(pendingTaskIds)
  const projectNamesRef = useRef(projectNames)
  const onOpenRef = useRef(onOpen)
  const onUpdateDatesRef = useRef(onUpdateDates)
  const onViewportRestoredRef = useRef(onViewportRestored)
  const restoredViewportRef = useRef<typeof restoreViewport>(null)
  const restoringRef = useRef(new Set<string>())
  const parsedRef = useRef(false)
  const gridCollapsedRef = useRef(false)
  const expandedGridWidthRef = useRef(360)

  const [gridCollapsed, setGridCollapsed] = useState(false)
  const [gridWidth, setGridWidth] = useState(360)
  const [todayMarkerLeft, setTodayMarkerLeft] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  tasksRef.current = tasks
  pendingRef.current = pendingTaskIds
  projectNamesRef.current = projectNames
  onOpenRef.current = onOpen
  onUpdateDatesRef.current = onUpdateDates
  onViewportRestoredRef.current = onViewportRestored

  const visibleTasks = useMemo(() => (
    hideCompleted
      ? tasks.filter(task => task.status !== 'done' && task.status !== 'canceled')
      : tasks
  ), [hideCompleted, tasks])

  const hierarchy = useMemo(() => (
    projectTaskboardGanttHierarchy(visibleTasks, planningNodes)
  ), [visibleTasks, planningNodes])

  const scheduledHierarchyItems = useMemo(() => (
    hierarchy.filter(item => item.scheduled || (item.isParent && item.startDate && item.endDateExclusive))
  ), [hierarchy])

  const unscheduledTasks = useMemo(() => (
    hierarchy.filter(item => !item.scheduled && !item.isParent).map(item => item.task)
  ), [hierarchy])

  const visiblePlanningSteps = useMemo(() => (
    hideCompleted
      ? planningSteps.filter(step => step.status === 'todo')
      : planningSteps
  ), [hideCompleted, planningSteps])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const instance = Gantt.getGanttInstance()
    ganttRef.current = instance

    instance.config.date_format = '%Y-%m-%d'
    instance.config.xml_date = '%Y-%m-%d'
    instance.config.row_height = 50
    instance.config.bar_height = 32
    instance.config.scale_height = 62
    instance.config.scroll_size = 8
    instance.config.grid_width = 360
    instance.config.min_column_width = 38
    instance.config.drag_progress = false
    instance.config.drag_links = false
    instance.config.show_progress = false
    instance.config.show_unscheduled = false
    instance.config.smart_rendering = true
    instance.config.details_on_dblclick = false
    instance.config.round_dnd_dates = true
    instance.config.select_task = false

    instance.config.columns = [{
      name: 'text',
      label: '任务层级与标题',
      tree: true,
      width: '*',
      min_width: 220,
      template: item => {
        const task = item as TaskboardGanttItem
        return `<span class="taskboard-gantt__tree-node ${task.taskboardIsParent ? 'is-parent' : ''}">
          <small>#${task.taskboardNumber}</small>
          <strong>${escapeHtml(task.taskboardTitle)}</strong>
          <span class="taskboard-gantt__tree-status-pill">${taskboardStatusLabel(task.taskboardStatus)}</span>
          ${task.taskboardUnread ? '<i class="unread-dot" aria-label="待整理"></i>' : ''}
        </span>`
      },
    }]

    instance.templates.grid_folder = () => ''
    instance.templates.grid_file = () => ''
    instance.templates.grid_blank = () => ''

    instance.templates.task_class = (_start, _end, item) => {
      const task = item as TaskboardGanttItem
      if (task.taskboardIsParent) {
        return 'taskboard-gantt__parent-bar'
      }
      return `taskboard-gantt__bar taskboard-gantt__status-${task.taskboardStatus}${task.taskboardIsOverdue ? ' is-overdue' : ''}`
    }

    const rowClass = (item: GanttTask): string => {
      const task = item as TaskboardGanttItem
      return task.taskboardIsParent
        ? 'taskboard-gantt__parent-row'
        : `taskboard-gantt__task-row taskboard-gantt__status-${task.taskboardStatus}${task.taskboardUnread ? ' is-unread' : ''}`
    }

    instance.templates.grid_row_class = (_start, _end, item) => rowClass(item)
    instance.templates.task_row_class = (_start, _end, item) => rowClass(item)
    instance.templates.scale_cell_class = ganttDateCellClass
    instance.templates.timeline_cell_class = (_item, date) => ganttDateCellClass(date)

    instance.templates.task_text = (start, end, item) => {
      const task = item as TaskboardGanttItem
      if (task.taskboardIsParent) return ''
      const dueDate = addTaskboardGanttDays(end, -1)
      return `<span class="taskboard-gantt__bar-copy">
        <strong>${escapeHtml(task.taskboardTitle)}</strong>
        <small>${formatDisplayDate(start)} – ${formatDisplayDate(dueDate)}</small>
        ${task.taskboardIsOverdue ? '<span class="overdue-tag">逾期</span>' : ''}
      </span>`
    }

    const monthFormat = (date: Date): string => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(date)
    const dayFormat = (date: Date): string => `<span class="taskboard-gantt__scale-day"><small>${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}</small><strong>${date.getDate()}</strong></span>`

    instance.ext.zoom.init({
      levels: [
        {
          name: 'day',
          scale_height: 62,
          min_column_width: 58,
          scales: [
            { unit: 'month', step: 1, format: monthFormat },
            { unit: 'day', step: 1, format: dayFormat, css: ganttDateCellClass },
          ],
        },
        {
          name: 'week',
          scale_height: 62,
          min_column_width: 42,
          scales: [
            { unit: 'month', step: 1, format: monthFormat },
            { unit: 'day', step: 1, format: dayFormat, css: ganttDateCellClass },
          ],
        },
        {
          name: 'month',
          scale_height: 62,
          min_column_width: 82,
          scales: [
            { unit: 'year', step: 1, format: (date: Date) => `${date.getFullYear()}年` },
            { unit: 'month', step: 1, format: (date: Date) => `${date.getMonth() + 1}月` },
          ],
        },
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
      if (!source || ganttTask.taskboardIsParent || item.unscheduled || !item.start_date || !item.end_date) return
      const { startDate, dueDate } = taskboardInclusiveDatesFromGanttRange(
        item.start_date as Date,
        item.end_date as Date,
      )
      if (source.startDate === startDate && source.dueDate === dueDate) return
      void onUpdateDatesRef.current(taskId, startDate, dueDate).catch(() => {
        const current = ganttRef.current
        if (!current || !source.startDate || !source.dueDate || !current.isTaskExists(taskId)) return
        const staleItem = current.getTask(taskId)
        restoringRef.current.add(taskId)
        staleItem.start_date = parseTaskboardLocalDate(source.startDate)
        staleItem.end_date = addTaskboardGanttDays(parseTaskboardLocalDate(source.dueDate) ?? new Date(), 1)
        current.updateTask(taskId)
      })
    })

    instance.attachEvent('onTaskDblClick', id => {
      const task = tasksRef.current.find(candidate => candidate.id === String(id))
      if (!task) return false
      const scroll = instance.getScrollState()
      onOpenRef.current(task.id, { scrollLeft: scroll.x, scrollTop: scroll.y })
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

    const openState = new Map<string, boolean>()
    for (const item of scheduledHierarchyItems) {
      if (instance.isTaskExists(item.task.id)) {
        openState.set(item.task.id, Boolean(instance.getTask(item.task.id).$open))
      }
    }

    const data: TaskboardGanttItem[] = scheduledHierarchyItems.map(item => {
      const isParent = item.isParent
      const isEditable = !isParent && isTaskEditable(item.task, pendingTaskIds, projectNames)
      return {
        id: item.task.id,
        parent: item.parentTaskId ?? undefined,
        text: item.task.title,
        type: isParent ? 'project' : 'task',
        open: openState.get(item.task.id) ?? true,
        readonly: !isEditable,
        start_date: item.startDate ?? undefined,
        end_date: item.endDateExclusive ?? undefined,
        taskboardStatus: item.task.status,
        taskboardTitle: item.task.title,
        taskboardNumber: item.task.number,
        taskboardUnread: item.task.attention.unread,
        taskboardIsParent: isParent,
        taskboardIsOverdue: item.isOverdue,
      } as TaskboardGanttItem
    })

    const today = taskboardGanttLocalDate(formatTaskboardLocalDate(new Date()))
    const starts = scheduledHierarchyItems.filter(item => item.startDate).map(item => item.startDate!.getTime())
    const ends = scheduledHierarchyItems.filter(item => item.endDateExclusive).map(item => addTaskboardGanttDays(item.endDateExclusive!, -1).getTime())

    const rangeStart = new Date(Math.min(today.getTime(), ...(starts.length > 0 ? starts : [today.getTime()])))
    const rangeEnd = new Date(Math.max(today.getTime(), ...(ends.length > 0 ? ends : [today.getTime()])))

    const previousScroll = instance.getScrollState()
    const timelineWidth = containerRef.current?.querySelector<HTMLElement>('.gantt_task')?.clientWidth ?? 0
    const anchorDate = parsedRef.current && timelineWidth
      ? instance.dateFromPos(previousScroll.x + timelineWidth / 2)
      : null

    instance.config.start_date = addTaskboardGanttDays(rangeStart, -7)
    instance.config.end_date = addTaskboardGanttDays(rangeEnd, 8)
    instance.clearAll()
    instance.parse({ data })

    if (anchorDate) {
      instance.scrollTo(Math.max(0, instance.posFromDate(anchorDate) - timelineWidth / 2), previousScroll.y)
    } else if (starts.length > 0) {
      instance.showDate(new Date(Math.min(...starts)))
    }
    parsedRef.current = true
  }, [pendingTaskIds, projectNames, scheduledHierarchyItems])

  useEffect(() => {
    const instance = ganttRef.current
    if (!restoreViewport
      || restoredViewportRef.current === restoreViewport
      || !instance?.isTaskExists(restoreViewport.taskId)
    ) return
    instance.scrollTo(restoreViewport.scrollLeft, restoreViewport.scrollTop)
    focusTaskboardReturnAnchor(
      restoreViewport.taskId,
      taskId => instance.getTaskNode(taskId) ?? null,
      taskId => { instance.selectTask(taskId) },
    )
    restoredViewportRef.current = restoreViewport
    onViewportRestoredRef.current()
  }, [restoreViewport, scheduledHierarchyItems])

  useEffect(() => {
    ganttRef.current?.ext.zoom.setLevel(zoom)
  }, [zoom])

  useEffect(() => {
    if (todayRequest > 0) ganttRef.current?.showDate(new Date())
  }, [todayRequest])

  useEffect(() => {
    if (fitAllRequest <= 0 || !ganttRef.current) return
    const starts = scheduledHierarchyItems.filter(item => item.startDate).map(item => item.startDate!.getTime())
    const ends = scheduledHierarchyItems.filter(item => item.endDateExclusive).map(item => item.endDateExclusive!.getTime())
    if (starts.length === 0 || ends.length === 0) return

    const minDate = new Date(Math.min(...starts))
    const maxDate = new Date(Math.max(...ends))
    const instance = ganttRef.current
    instance.config.start_date = addTaskboardGanttDays(minDate, -7)
    instance.config.end_date = addTaskboardGanttDays(maxDate, 8)
    instance.render()
    instance.showDate(minDate)
  }, [fitAllRequest, scheduledHierarchyItems])

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

  const handleTimelineDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDraggingOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId || !containerRef.current || !ganttRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const scroll = ganttRef.current.getScrollState()
    const gridOffset = ganttRef.current.config.show_grid === false ? 0 : Number(ganttRef.current.config.grid_width)
    const relativeX = e.clientX - rect.left - gridOffset + scroll.x
    const targetDate = ganttRef.current.dateFromPos(Math.max(0, relativeX))
    if (targetDate) {
      const dateStr = formatTaskboardLocalDate(targetDate)
      void onUpdateDates(taskId, dateStr, dateStr)
    }
  }

  const totalUnscheduledCount = unscheduledTasks.length + visiblePlanningSteps.length

  return (
    <div className="taskboard-gantt" aria-label="任务甘特图">
      <div
        className={`taskboard-gantt__timeline${isDraggingOver ? ' is-dragging-over' : ''}`}
        onDragOver={e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!isDraggingOver) setIsDraggingOver(true)
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingOver(false)
          }
        }}
        onDrop={handleTimelineDrop}
      >
        <div className="taskboard-gantt__canvas" ref={containerRef} />
        {todayMarkerLeft !== null ? <div className="taskboard-gantt__today" style={{ left: todayMarkerLeft }}><span>今天</span></div> : null}
        <IconButton
          aria-expanded={!gridCollapsed}
          aria-label={gridCollapsed ? '展开任务标题' : '收起任务标题'}
          className="taskboard-gantt__grid-toggle"
          color="ghostSecondary"
          size="toolbar"
          style={{ left: gridCollapsed ? 12 : gridWidth }}
          title={gridCollapsed ? '展开任务标题' : '收起任务标题'}
          type="button"
          onClick={toggleGrid}
        >
          {gridCollapsed
            ? <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
            : <ChevronLeft aria-hidden="true" size={APP_ICON_SIZE} />}
        </IconButton>
        {scheduledHierarchyItems.length === 0 ? (
          <div className="taskboard-gantt__empty">
            {visibleTasks.length === 0
              ? hasActiveFilters ? '当前筛选下没有任务' : '创建任务后，可在这里安排时间线'
              : '暂无已排期任务'}
          </div>
        ) : null}
      </div>

      {totalUnscheduledCount > 0 && !drawerOpen ? (
        <button
          className="taskboard-gantt__unscheduled-badge"
          type="button"
          aria-label={`展开未排期任务面板，共 ${totalUnscheduledCount} 项`}
          onClick={() => setDrawerOpen(true)}
        >
          <span>未排期</span>
          <span className="badge-count">{totalUnscheduledCount}</span>
        </button>
      ) : null}

      {totalUnscheduledCount > 0 && drawerOpen ? (
        <section className="taskboard-gantt__unscheduled-drawer" aria-label={`未排期任务与轻量步骤，共 ${totalUnscheduledCount} 项`}>
          <header>
            <div className="drawer-title">
              <span>未排期任务与轻量步骤</span>
              <span className="count">{totalUnscheduledCount}</span>
            </div>
            <span className="drawer-hint">可直接将卡片拖到时间轴排期</span>
            <IconButton
              color="ghostSecondary"
              size="iconSm"
              title="关闭未排期面板"
              type="button"
              onClick={() => setDrawerOpen(false)}
            >
              <X aria-hidden="true" size={APP_ICON_SIZE} />
            </IconButton>
          </header>
          <div className="taskboard-gantt__unscheduled-list">
            {unscheduledTasks.map(task => (
              <div
                key={task.id}
                className="taskboard-gantt__unscheduled-card"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('text/plain', task.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <div className="card-drag-handle" title="拖拽到时间轴排期">
                  <GripVertical aria-hidden="true" size={14} />
                </div>
                <div className="card-info">
                  <div className="card-meta">
                    <span>{projectNames.get(task.projectId) ?? '项目已移除'}</span>
                    <span>#{task.number}</span>
                  </div>
                  <span className="card-title" title={task.title}>{task.title}</span>
                </div>
                <div className="card-badges">
                  <span className="taskboard-gantt__tree-status-pill">{taskboardStatusLabel(task.status)}</span>
                </div>
                <div className="card-actions">
                  <Button
                    color="ghostSecondary"
                    size="compact"
                    title="排期为今天"
                    type="button"
                    onClick={() => {
                      const { startDate, dueDate } = getTaskboardTodayRange()
                      void onUpdateDates(task.id, startDate, dueDate)
                    }}
                  >
                    今天
                  </Button>
                  <Button
                    color="ghostSecondary"
                    size="compact"
                    title="排期为本周"
                    type="button"
                    onClick={() => {
                      const { startDate, dueDate } = getTaskboardThisWeekRange()
                      void onUpdateDates(task.id, startDate, dueDate)
                    }}
                  >
                    本周
                  </Button>
                  <Button
                    color="ghostSecondary"
                    size="compact"
                    title="打开任务详情"
                    type="button"
                    onClick={() => onOpen(task.id)}
                  >
                    详情
                  </Button>
                </div>
              </div>
            ))}
            {visiblePlanningSteps.map(step => (
              <div className="taskboard-gantt__unscheduled-card" key={`step:${step.id}`}>
                <div className="card-info">
                  <div className="card-meta">
                    <span>轻量步骤</span>
                  </div>
                  <span className="card-title">{step.title}</span>
                </div>
                <div className="card-badges">
                  <span className="taskboard-gantt__tree-status-pill">
                    {step.status === 'done' ? '已完成' : step.status === 'skipped' ? '已跳过' : step.readiness.status === 'ready' ? '可执行' : '等待前置项'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
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
