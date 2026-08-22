import { describe, expect, test } from 'bun:test'
import { taskboardCreateTaskRpcInput, taskboardStartMode, taskboardTransitionRpcInput } from '../src/features/taskboard/state/useTaskboardController.js'
import { deriveThreadTaskboardAction } from '../src/features/taskboard/state/threadTaskboardAction.js'
import { executeBlockedTransition } from '../src/features/taskboard/state/taskboardBlockedTransition.js'

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
})
