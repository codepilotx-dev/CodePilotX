import { describe, expect, test } from 'bun:test'
import { taskboardInitialThreadLinks } from '../src/features/taskboard/components/CreateTaskDialog.js'
import { collectTaskboardWorkflowPages, taskboardCreateTaskRpcInput, taskboardStartMode, taskboardThreadLinksForDrop, taskboardTransitionRpcInput } from '../src/features/taskboard/state/useTaskboardController.js'
import { readTaskboardGanttHideCompleted, readTaskboardGanttZoom, readTaskboardLayout } from '../src/features/taskboard/state/taskboardViewPreferences.js'
import { beginSidebarSessionDrag, readSidebarSessionDrag, SIDEBAR_SESSION_DRAG_TYPE } from '../src/features/taskboard/taskboardDragData.js'
import { deriveThreadTaskboardAction } from '../src/features/taskboard/state/threadTaskboardAction.js'
import { executeBlockedTransition } from '../src/features/taskboard/state/taskboardBlockedTransition.js'
import { reconcileTaskboardStartSession } from '../src/services/desktop-client/taskboardStartSessionReconcile.js'
import { mergeUniqueTaskboardThreadCandidates } from '../src/features/taskboard/state/useTaskboardThreadCandidates.js'
import {
  formatTaskboardLocalDate,
  parseTaskboardLocalDate,
  projectTaskboardGanttGroups,
  projectTaskboardGanttTask,
  taskboardGanttUnscheduledReason,
  taskboardExclusiveEndDate,
  taskboardInclusiveDatesFromGanttRange,
  type TaskboardGanttTaskInput,
} from '../src/features/taskboard/taskboardGanttModel.js'

