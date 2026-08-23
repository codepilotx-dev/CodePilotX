import { useCallback, useEffect, useState } from 'react'
import type {
  TaskboardPlanAggregate,
  TaskboardPlanItem,
  TaskboardPlanningSnapshot,
} from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

type Props = {
  taskId: string
  readOnly: boolean
  onOpenTask?: (taskId: string) => void
  onReadinessChange?: (waitingPrerequisites: readonly string[]) => void
  onSummaryChange?: (summary: TaskboardPlanAggregate) => void
}

const itemTitle = (item: TaskboardPlanItem): string =>
  item.kind === 'step' ? item.title : item.childTask.title

const itemComplete = (item: TaskboardPlanItem): boolean =>
  item.kind === 'step'
    ? item.status === 'done' || item.status === 'skipped'
    : item.childTask.status === 'done' || item.childTask.status === 'canceled'

export const unresolvedPlanPrerequisiteTitles = (
  item: TaskboardPlanItem | undefined,
): readonly string[] => item?.readiness.status === 'waiting'
  ? item.readiness.prerequisites.filter(value => !value.satisfied).map(value => value.title)
  : []

export const taskboardPlanReorderAnchors = (
  items: readonly TaskboardPlanItem[],
  index: number,
  direction: -1 | 1,
): { beforeItemId?: string; afterItemId?: string } | null => {
  const neighbor = items[index + direction]
  if (!neighbor) return null
  return direction < 0 ? { afterItemId: neighbor.id } : { beforeItemId: neighbor.id }
}

const blockerScopeLabel = (
  snapshot: TaskboardPlanningSnapshot,
  planItemId: string | null,
): string => {
  if (!planItemId) return '整个任务'
  const item = snapshot.items.find(candidate => candidate.id === planItemId)
  return item ? `步骤：${itemTitle(item)}` : '已移除步骤'
}

const statusLabel = (item: TaskboardPlanItem): string => {
  if (item.kind === 'step') {
    if (item.status === 'done') return '已完成'
    if (item.status === 'skipped') return '已跳过'
    return '待处理'
  }
  const labels = {
    backlog: '待排期',
    todo: '等待认领',
    in_progress: '处理中',
    blocked: '受阻',
    in_review: '等你确认',
    done: '已完成',
    canceled: '已取消',
  } as const
  return labels[item.childTask.status]
}

