import type { TaskboardWorkflowThreadLookup } from '@codepilotx/shared/taskboard'

export type ThreadTaskboardAction = {
  label: string
  disabled: boolean
  kind: 'loading' | 'open' | 'create' | 'unavailable'
}

export function deriveThreadTaskboardAction(
  loading: boolean,
  lookup: TaskboardWorkflowThreadLookup | null,
): ThreadTaskboardAction {
  if (loading || lookup === null) {
    return { kind: 'loading', label: '正在检查任务关联…', disabled: true }
  }
  if (lookup.taskId) {
    return { kind: 'open', label: '打开关联任务', disabled: false }
  }
  if (lookup.eligible) {
    return { kind: 'create', label: '创建任务', disabled: false }
  }
  const label = lookup.ineligibleReason === 'active'
    ? '会话运行中，完成后可创建任务'
    : lookup.ineligibleReason === 'pending_plan'
      ? '会话等待计划确认，暂不能创建任务'
      : lookup.ineligibleReason === 'archived'
        ? '已归档会话不能创建任务'
        : lookup.ineligibleReason === 'not_main'
          ? '仅主会话可创建任务'
          : lookup.ineligibleReason === 'already_linked'
            ? '会话已关联其他任务'
            : '当前会话不能创建任务'
  return { kind: 'unavailable', label, disabled: true }
}
