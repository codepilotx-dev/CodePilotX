import type React from 'react'
import { useEffect, useState } from 'react'
import { Archive, CalendarClock, ChartGantt, Columns3, EyeOff, List, PanelRight, SlidersHorizontal } from 'lucide-react'
import type {
  TaskboardLabel,
  TaskboardPriority,
  TaskboardWorkflowDatePreset,
  TaskboardWorkflowSort,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { PopoverCheckboxItem, PopoverItem, PopoverLabel, PopoverRadioGroup, PopoverRadioItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { Select } from '../../../components/ui/Select.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'
import type { TaskboardGanttZoom, TaskboardLayout } from '../state/taskboardViewPreferences.js'
import type { TaskboardHierarchyMode } from '../TaskboardView.js'

type Props = {
  projects: readonly DesktopWorkspace[]
  labels: readonly Pick<TaskboardLabel, 'id' | 'name'>[]
  projectId?: string
  query?: string
  priority?: TaskboardPriority
  labelIds: readonly string[]
  count: number
  archived: boolean
  loading: boolean
  hasActiveFilters: boolean
  view: TaskboardLayout
  unread: boolean
  unreadCount: number
  datePreset?: TaskboardWorkflowDatePreset
  sort?: TaskboardWorkflowSort
  hierarchyMode: TaskboardHierarchyMode
  otherTasksOpen: boolean
  ganttZoom: TaskboardGanttZoom
  ganttHideCompleted: boolean
  otherTasksTriggerRef: React.Ref<HTMLButtonElement>
  onViewChange: (view: TaskboardLayout) => void
  onOtherTasksToggle: () => void
  onGanttToday: () => void
  onGanttZoomChange: (zoom: TaskboardGanttZoom) => void
  onGanttHideCompletedChange: (hidden: boolean) => void
  onChange: (patch: Record<string, string | null>) => void
  onHierarchyModeChange: (mode: TaskboardHierarchyMode) => void
}

export function TaskboardToolbar({
  projects,
  labels,
  projectId,
  query: appliedQuery,
  priority,
  labelIds,
  count,
  archived,
  loading,
  hasActiveFilters,
  view,
  unread,
  unreadCount,
  datePreset,
  sort,
  hierarchyMode,
  otherTasksOpen,
  ganttZoom,
  ganttHideCompleted,
  otherTasksTriggerRef,
  onViewChange,
  onOtherTasksToggle,
  onGanttToday,
  onGanttZoomChange,
  onGanttHideCompletedChange,
  onChange,
  onHierarchyModeChange,
}: Props): React.ReactNode {
  const [query, setQuery] = useState(appliedQuery ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [ganttZoomOpen, setGanttZoomOpen] = useState(false)
  useEffect(() => setQuery(appliedQuery ?? ''), [appliedQuery])

  const clearFilters = (): void => {
    onChange({ projectId: null, query: null, priority: null, label: null, unread: null, date: null, sort: null })
  }

  const toggleLabel = (labelId: string): void => {
    const next = labelIds.includes(labelId)
      ? labelIds.filter(id => id !== labelId)
      : [...labelIds, labelId]
    onChange({ label: next.length ? next.join(',') : null })
  }

  const activeFilterCount = (priority ? 1 : 0) + labelIds.length + (unread ? 1 : 0) + (datePreset ? 1 : 0)

  return (
    <div className="taskboard-toolbar" aria-label="任务看板工具栏">
      <SegmentedControl
        ariaLabel="任务视图"
        className="taskboard-toolbar__views"
        onChange={onViewChange}
        options={[
          { value: 'board', label: <><Columns3 aria-hidden="true" size={APP_ICON_SIZE} />议题看板<span className="taskboard-toolbar__count" aria-label={`${count} 个任务`}>{count}</span></> },
          { value: 'list', label: <><List aria-hidden="true" size={APP_ICON_SIZE} />列表视图</> },
          { value: 'gantt', label: <><ChartGantt aria-hidden="true" size={APP_ICON_SIZE} />甘特图</> },
        ]}
        value={view}
      />
      <div className="taskboard-toolbar__tools">
        <label className="taskboard-filter">
          <span className="taskboard-filter__label">层级</span>
          <Select
            ariaLabel="任务层级"
            onValueChange={onHierarchyModeChange}
            options={[
              { value: 'roots', label: '仅顶级' },
              { value: 'expanded', label: '展开子任务' },
              { value: 'ready', label: '仅显示可执行项' },
            ]}
            value={hierarchyMode}
          />
        </label>
        <form
          className="taskboard-toolbar__search"
          onSubmit={event => {
            event.preventDefault()
            onChange({ query: query.trim() || null })
          }}
        >
          <SearchInput
            aria-label="搜索任务"
            clearLabel="清除搜索"
            onChange={value => {
              setQuery(value)
              if (value === '') onChange({ query: null })
            }}
            onEscapeEmpty={() => onChange({ query: null })}
            placeholder="搜索标题或说明"
            value={query}
            variant="compact"
          />
        </form>
        <label className="taskboard-filter">
          <span className="taskboard-filter__label">项目</span>
          <Select
            ariaLabel="项目"
            emptyText="没有可用项目"
            onValueChange={value => onChange({ projectId: value || null, view: null })}
            options={[
              { value: '', label: '全部项目' },
              ...projects.filter(project => project.projectId).map(project => ({
                value: project.projectId!,
                label: project.name,
              })),
            ]}
            searchable
            searchPlaceholder="搜索项目"
            value={projectId ?? ''}
          />
        </label>
        <PopoverMenu
        align="end"
        open={filterOpen}
        width={224}
        trigger={
          <Button
            aria-label="筛选"
            className="taskboard-toolbar__filter-trigger"
            color={activeFilterCount > 0 ? 'ghostActive' : 'ghostSecondary'}
            size="compact"
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={APP_ICON_SIZE} />
            筛选
            {activeFilterCount > 0 ? (
              <span className="taskboard-toolbar__filter-badge">{activeFilterCount}</span>
            ) : null}
          </Button>
        }
        onOpenChange={setFilterOpen}
      >
        <PopoverLabel>优先级</PopoverLabel>
        <PopoverRadioGroup
          value={priority ?? 'all'}
          onValueChange={value => {
            onChange({ priority: value === 'all' ? null : value })
            setFilterOpen(false)
          }}
        >
          <PopoverRadioItem value="all">全部</PopoverRadioItem>
          {(['urgent', 'high', 'medium', 'low'] as const).map(value => (
            <PopoverRadioItem key={value} value={value}>
              {TASKBOARD_PRIORITY_LABELS[value]}
            </PopoverRadioItem>
          ))}
        </PopoverRadioGroup>
        {labels.length > 0 ? (
          <>
            <PopoverSeparator />
            <PopoverLabel>标签</PopoverLabel>
            {labels.map(label => (
              <PopoverCheckboxItem
                checked={labelIds.includes(label.id)}
                key={label.id}
                onCheckedChange={() => toggleLabel(label.id)}
              >
                {label.name}
              </PopoverCheckboxItem>
            ))}
          </>
        ) : null}
        <PopoverSeparator />
        <PopoverCheckboxItem checked={unread} onCheckedChange={() => onChange({ unread: unread ? null : '1' })}>
          待整理（{unreadCount}）
        </PopoverCheckboxItem>
        <PopoverLabel>截止日期</PopoverLabel>
        <PopoverRadioGroup value={datePreset ?? 'all'} onValueChange={value => onChange({ date: value === 'all' ? null : value })}>
          <PopoverRadioItem value="all">全部日期</PopoverRadioItem>
          <PopoverRadioItem value="overdue">已逾期</PopoverRadioItem>
          <PopoverRadioItem value="due_today">今天到期</PopoverRadioItem>
          <PopoverRadioItem value="due_7_days">7 天内到期</PopoverRadioItem>
          <PopoverRadioItem value="no_due_date">无截止日期</PopoverRadioItem>
        </PopoverRadioGroup>
        <PopoverLabel>排序</PopoverLabel>
        <PopoverRadioGroup value={sort ?? 'position'} onValueChange={value => onChange({ sort: value === 'position' ? null : value })}>
          <PopoverRadioItem value="position">看板顺序</PopoverRadioItem>
          <PopoverRadioItem value="due_date">截止日期</PopoverRadioItem>
          <PopoverRadioItem value="updated_at">最近更新</PopoverRadioItem>
        </PopoverRadioGroup>
        {activeFilterCount > 0 ? (
          <>
            <PopoverSeparator />
            <PopoverItem onClick={() => { clearFilters(); setFilterOpen(false) }}>
              清除筛选
            </PopoverItem>
          </>
        ) : null}
        </PopoverMenu>
        {view === 'board' ? (
          <Button ref={otherTasksTriggerRef} aria-controls="taskboard-other-tasks" aria-expanded={otherTasksOpen} aria-pressed={otherTasksOpen} color={otherTasksOpen ? 'ghostActive' : 'ghostSecondary'} size="compact" onClick={onOtherTasksToggle}>
            <PanelRight aria-hidden="true" size={APP_ICON_SIZE} />其他任务
          </Button>
        ) : null}
        {view === 'gantt' ? (
          <>
            <Button color="ghostSecondary" size="compact" type="button" onClick={onGanttToday}>
              <CalendarClock aria-hidden="true" size={APP_ICON_SIZE} />今天
            </Button>
            <label className="taskboard-filter">
              <EyeOff aria-hidden="true" size={APP_ICON_SIZE} />
              <span className="taskboard-filter__label">隐藏完成</span>
              <ToggleSwitch ariaLabel="隐藏已完成任务" checked={ganttHideCompleted} onChange={onGanttHideCompletedChange} />
            </label>
            <PopoverMenu
              align="end"
              open={ganttZoomOpen}
              width={156}
              trigger={<Button color="ghostSecondary" size="compact" type="button">{ganttZoomLabel(ganttZoom)}</Button>}
              onOpenChange={setGanttZoomOpen}
            >
              <PopoverLabel>时间刻度</PopoverLabel>
              <PopoverRadioGroup value={ganttZoom} onValueChange={value => {
                onGanttZoomChange(value as TaskboardGanttZoom)
                setGanttZoomOpen(false)
              }}>
                <PopoverRadioItem value="day">日视图</PopoverRadioItem>
                <PopoverRadioItem value="week">周视图</PopoverRadioItem>
                <PopoverRadioItem value="month">月视图</PopoverRadioItem>
              </PopoverRadioGroup>
            </PopoverMenu>
          </>
        ) : null}
        <Button
          aria-pressed={archived}
          color={archived ? 'ghostActive' : 'ghostSecondary'}
          size="compact"
          type="button"
          onClick={() => onChange({ archived: archived ? null : '1' })}
        >
          <Archive aria-hidden="true" size={APP_ICON_SIZE} />
          {archived ? '返回看板' : '归档区'}
        </Button>
        {!loading && count === 0 && hasActiveFilters ? (
          <span className="taskboard-toolbar__no-results">
            <span>0 个结果</span>
            <Button color="ghostSecondary" size="compact" type="button" onClick={clearFilters}>
              清除筛选
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  )
}

function ganttZoomLabel(zoom: TaskboardGanttZoom): string {
  if (zoom === 'day') return '日'
  if (zoom === 'month') return '月'
  return '周'
}