export function TaskPlanPanel({ taskId, readOnly, onOpenTask, onReadinessChange, onSummaryChange }: Props) {
  const [snapshot, setSnapshot] = useState<TaskboardPlanningSnapshot | null>(null)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [newChildTitle, setNewChildTitle] = useState('')
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [dependencyItemId, setDependencyItemId] = useState<string | null>(null)
  const [prerequisiteIds, setPrerequisiteIds] = useState<readonly string[]>([])
  const [skipItemId, setSkipItemId] = useState<string | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const [blockerReason, setBlockerReason] = useState('')
  const [blockerItemId, setBlockerItemId] = useState('')
  const [resolvingBlockerId, setResolvingBlockerId] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!desktopClient.readTaskboardPlanning) return
    try {
      const result = await desktopClient.readTaskboardPlanning({ taskId })
      setSnapshot(result.snapshot)
      onSummaryChange?.(result.snapshot.aggregate)
      const parentId = result.snapshot.breadcrumbs.at(-2)?.taskId
      if (parentId) {
        let parent = await desktopClient.readTaskboardPlanning({ taskId: parentId })
        let parentItem = parent.snapshot.items.find(item => item.kind === 'task' && item.childTask.id === taskId)
        if (parentItem?.unreadReady && !readOnly && desktopClient.markTaskboardPlanningAttentionRead) {
          try {
            parent = await desktopClient.markTaskboardPlanningAttentionRead({ taskId: parentId, itemId: parentItem.id })
            parentItem = parent.snapshot.items.find(item => item.kind === 'task' && item.childTask.id === taskId)
          } catch {
            // Reading the task remains useful when an old/read-only host rejects attention mutation.
          }
        }
        onReadinessChange?.(unresolvedPlanPrerequisiteTitles(parentItem))
      } else {
        onReadinessChange?.([])
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '执行计划加载失败')
    }
  }, [onReadinessChange, onSummaryChange, readOnly, taskId])

  useEffect(() => {
    setSnapshot(null)
    setNewStepTitle('')
    setNewChildTitle('')
    setEditingStepId(null)
    setDependencyItemId(null)
    setSkipItemId(null)
    setBlockerReason('')
    setBlockerItemId('')
    setResolvingBlockerId(null)
    void load()
  }, [load])

  useEffect(() => desktopClient.subscribeAgentEventEnvelopes(
    { liveEventTypes: [] },
    events => {
      if (events.some(event =>
        event.type === 'taskboard/planning/changed'
        && (
          event.payload.changedTaskId === taskId
          || event.payload.rootTaskId === taskId
          || (event.payload.projectId === snapshot?.task.task.projectId
            && event.payload.rootTaskId === snapshot.breadcrumbs[0]?.taskId)
        ),
      )) void load()
    },
  ), [load, snapshot, taskId])

  const mutate = async (operation: () => Promise<TaskboardPlanningSnapshot>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await operation()
      setSnapshot(next)
      onSummaryChange?.(next.aggregate)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '执行计划更新失败')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const addStep = async () => {
    if (!snapshot || !desktopClient.applyTaskboardPlanning || !newStepTitle.trim()) return
    await mutate(async () => (await desktopClient.applyTaskboardPlanning!({
      parentTaskId: taskId,
      expectedVersion: snapshot.task.task.version,
      items: [{ clientId: crypto.randomUUID(), kind: 'step', title: newStepTitle.trim() }],
    })).snapshot)
    setNewStepTitle('')
  }

  const addChildTask = async () => {
    if (!snapshot || !desktopClient.applyTaskboardPlanning || !newChildTitle.trim()) return
    await mutate(async () => (await desktopClient.applyTaskboardPlanning!({
      parentTaskId: taskId,
      expectedVersion: snapshot.task.task.version,
      items: [{ clientId: crypto.randomUUID(), kind: 'task', title: newChildTitle.trim() }],
    })).snapshot)
    setNewChildTitle('')
  }

  const updateStep = async (
    item: Extract<TaskboardPlanItem, { kind: 'step' }>,
    patch: { title?: string; description?: string; status?: 'done' | 'skipped'; skipReason?: string },
  ) => {
    if (!desktopClient.updateTaskboardPlanningStep) return
    await mutate(async () => (await desktopClient.updateTaskboardPlanningStep!({
      itemId: item.id,
      expectedVersion: item.version,
      patch,
    })).snapshot)
  }

  const reorderItem = async (item: TaskboardPlanItem, index: number, direction: -1 | 1) => {
    if (!snapshot || !desktopClient.reorderTaskboardPlanningItem) return
    const anchors = taskboardPlanReorderAnchors(snapshot.items, index, direction)
    if (!anchors) return
    await mutate(async () => (await desktopClient.reorderTaskboardPlanningItem!({
      itemId: item.id,
      expectedVersion: item.version,
      ...anchors,
    })).snapshot)
  }

  const editDependencies = (item: TaskboardPlanItem) => {
    setDependencyItemId(item.id)
    setPrerequisiteIds(snapshot?.dependencies
      .filter(value => value.dependentItemId === item.id)
      .map(value => value.prerequisiteItemId) ?? [])
  }

  const saveDependencies = async (item: TaskboardPlanItem) => {
    if (!desktopClient.setTaskboardPlanningDependencies) return
    await mutate(async () => (await desktopClient.setTaskboardPlanningDependencies!({
      itemId: item.id,
      expectedVersion: item.version,
      prerequisiteItemIds: [...prerequisiteIds],
    })).snapshot)
    setDependencyItemId(null)
  }

  const promoteStep = async (item: Extract<TaskboardPlanItem, { kind: 'step' }>) => {
    if (!desktopClient.promoteTaskboardPlanningStep) return
    await mutate(async () => (await desktopClient.promoteTaskboardPlanningStep!({
      itemId: item.id,
      expectedVersion: item.version,
      task: {},
    })).snapshot)
  }

  const markRead = async (item: TaskboardPlanItem) => {
    if (!desktopClient.markTaskboardPlanningAttentionRead) return
    await mutate(async () => (await desktopClient.markTaskboardPlanningAttentionRead!({
      taskId,
      itemId: item.id,
    })).snapshot)
  }

  const createBlocker = async () => {
    if (!desktopClient.createTaskboardPlanningBlocker || !blockerReason.trim()) return
    setBusy(true)
    setError(null)
    try {
      await desktopClient.createTaskboardPlanningBlocker({
        taskId,
        planItemId: blockerItemId || null,
        reason: blockerReason.trim(),
      })
      setBlockerReason('')
      setBlockerItemId('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '阻碍创建失败')
    } finally {
      setBusy(false)
    }
  }

  const resolveBlocker = async (blockerId: string, version: number) => {
    if (!desktopClient.resolveTaskboardPlanningBlocker || !resolution.trim()) return
    setBusy(true)
    setError(null)
    try {
      await desktopClient.resolveTaskboardPlanningBlocker({
        blockerId,
        expectedVersion: version,
        resolution: resolution.trim(),
      })
      setResolvingBlockerId(null)
      setResolution('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '阻碍解决失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="taskboard-drawer__section task-plan-panel">
      <div className="taskboard-drawer__section-heading">
        <h3>执行计划 {snapshot ? <span>{snapshot.aggregate.directDone}/{snapshot.aggregate.directTotal}</span> : null}</h3>
        {snapshot?.aggregate.openBlockerCount ? <span className="task-plan-panel__blocked">{snapshot.aggregate.openBlockerCount} 个阻碍</span> : null}
      </div>
      {!snapshot && !error ? <p className="taskboard-drawer__empty" role="status">正在加载执行计划…</p> : null}
      {error ? <p className="taskboard-dialog__error" role="alert">{error}</p> : null}
      {snapshot?.breadcrumbs.length ? (
        <p className="task-plan-panel__breadcrumbs">{snapshot.breadcrumbs.map(value => `#${value.number} ${value.title}`).join(' / ')}</p>
      ) : null}
      {snapshot?.items.length ? (
        <ol className="task-plan-panel__items">
          {snapshot.items.map((item, index) => (
            <li key={item.id} data-complete={itemComplete(item) ? 'true' : undefined}>
              <div className="task-plan-panel__item-heading">
                <span>{index + 1}</span>
                <div><strong>{itemTitle(item)}</strong><small>{item.kind === 'step' ? '步骤' : '子任务'} · {statusLabel(item)}</small></div>
                {item.unreadReady && !readOnly ? <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => void markRead(item)}>已解锁 · 标为已读</Button> : null}
              </div>
              {!readOnly ? (
                <div className="task-plan-panel__actions">
                  <Button color="ghostSecondary" disabled={busy || index === 0} size="compact" onClick={() => void reorderItem(item, index, -1)}>上移</Button>
                  <Button color="ghostSecondary" disabled={busy || index === snapshot.items.length - 1} size="compact" onClick={() => void reorderItem(item, index, 1)}>下移</Button>
                  <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => editDependencies(item)}>编辑条件</Button>
                  {item.kind === 'task' && onOpenTask ? <Button color="ghostSecondary" size="compact" onClick={() => onOpenTask(item.childTask.id)}>打开详情</Button> : null}
                  {item.kind === 'step' ? <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => {
                    setEditingStepId(item.id)
                    setEditingTitle(item.title)
                    setEditingDescription(item.description)
                  }}>编辑</Button> : null}
                </div>
              ) : item.kind === 'task' && onOpenTask ? <Button color="ghostSecondary" size="compact" onClick={() => onOpenTask(item.childTask.id)}>打开详情</Button> : null}
              {editingStepId === item.id && item.kind === 'step' ? (
                <form className="task-plan-panel__edit-form" onSubmit={event => {
                  event.preventDefault()
                  if (!editingTitle.trim()) return
                  void updateStep(item, { title: editingTitle.trim(), description: editingDescription.trim() }).then(() => setEditingStepId(null))
                }}>
                  <input aria-label="步骤标题" maxLength={200} value={editingTitle} onChange={event => setEditingTitle(event.currentTarget.value)} />
                  <textarea aria-label="步骤描述" rows={3} value={editingDescription} onChange={event => setEditingDescription(event.currentTarget.value)} />
                  <div className="task-plan-panel__actions"><Button color="ghostSecondary" size="compact" type="button" onClick={() => setEditingStepId(null)}>取消</Button><Button color="secondary" disabled={busy || !editingTitle.trim()} size="compact" type="submit">保存</Button></div>
                </form>
              ) : null}
              {dependencyItemId === item.id ? (
                <form className="task-plan-panel__dependencies" onSubmit={event => { event.preventDefault(); void saveDependencies(item) }}>
                  <strong>当前项将在以下项目全部完成后可执行</strong>
                  {snapshot.items.filter(candidate => candidate.id !== item.id).map(candidate => (
                    <label key={candidate.id}><input checked={prerequisiteIds.includes(candidate.id)} type="checkbox" onChange={event => setPrerequisiteIds(current => event.currentTarget.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id))} />{itemTitle(candidate)}</label>
                  ))}
                  {snapshot.items.length === 1 ? <small>暂无可选择的同级前置项。</small> : null}
                  <div className="task-plan-panel__actions"><Button color="ghostSecondary" size="compact" type="button" onClick={() => setDependencyItemId(null)}>取消</Button><Button color="secondary" disabled={busy} size="compact" type="submit">保存条件</Button></div>
                </form>
              ) : null}
              {item.kind === 'step' && item.description ? <p>{item.description}</p> : null}
              {item.readiness.status === 'waiting' ? (
                <p className="task-plan-panel__waiting">等待：{item.readiness.prerequisites.filter(value => !value.satisfied).map(value => value.title).join('、')}</p>
              ) : null}
              {!readOnly && item.kind === 'step' && item.status === 'todo' ? (
                <div className="task-plan-panel__actions">
                  <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => void updateStep(item, { status: 'done' })}>完成</Button>
                  <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => { setSkipItemId(item.id); setSkipReason('') }}>跳过</Button>
                  <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => void promoteStep(item)}>升级为子任务</Button>
                </div>
              ) : null}
              {skipItemId === item.id && item.kind === 'step' ? (
                <form className="task-plan-panel__inline-form" onSubmit={event => {
                  event.preventDefault()
                  const reason = skipReason.trim()
                  if (!reason) return
                  void updateStep(item, { status: 'skipped', skipReason: reason }).then(() => setSkipItemId(null))
                }}>
                  <input aria-label={`跳过“${item.title}”的原因`} autoFocus placeholder="填写跳过原因" value={skipReason} onChange={event => setSkipReason(event.currentTarget.value)} />
                  <Button color="ghostSecondary" size="compact" type="button" onClick={() => setSkipItemId(null)}>取消</Button>
                  <Button color="secondary" disabled={busy || !skipReason.trim()} size="compact" type="submit">确认跳过</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ol>
      ) : snapshot ? <p className="taskboard-drawer__empty">暂无步骤或子任务。</p> : null}
      {!readOnly && snapshot ? (
        <div className="task-plan-panel__create-forms">
          <form className="task-plan-panel__inline-form" onSubmit={event => { event.preventDefault(); void addStep() }}>
            <input aria-label="新步骤标题" maxLength={200} placeholder="添加一个轻量步骤" value={newStepTitle} onChange={event => setNewStepTitle(event.currentTarget.value)} />
            <Button color="secondary" disabled={busy || !newStepTitle.trim()} loading={busy} size="compact" type="submit">新增步骤</Button>
          </form>
          <form className="task-plan-panel__inline-form" onSubmit={event => { event.preventDefault(); void addChildTask() }}>
            <input aria-label="新子任务标题" maxLength={200} placeholder="添加一个独立子任务" value={newChildTitle} onChange={event => setNewChildTitle(event.currentTarget.value)} />
            <Button color="secondary" disabled={busy || !newChildTitle.trim()} size="compact" type="submit">新增子任务</Button>
          </form>
        </div>
      ) : null}
      {snapshot?.blockers.length ? (
        <div className="task-plan-panel__blockers">
          <h4>阻碍</h4>
          {snapshot.blockers.map(blocker => (
            <article key={blocker.id} data-resolved={blocker.status === 'resolved' ? 'true' : undefined}>
              <strong>{blocker.reason}</strong>
              <small>
                {blockerScopeLabel(snapshot, blocker.planItemId)}
                {blocker.sourceThreadId ? ` · 来源会话 ${blocker.sourceThreadId.slice(0, 8)}` : ''}
                {blocker.resolution ? ` · ${blocker.resolution}` : ''}
              </small>
              {!readOnly && blocker.status === 'open' ? <Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => { setResolvingBlockerId(blocker.id); setResolution('') }}>解决</Button> : null}
              {resolvingBlockerId === blocker.id ? (
                <form className="task-plan-panel__inline-form" onSubmit={event => { event.preventDefault(); void resolveBlocker(blocker.id, blocker.version) }}>
                  <input aria-label="阻碍解决说明" autoFocus placeholder="填写解决说明" value={resolution} onChange={event => setResolution(event.currentTarget.value)} />
                  <Button color="ghostSecondary" size="compact" type="button" onClick={() => setResolvingBlockerId(null)}>取消</Button>
                  <Button color="secondary" disabled={busy || !resolution.trim()} size="compact" type="submit">确认解决</Button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {!readOnly && snapshot ? (
        <form className="task-plan-panel__blocker-form" onSubmit={event => { event.preventDefault(); void createBlocker() }}>
          <select aria-label="阻碍关联范围" value={blockerItemId} onChange={event => setBlockerItemId(event.currentTarget.value)}>
            <option value="">整个任务</option>
            {snapshot.items.filter(item => item.kind === 'step').map(item => <option key={item.id} value={item.id}>{itemTitle(item)}</option>)}
          </select>
          <input aria-label="阻碍原因" placeholder="记录一个阻碍" value={blockerReason} onChange={event => setBlockerReason(event.currentTarget.value)} />
          <Button color="secondary" disabled={busy || !blockerReason.trim()} size="compact" type="submit">添加阻碍</Button>
        </form>
      ) : null}
    </section>
  )
}
