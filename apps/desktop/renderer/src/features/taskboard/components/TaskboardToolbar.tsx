import type React from 'react'
import { useEffect, useState } from 'react'
import { Archive, SlidersHorizontal } from 'lucide-react'
import type {
  TaskboardLabel,
  TaskboardPriority,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { PopoverCheckboxItem, PopoverItem, PopoverLabel, PopoverRadioGroup, PopoverRadioItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'

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
  onChange: (patch: Record<string, string | null>) => void
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
  onChange,
}: Props): React.ReactNode {
  const [query, setQuery] = useState(appliedQuery ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
  useEffect(() => setQuery(appliedQuery ?? ''), [appliedQuery])

  const clearFilters = (): void => {
    onChange({ projectId: null, query: null, priority: null, label: null })
  }

  const toggleLabel = (labelId: string): void => {
    const next = labelIds.includes(labelId)
      ? labelIds.filter(id => id !== labelId)
      : [...labelIds, labelId]
    onChange({ label: next.length ? next.join(',') : null })
  }

  const activeFilterCount = (priority ? 1 : 0) + labelIds.length

  return (
    <div className="taskboard-toolbar" aria-label="任务看板工具栏">
      <h1 className="taskboard-toolbar__title">
        任务看板
        <span className="taskboard-toolbar__count" aria-label={`${count} 个任务`}>
          {count}
        </span>
      </h1>
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
        <select
          aria-label="项目"
          value={projectId ?? ''}
          onChange={event => onChange({ projectId: event.currentTarget.value || null })}
        >
          <option value="">全部项目</option>
          {projects.filter(project => project.projectId).map(project => (
            <option key={project.projectId} value={project.projectId}>{project.name}</option>
          ))}
        </select>
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
        {activeFilterCount > 0 ? (
          <>
            <PopoverSeparator />
            <PopoverItem onClick={() => { clearFilters(); setFilterOpen(false) }}>
              清除筛选
            </PopoverItem>
          </>
        ) : null}
      </PopoverMenu>
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
  )
}
