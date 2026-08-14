import type React from 'react'
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import type {
  TaskboardLabel,
  TaskboardPriority,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'

type Props = {
  projects: readonly DesktopWorkspace[]
  labels: readonly Pick<TaskboardLabel, 'id' | 'name'>[]
  projectId?: string
  query?: string
  priority?: TaskboardPriority
  labelIds: readonly string[]
  onChange: (patch: Record<string, string | null>) => void
}

export function TaskboardProjectFilter({
  projects,
  labels,
  projectId,
  query: appliedQuery,
  priority,
  labelIds,
  onChange,
}: Props): React.ReactNode {
  const [query, setQuery] = useState(appliedQuery ?? '')
  useEffect(() => setQuery(appliedQuery ?? ''), [appliedQuery])

  return (
    <div className="taskboard-toolbar" aria-label="任务筛选">
      <form className="taskboard-search" onSubmit={event => {
        event.preventDefault()
        onChange({ query: query.trim() || null })
      }}>
        <Search aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        <input aria-label="搜索任务" placeholder="搜索标题或说明" value={query} onChange={event => setQuery(event.currentTarget.value)} />
        {query ? <IconButton color="ghostSecondary" size="iconSm" title="清除搜索" type="button" onClick={() => { setQuery(''); onChange({ query: null }) }}><X aria-hidden="true" size={APP_ICON_SIZE - 2} /></IconButton> : null}
      </form>
      <label className="taskboard-filter">
        <span>项目</span>
        <select value={projectId ?? ''} onChange={event => onChange({ projectId: event.currentTarget.value || null })}>
          <option value="">全部项目</option>
          {projects.filter(project => project.projectId).map(project => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
        </select>
      </label>
      <label className="taskboard-filter">
        <span>优先级</span>
        <select value={priority ?? ''} onChange={event => onChange({ priority: event.currentTarget.value || null })}>
          <option value="">全部</option>
          {(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).filter(value => value !== 'none').map(value => <option key={value} value={value}>{TASKBOARD_PRIORITY_LABELS[value]}</option>)}
        </select>
      </label>
      {labels.length > 0 ? (
        <div className="taskboard-label-filters" aria-label="标签筛选">
          {labels.map(label => {
            const active = labelIds.includes(label.id)
            const nextLabels = active
              ? labelIds.filter(id => id !== label.id)
              : [...labelIds, label.id]
            return <Button color={active ? 'ghostActive' : 'ghostSecondary'} key={label.id} size="compact" onClick={() => onChange({ label: nextLabels.join(',') || null })}>{label.name}</Button>
          })}
        </div>
      ) : null}
    </div>
  )
}
