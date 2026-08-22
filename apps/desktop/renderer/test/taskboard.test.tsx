import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { parseTaskboardFilters } from '../src/features/taskboard/TaskboardView.js'
import { optimisticallyMoveTask, taskboardCreateTaskRpcInput } from '../src/features/taskboard/state/useTaskboardController.js'
import { resolveTaskDropPlacement } from '../src/features/taskboard/components/BoardColumn.js'
import { BoardColumn } from '../src/features/taskboard/components/BoardColumn.js'
import { TaskboardBoard } from '../src/features/taskboard/components/TaskboardBoard.js'
import { OtherTasksPanel } from '../src/features/taskboard/components/OtherTasksPanel.js'
import { TaskDetailsDrawer } from '../src/features/taskboard/components/TaskDetailsDrawer.js'
import { ComposerDraftStore } from '../src/features/session/composer/composerDraftStore.js'
import { RENDERER_CAPABILITIES } from '../src/services/desktop-client/agent-session-client.js'
import { canStartTask } from '../src/features/taskboard/taskboardConstants.js'
import { activeTaskboardPrimaryThreadId } from '../src/features/taskboard/taskboardConstants.js'
import { isInputDialogSubmitDisabled } from '../src/components/ui/ConfirmationDialog.js'
import { taskboardStartActionLabel, taskboardStartCreatesPrimary } from '../src/features/taskboard/components/StartTaskDialog.js'

test('renderer negotiates the taskboard capability', () => {
  expect(RENDERER_CAPABILITIES).toContain('taskboard.v1')
  expect(RENDERER_CAPABILITIES).toContain('taskboard.workflow.v1')
})