describe('taskboard workflow renderer behavior', () => {
  test('new task threads are reconciled before start navigation continues', async () => {
    const calls: string[] = []
    const result = await reconcileTaskboardStartSession(async () => {
      calls.push('start')
      return { operation: { threadId: 'thread:new' } }
    }, async () => {
      calls.push('reconcile')
    })

    expect(result.operation.threadId).toBe('thread:new')
    expect(calls).toEqual(['start', 'reconcile'])
  })

  test('gantt URL state accepts explicit values and falls back safely', () => {
    const params = new URLSearchParams('view=gantt&zoom=month&hideCompleted=1')
    expect(readTaskboardLayout(params)).toBe('gantt')
    expect(readTaskboardGanttZoom(params)).toBe('month')
    expect(readTaskboardGanttHideCompleted(params)).toBe(true)
    expect(readTaskboardGanttZoom(new URLSearchParams('zoom=quarter'))).toBe('week')
  })

  test('workflow pagination collects every page in cursor order', async () => {
    const cursors: Array<string | undefined> = []
    const result = await collectTaskboardWorkflowPages(async cursor => {
      cursors.push(cursor)
      return cursor
        ? { tasks: [501, 502], unreadCount: 7, nextCursor: null }
        : { tasks: Array.from({ length: 500 }, (_, index) => index + 1), unreadCount: 7, nextCursor: 'page:2' }
    })
    expect(cursors).toEqual([undefined, 'page:2'])
    expect(result.tasks).toHaveLength(502)
    expect(result.tasks.at(-1)).toBe(502)
    expect(result.unreadCount).toBe(7)
  })

  test('start mode is derived from the current task links', () => {
    expect(taskboardStartMode([])).toBe('new_primary')
    expect(taskboardStartMode([{ role: 'supporting' }])).toBe('new_primary')
    expect(taskboardStartMode([{ role: 'primary' }])).toBe('continue_primary')
  })

  test('create mapping preserves primary and supporting thread links', () => {
    expect(taskboardCreateTaskRpcInput({
      projectId: 'project:1',
      title: '整理历史会话',
      status: 'in_review',
      priority: 'high',
      threadLinks: [
        { threadId: 'thread:1', role: 'primary' },
        { threadId: 'thread:2', role: 'supporting' },
      ],
    }).threadLinks).toEqual([
      { threadId: 'thread:1', role: 'primary' },
      { threadId: 'thread:2', role: 'supporting' },
    ])
  })

  test('transition mapping trims a required lifecycle note', () => {
    expect(taskboardTransitionRpcInput('task:1', 3, 'return_work', '  补充验收结果  ')).toEqual({
      taskId: 'task:1', expectedVersion: 3, action: 'return_work', note: '补充验收结果',
    })
  })

  test('cancelled blocked transition does not mutate', async () => {
    let calls = 0
    expect(await executeBlockedTransition(null, async () => { calls += 1 })).toBe(false)
    expect(calls).toBe(0)
    expect(await executeBlockedTransition('  权限未批准  ', async note => {
      calls += 1
      expect(note).toBe('权限未批准')
    })).toBe(true)
    expect(calls).toBe(1)
  })

  test('thread lookup chooses open, create, and explicit active disabled labels', () => {
    expect(deriveThreadTaskboardAction(false, {
      threadId: 'thread:1', taskId: 'task:1', eligible: false, ineligibleReason: 'already_linked',
    }).kind).toBe('open')
    expect(deriveThreadTaskboardAction(false, {
      threadId: 'thread:2', taskId: null, eligible: true, ineligibleReason: null,
    }).kind).toBe('create')
    const active = deriveThreadTaskboardAction(false, {
      threadId: 'thread:3', taskId: null, eligible: false, ineligibleReason: 'active',
    })
    expect(active.disabled).toBe(true)
    expect(active.label).toContain('运行中')
  })

  test('thread candidate merge ignores transient empty entries', () => {
    const candidate = {
      threadId: 'thread:1',
      projectId: 'project:1',
      title: '历史会话',
      latestTurnStatus: 'completed' as const,
      pendingPlanApproval: false,
      updatedAt: 1,
    }
    expect(mergeUniqueTaskboardThreadCandidates(
      [undefined, candidate],
      [null, { ...candidate, title: '最新标题' }],
    )).toEqual([{ ...candidate, title: '最新标题' }])
  })

  test('sidebar session drag keeps reorder data and allows card copy', () => {
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      types: [] as string[],
      getData: (type: string) => values.get(type) ?? '',
      setData(type: string, value: string) {
        values.set(type, value)
        this.types = [...values.keys()]
      },
    } as unknown as DataTransfer

    beginSidebarSessionDrag(dataTransfer, 'thread:1')

    expect(dataTransfer.effectAllowed).toBe('copyMove')
    expect(Array.from(dataTransfer.types)).toContain(SIDEBAR_SESSION_DRAG_TYPE)
    expect(readSidebarSessionDrag(dataTransfer)).toBe('thread:1')
  })

  test('thread drop preserves links and assigns primary then supporting', () => {
    const first = taskboardThreadLinksForDrop([], 'thread:1')
    expect(first).toEqual({
      role: 'primary',
      links: [{ threadId: 'thread:1', role: 'primary' }],
    })

    const second = taskboardThreadLinksForDrop(first.links, 'thread:2')
    expect(second).toEqual({
      role: 'supporting',
      links: [
        { threadId: 'thread:1', role: 'primary' },
        { threadId: 'thread:2', role: 'supporting' },
      ],
    })
    expect(taskboardThreadLinksForDrop(second.links, 'thread:2').role).toBe('already_linked')
  })

  test('create dialog only submits its compact initial thread as primary', () => {
    expect(taskboardInitialThreadLinks(undefined)).toBeUndefined()
    expect(taskboardInitialThreadLinks({
      threadId: 'thread:1',
      projectId: 'project:1',
      title: '历史会话',
      latestTurnStatus: 'completed',
      pendingPlanApproval: false,
      updatedAt: 1,
    })).toEqual([{ threadId: 'thread:1', role: 'primary' }])
  })

  test('gantt projection keeps workflow group order and can hide completed tasks', () => {
    const tasks = [
      ganttTask('done'),
      ganttTask('backlog'),
      ganttTask('in_review'),
      ganttTask('todo'),
      ganttTask('blocked'),
      ganttTask('canceled'),
      ganttTask('in_progress'),
    ]

    expect(projectTaskboardGanttGroups(tasks).map(group => group.status)).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'in_review',
      'backlog',
      'done',
      'canceled',
    ])
    expect(projectTaskboardGanttGroups(tasks, true).map(group => group.status)).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'in_review',
      'backlog',
    ])
  })

  test('gantt schedules only complete valid inclusive date ranges', () => {
    expect(projectTaskboardGanttTask(ganttTask('todo', '2026-08-22', '2026-08-22')).scheduled).toBe(true)
    expect(projectTaskboardGanttTask(ganttTask('todo', '2026-08-22', null)).scheduled).toBe(false)
    expect(projectTaskboardGanttTask(ganttTask('todo', null, '2026-08-23')).scheduled).toBe(false)
    expect(projectTaskboardGanttTask(ganttTask('todo', '2026-08-24', '2026-08-23')).scheduled).toBe(false)
    expect(projectTaskboardGanttTask(ganttTask('todo', '2026-02-29', '2026-03-01')).scheduled).toBe(false)
  })

  test('gantt explains why a task is not scheduled', () => {
    expect(taskboardGanttUnscheduledReason(ganttTask('todo', null, null))).toBe('未设置日期')
    expect(taskboardGanttUnscheduledReason(ganttTask('todo', null, '2026-08-23'))).toBe('缺少开始日期')
    expect(taskboardGanttUnscheduledReason(ganttTask('todo', '2026-08-22', null))).toBe('缺少截止日期')
    expect(taskboardGanttUnscheduledReason(ganttTask('todo', '2026-08-24', '2026-08-23'))).toBe('日期范围无效')
    expect(taskboardGanttUnscheduledReason(ganttTask('todo', '2026-08-22', '2026-08-23'))).toBeNull()
  })

  test('gantt converts inclusive task dates to and from an exclusive end date', () => {
    const dueDateExclusive = taskboardExclusiveEndDate('2026-08-22')
    expect(dueDateExclusive && formatTaskboardLocalDate(dueDateExclusive)).toBe('2026-08-23')

    const startDate = parseTaskboardLocalDate('2026-08-20')
    const endDateExclusive = parseTaskboardLocalDate('2026-08-23')
    expect(startDate).not.toBeNull()
    expect(endDateExclusive).not.toBeNull()
    expect(taskboardInclusiveDatesFromGanttRange(startDate!, endDateExclusive!)).toEqual({
      startDate: '2026-08-20',
      dueDate: '2026-08-22',
    })
  })
})

function ganttTask(
  status: TaskboardGanttTaskInput['status'],
  startDate: string | null = '2026-08-20',
  dueDate: string | null = '2026-08-22',
): TaskboardGanttTaskInput {
  return {
    id: `task:${status}`,
    number: 1,
    title: status,
    status,
    startDate,
    dueDate,
  }
}
