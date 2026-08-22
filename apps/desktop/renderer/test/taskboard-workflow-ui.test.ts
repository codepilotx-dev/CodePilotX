import { describe, expect, test } from 'bun:test'
import { taskboardInitialThreadLinks } from '../src/features/taskboard/components/CreateTaskDialog.js'
import { taskboardCreateTaskRpcInput, taskboardStartMode, taskboardThreadLinksForDrop, taskboardTransitionRpcInput } from '../src/features/taskboard/state/useTaskboardController.js'
import { beginSidebarSessionDrag, readSidebarSessionDrag, SIDEBAR_SESSION_DRAG_TYPE } from '../src/features/taskboard/taskboardDragData.js'
import { deriveThreadTaskboardAction } from '../src/features/taskboard/state/threadTaskboardAction.js'
import { executeBlockedTransition } from '../src/features/taskboard/state/taskboardBlockedTransition.js'
import { mergeUniqueTaskboardThreadCandidates } from '../src/features/taskboard/state/useTaskboardThreadCandidates.js'

describe('taskboard workflow renderer behavior', () => {
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
})