test('input dialog permits empty input only when the caller opts in', () => {
  expect(isInputDialogSubmitDisabled('')).toBe(true)
  expect(isInputDialogSubmitDisabled('', true)).toBe(false)
  expect(isInputDialogSubmitDisabled('说明', true, true)).toBe(true)
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

describe('taskboard board structure', () => {
  test('only active and unarchived workflow tasks can start', () => {
    expect(canStartTask(task('backlog', 'backlog', 1024))).toBe(true)
    expect(canStartTask(task('review', 'in_review', 1024))).toBe(true)
    expect(canStartTask(task('done', 'done', 1024))).toBe(false)
    expect(canStartTask(task('canceled', 'canceled', 1024))).toBe(false)
    expect(canStartTask({ ...task('archived', 'todo', 1024), archivedAt: 2048 })).toBe(false)
  })

  test('start action distinguishes active, continued, and newly created primary threads', () => {
    const active = {
      ...task('active', 'in_progress', 1024),
      threads: [{
        threadId: 'thread:active',
        role: 'primary' as const,
        title: '执行中',
        attention: 'running' as const,
        execution: { kind: 'local' as const },
      }],
    }
    expect(activeTaskboardPrimaryThreadId(active)).toBe('thread:active')
    expect(taskboardStartCreatesPrimary(true, 'continue_primary')).toBe(false)
    expect(taskboardStartActionLabel(true, 'continue_primary')).toBe('继续主会话')
    expect(taskboardStartCreatesPrimary(true, 'new_primary')).toBe(true)
    expect(taskboardStartActionLabel(true, 'new_primary')).toBe('创建主会话')
    expect(taskboardStartActionLabel(false, 'new_primary')).toBe('创建主会话')
  })

  test('renders the active workflow columns and hides an empty blocked column', () => {
    const markup = renderBoard([])

    expect(columnStatuses(markup)).toEqual([
      'todo',
      'in_progress',
      'in_review',
    ])
    expect(markup).toContain('data-column-count="3"')
    expect(markup).toContain('暂无任务')
    const columnAddLabels = new Set(
      [...markup.matchAll(/aria-label="(新建任务到[^"]+)"/g)].map(match => match[1]),
    )
    expect(columnAddLabels).toEqual(new Set([
      '新建任务到等待认领',
      '新建任务到处理中',
      '新建任务到等你确认',
    ]))
  })

  test('adds the blocked column only when a blocked task exists', () => {
    const markup = renderBoard([task('a', 'todo', 1024), task('b', 'blocked', 2048)])

    expect(columnStatuses(markup)).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'in_review',
    ])
    expect(markup).toContain('data-column-count="4"')
    expect((markup.match(/class="taskboard-card"/g) ?? []).length).toBe(2)
  })

  test('other tasks panel keeps archived selection aligned with archived data', () => {
    const archivedTasks = [
      { ...task('a', 'done', 1024), archivedAt: 2048 },
      { ...task('b', 'canceled', 2048), archivedAt: 3072 },
    ]
    const markup = renderToStaticMarkup(
      <OtherTasksPanel
        archived
        pendingTaskIds={new Set()}
        projectNames={new Map()}
        tasks={archivedTasks}
        onArchivedChange={() => {}}
        onClose={() => {}}
        onMove={async () => {}}
        onLinkThread={async () => {}}
        onNewTask={() => {}}
        onOpen={() => {}}
        onStart={() => {}}
      />,
    )

    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-label="已归档，2 个任务"')
    expect((markup.match(/class="taskboard-card"/g) ?? []).length).toBe(2)
  })

  test('column header add button carries its own status', () => {
    const markup = renderToStaticMarkup(
      <BoardColumn
        label="待办"
        pendingTaskIds={new Set()}
        projectNames={new Map()}
        status="todo"
        tasks={[]}
        onMove={async () => {}}
        onLinkThread={async () => {}}
        onNewTask={() => {}}
        onOpen={() => {}}
        onStart={() => {}}
      />,
    )

    expect(markup).toContain('aria-label="新建任务到待办"')
    // 空列不出现第二个同名文字按钮；主要“新建任务”入口只在 Workspace Header
    expect(markup).not.toContain('>新建任务<')
  })

  test('create RPC input carries the chosen status for the board entry', () => {
    // Radix 弹窗在 SSR 下不渲染内容，创建浮层本身由视觉用例覆盖；
    // 这里验证列头/顶部入口选择的状态会原样进入 taskboard/task/create。
    expect(taskboardCreateTaskRpcInput({
      projectId: 'p1',
      title: '任务',
      status: 'in_progress',
      priority: 'high',
    })).toMatchObject({ projectId: 'p1', status: 'in_progress', priority: 'high' })
    expect(taskboardCreateTaskRpcInput({
      projectId: 'p1',
      title: '任务',
      status: 'backlog',
      priority: 'none',
    }).status).toBe('backlog')
  })

  test('details drawer shows read-only notice only when the project is removed', () => {
    const details = detailsOf(task('a', 'todo', 1024))
    const base = {
      detail: details,
      error: null,
      loading: false,
      open: true,
      pending: false,
      projectName: 'CodePilotX-Ts',
      projectAvailable: true,
      sessions: [] as never[],
      labels: [] as never[],
      onAddComment: async () => {},
      onArchive: async () => {},
      onClose: () => {},
      onCreateLabel: async () => {},
      onDelete: async () => {},
      onDeleteComment: async () => {},
      onDeleteLabel: async () => {},
      onLinkThread: async () => {},
      onOpenThread: () => {},
      onRestore: async () => {},
      onSetPrimaryThread: async () => {},
      onStart: () => {},
      onUnlinkThread: async () => {},
      onUpdate: async () => {},
      onUpdateComment: async () => {},
      onUpdateLabel: async () => {},
    }

    const editable = renderToStaticMarkup(
      <TaskDetailsDrawer {...base} readOnly={false} />,
    )
    expect(editable).toContain('开始执行')
    expect(editable).not.toContain('项目已移除，仅可查看任务内容和历史记录。')

    const readOnly = renderToStaticMarkup(
      <TaskDetailsDrawer {...base} readOnly />,
    )
    expect(readOnly).toContain('项目已移除，仅可查看任务内容和历史记录。')
    expect(readOnly).toContain('永久删除任务')

    const completed = renderToStaticMarkup(
      <TaskDetailsDrawer {...base} detail={detailsOf(task('done', 'done', 1024))} readOnly={false} />,
    )
    expect(completed).not.toContain('lucide-play')
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

function renderBoard(tasks: readonly TaskboardWorkflowTaskSummary[]): string {
  return renderToStaticMarkup(
    <TaskboardBoard
      archived={false}
      pendingTaskIds={new Set()}
      projectNames={new Map()}
      tasks={tasks}
      onMove={async () => {}}
      onLinkThread={async () => {}}
      onNewTask={() => {}}
      onOpen={() => {}}
      onStart={() => {}}
    />,
  )
}

function columnStatuses(markup: string): string[] {
  return [...markup.matchAll(/class="taskboard-column" data-status="([^"]+)"/g)]
    .map(match => match[1]!)
}

function task(
  id: string,
  status: TaskboardWorkflowTaskSummary['status'],
  position: number,
  projectId = 'project-1',
): TaskboardWorkflowTaskSummary {
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
    startDate: null,
    dueDate: null,
    attention: { unread: false, unreadAt: null, readAt: null, reason: null },
    createdAt: 1,
    updatedAt: 1,
  }
}

function detailsOf(task: TaskboardWorkflowTaskSummary): TaskboardWorkflowTaskDetails {
  return {
    task,
    threads: task.threads,
    comments: [],
    activities: [{
      id: `${task.id}-created`,
      taskId: task.id,
      kind: 'task_created',
      actor: 'user',
      sourceThreadId: null,
      data: {},
      createdAt: task.createdAt,
    }],
  }
}
