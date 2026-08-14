import { describe, expect, test } from 'bun:test'
import type { TaskboardTaskSummary } from '@codepilotx/shared/taskboard'
import { parseTaskboardFilters } from '../src/features/taskboard/TaskboardView.js'
import { optimisticallyMoveTask } from '../src/features/taskboard/state/useTaskboardController.js'
import { resolveTaskDropPlacement } from '../src/features/taskboard/components/BoardColumn.js'
import { ComposerDraftStore } from '../src/features/session/composer/composerDraftStore.js'
import { RENDERER_CAPABILITIES } from '../src/services/desktop-client/agent-session-client.js'

test('renderer negotiates the taskboard capability', () => {
  expect(RENDERER_CAPABILITIES).toContain('taskboard.v1')
})

describe('taskboard URL filters', () => {
  test('uses stable query and repeatable label keys', () => {
    const filters = parseTaskboardFilters(new URLSearchParams(
      'projectId=p1&query=fix&priority=high&label=l1,l2&archived=1',
    ))

    expect(filters).toEqual({
      projectId: 'p1',
      query: 'fix',
      priorities: ['high'],
      labelIds: ['l1', 'l2'],
      archived: true,
    })
  })

  test('ignores unsupported priority values', () => {
    expect(parseTaskboardFilters(new URLSearchParams('priority=critical')))
      .toEqual({ archived: false })
  })
})

describe('taskboard ordering', () => {
  test('optimistically inserts before the requested card', () => {
    const moved = optimisticallyMoveTask(
      [task('a', 'todo', 1024), task('b', 'todo', 2048), task('c', 'backlog', 1024)],
      task('c', 'backlog', 1024),
      'todo',
      { beforeTaskId: 'a', afterTaskId: 'b' },
    )

    expect(moved.filter(item => item.status === 'todo').map(item => item.id))
      .toEqual(['a', 'c', 'b'])
  })

  test('places a dropped task after the previous anchor at the column tail', () => {
    const moved = optimisticallyMoveTask(
      [task('a', 'todo', 1024), task('b', 'todo', 2048), task('c', 'backlog', 1024)],
      task('c', 'backlog', 1024),
      'todo',
      { beforeTaskId: 'b', afterTaskId: null },
    )

    expect(moved.filter(item => item.status === 'todo').map(item => item.id))
      .toEqual(['a', 'b', 'c'])
  })

  test('keeps drag anchors inside the moving task project', () => {
    const tasks = [
      task('a-1', 'todo', 1024, 'project-a'),
      task('b-1', 'todo', 1024, 'project-b'),
      task('a-2', 'todo', 2048, 'project-a'),
      task('b-2', 'todo', 2048, 'project-b'),
    ]

    expect(resolveTaskDropPlacement(
      tasks,
      { taskId: 'a-dragged', projectId: 'project-a' },
      'a-2',
      false,
    )).toEqual({ beforeTaskId: 'a-1', afterTaskId: 'a-2', position: 2 })
  })

  test('drops at its own project tail when hovering another project card', () => {
    const tasks = [
      task('a-1', 'todo', 1024, 'project-a'),
      task('b-1', 'todo', 1024, 'project-b'),
      task('a-2', 'todo', 2048, 'project-a'),
    ]

    expect(resolveTaskDropPlacement(
      tasks,
      { taskId: 'a-dragged', projectId: 'project-a' },
      'b-1',
      false,
    )).toEqual({ beforeTaskId: 'a-2', afterTaskId: null, position: 3 })
  })
})

describe('taskboard composer handoff', () => {
  test('prefills an empty session draft without overwriting typed content', () => {
    const store = new ComposerDraftStore(() => 'draft-1')
    const key = 'session:thread-1' as const
    let emissions = 0
    const unsubscribe = store.subscribe(() => { emissions += 1 })

    store.prefillTextIfEmpty(key, 'startup context')
    expect(store.get(key).document.text).toBe('startup context')
    expect(emissions).toBe(1)

    store.update(key, draft => ({
      ...draft,
      document: { text: 'user draft', tokens: [] },
    }))
    store.prefillTextIfEmpty(key, 'replacement context')
    expect(store.get(key).document.text).toBe('user draft')
    expect(emissions).toBe(1)
    unsubscribe()
  })
})

function task(
  id: string,
  status: TaskboardTaskSummary['status'],
  position: number,
  projectId = 'project-1',
): TaskboardTaskSummary {
  return {
    id,
    projectId,
    number: Number(position),
    title: id,
    description: '',
    status,
    priority: 'none',
    position,
    version: 1,
    labels: [],
    threads: [],
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}
