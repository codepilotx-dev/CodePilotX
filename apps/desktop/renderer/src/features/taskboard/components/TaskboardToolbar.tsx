import type React from 'react'
import { useEffect, useState } from 'react'
import { CalendarClock, EyeOff, Maximize2, SlidersHorizontal } from 'lucide-react'
import type {
  TaskboardLabel,
  TaskboardPriority,
  TaskboardWorkflowDatePreset,
  TaskboardWorkflowSort,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { PopoverCheckboxItem, PopoverItem, PopoverLabel, PopoverRadioGroup, PopoverRadioItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
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
  loading: boolean
  hasActiveFilters: boolean
  view: TaskboardLayout
  unread: boolean
  unreadCount: number
  datePreset?: TaskboardWorkflowDatePreset
  sort?: TaskboardWorkflowSort
  hierarchyMode: TaskboardHierarchyMode
  ganttZoom: TaskboardGanttZoom
  ganttHideCompleted: boolean
  onGanttToday: () => void
  onGanttFitAll?: () => void
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
  loading,
  hasActiveFilters,
  view,
  unread,
  unreadCount,
  datePreset,
  sort,
  hierarchyMode,
  ganttZoom,
  ganttHideCompleted,
  onGanttToday,
  onGanttFitAll,
  onGanttZoomChange,
  onGanttHideCompletedChange,
  onChange,
  onHierarchyModeChange,
}: Props): React.ReactNode {
  const [query, setQuery] = useState(appliedQuery ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
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
      <div className="taskboard-toolbar__tools">
        {view !== 'archive' ? (
          <div className="taskboard-filter taskboard-filter--hierarchy">
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
          </div>
        ) : null}
        <div className="taskboard-filter taskboard-filter--project">
          <Select
            ariaLabel="项目"
            emptyText="没有可用项目"
            onValueChange={value => onChange({
              projectId: value || null,
              view: view === 'archive' ? 'archive' : null,
            })}
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
        </div>
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
      </div>
      <div className="taskboard-toolbar__actions">
        <PopoverMenu
          align="end"
          open={filterOpen}
          width={224}
          trigger={
            <IconButton
              className="taskboard-toolbar__action taskboard-toolbar__filter-trigger"
              color={activeFilterCount > 0 ? 'ghostActive' : 'ghostSecondary'}
              title="筛选"
              size="toolbar"
              type="button"
            >
              <SlidersHorizontal aria-hidden="true" size={APP_ICON_SIZE} />
              {activeFilterCount > 0 ? (
                <span className="taskboard-toolbar__filter-badge">{activeFilterCount}</span>
              ) : null}
            </IconButton>
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
          {view !== 'archive' ? (
            <>
              <PopoverLabel>排序</PopoverLabel>
              <PopoverRadioGroup value={sort ?? 'position'} onValueChange={value => onChange({ sort: value === 'position' ? null : value })}>
                <PopoverRadioItem value="position">看板顺序</PopoverRadioItem>
                <PopoverRadioItem value="due_date">截止日期</PopoverRadioItem>
                <PopoverRadioItem value="updated_at">最近更新</PopoverRadioItem>
              </PopoverRadioGroup>
            </>
          ) : null}
          {activeFilterCount > 0 ? (
            <>
              <PopoverSeparator />
              <PopoverItem onClick={() => { clearFilters(); setFilterOpen(false) }}>
                清除筛选
              </PopoverItem>
            </>
          ) : null}
        </PopoverMenu>
        {view === 'gantt' ? (
          <>
            <IconButton className="taskboard-toolbar__action" color="ghostSecondary" size="toolbar" title="回到今天" type="button" onClick={onGanttToday}>
              <CalendarClock aria-hidden="true" size={APP_ICON_SIZE} />
            </IconButton>
            {onGanttFitAll ? (
              <IconButton className="taskboard-toolbar__action" color="ghostSecondary" size="toolbar" title="适配全部任务" type="button" onClick={onGanttFitAll}>
                <Maximize2 aria-hidden="true" size={APP_ICON_SIZE} />
              </IconButton>
            ) : null}
            <label className="taskboard-filter">
              <EyeOff aria-hidden="true" size={APP_ICON_SIZE} />
              <span className="taskboard-filter__label">隐藏完成</span>
              <ToggleSwitch ariaLabel="隐藏已完成任务" checked={ganttHideCompleted} onChange={onGanttHideCompletedChange} />
            </label>
            <Select
              ariaLabel="时间刻度"
              options={[
                { value: 'day', label: '日视图' },
                { value: 'week', label: '周视图' },
                { value: 'month', label: '月视图' },
              ]}
              triggerClassName="taskboard-toolbar__zoom-select"
              value={ganttZoom}
              width={156}
              onValueChange={onGanttZoomChange}
            />
          </>
        ) : null}
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
