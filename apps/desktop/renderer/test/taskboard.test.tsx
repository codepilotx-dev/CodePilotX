import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  TaskboardPlanItem,
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { parseTaskboardFilters, projectTaskboardHierarchy } from '../src/features/taskboard/TaskboardView.js'
import type { TaskboardPlanningNode } from '../src/features/taskboard/state/taskboardStore.js'
import { optimisticallyMoveTask, taskboardCreateTaskRpcInput, taskboardErrorMessage, taskboardLocalDateKey } from '../src/features/taskboard/state/useTaskboardController.js'
import { resolveBoardColumnDropStatus, resolveTaskDropPlacement } from '../src/features/taskboard/components/BoardColumn.js'
import { BoardColumn } from '../src/features/taskboard/components/BoardColumn.js'
import { taskboardBoardColumns, taskboardTasksForColumn, TaskboardBoard } from '../src/features/taskboard/components/TaskboardBoard.js'
import { TaskboardArchive } from '../src/features/taskboard/components/TaskboardArchive.js'
import { TaskboardList } from '../src/features/taskboard/components/TaskboardList.js'
import { moveTaskDetailsStatus, TaskDetailsDrawer } from '../src/features/taskboard/components/TaskDetailsDrawer.js'
import { taskboardPlanReorderAnchors, unresolvedPlanPrerequisiteTitles } from '../src/features/taskboard/components/TaskPlanPanel.js'
import {
  ComposerDraftStore,
  resolveActivatedSessionComposerInput,
} from '../src/features/session/composer/composerDraftStore.js'
import { RENDERER_CAPABILITIES } from '../src/services/desktop-client/agent-session-client.js'
import { canStartTask, isTaskboardWorkflowStatus } from '../src/features/taskboard/taskboardConstants.js'
import { activeTaskboardPrimaryThreadId } from '../src/features/taskboard/taskboardConstants.js'
import { isInputDialogSubmitDisabled } from '../src/components/ui/ConfirmationDialog.js'
import { taskboardStartActionLabel, taskboardStartCreatesPrimary } from '../src/features/taskboard/components/StartTaskDialog.js'

test('renderer negotiates the taskboard capability', () => {
  expect(RENDERER_CAPABILITIES).toContain('taskboard.v1')
  expect(RENDERER_CAPABILITIES).toContain('taskboard.workflow.v1')
  expect(RENDERER_CAPABILITIES).toContain('taskboard.workflow.diagnostics.v1')
  expect(RENDERER_CAPABILITIES).toContain('taskboard.context.v1')
  expect(RENDERER_CAPABILITIES).toContain('taskboard.planning.v1')
})

test('taskboard workflow status guard rejects empty and unknown wire values', () => {
  expect(isTaskboardWorkflowStatus('blocked')).toBe(true)
  expect(isTaskboardWorkflowStatus('')).toBe(false)
  expect(isTaskboardWorkflowStatus('waiting')).toBe(false)
  expect(isTaskboardWorkflowStatus(null)).toBe(false)
})

test('taskboard schema failures use a safe compatibility message', () => {
  const schemaError = Object.assign(new Error('internal schema path and payload'), {
    name: 'SchemaError',
  })

  expect(taskboardErrorMessage(schemaError)).toBe(
    '任务数据格式不兼容，请更新 CodePilotX 和 Agent 后重试。',
  )
  expect(taskboardErrorMessage(new Error('普通错误'))).toBe('普通错误')
})

test('input dialog permits empty input only when the caller opts in', () => {
  expect(isInputDialogSubmitDisabled('')).toBe(true)
  expect(isInputDialogSubmitDisabled('', true)).toBe(false)
  expect(isInputDialogSubmitDisabled('说明', true, true)).toBe(true)
})

describe('taskboard URL filters', () => {
  test('formats the workflow filter date from the renderer local calendar', () => {
    expect(taskboardLocalDateKey(new Date(2026, 7, 23, 0, 30))).toBe('2026-08-23')
  })

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
  test('child readiness exposes only unfinished all-of prerequisites', () => {
    const childItem = {
      kind: 'task',
      id: 'item:child',
      parentTaskId: 'task:parent',
      childTask: task('child', 'todo', 1024),
      promotedFromStep: null,
      position: 1024,
      readiness: {
        status: 'waiting',
        prerequisites: [
          { id: 'step:a', kind: 'step', title: '调研', satisfied: true },
          { id: 'step:b', kind: 'step', title: '代码扫描', satisfied: false },
        ],
      },
      unreadReady: false,
      version: 1,
    } satisfies TaskboardPlanItem
    const sibling = { ...childItem, id: 'item:sibling' } satisfies TaskboardPlanItem

    expect(unresolvedPlanPrerequisiteTitles(childItem)).toEqual(['代码扫描'])
    expect(taskboardPlanReorderAnchors([sibling, childItem], 1, -1)).toEqual({ afterItemId: sibling.id })
    expect(taskboardPlanReorderAnchors([sibling, childItem], 0, 1)).toEqual({ beforeItemId: childItem.id })
  })

  test('projects roots, recursively expanded children, and ready nodes', () => {
    const tasks = [
      task('root', 'todo', 1024),
      task('child', 'in_progress', 2048),
      task('leaf', 'todo', 3072),
      task('waiting', 'todo', 4096),
    ]
    const aggregate = {
      directTotal: 1,
      directDone: 0,
      directSkipped: 0,
      descendantTaskCount: 1,
      openBlockerCount: 0,
      readyUnreadCount: 0,
    }
    const nodes = {
      root: { parentTaskId: null, depth: 0, aggregate, readiness: { status: 'ready' }, loaded: true },
      child: { parentTaskId: 'root', depth: 1, aggregate, readiness: { status: 'ready' }, loaded: true },
      leaf: { parentTaskId: 'child', depth: 2, aggregate: { ...aggregate, descendantTaskCount: 0 }, readiness: { status: 'ready' }, loaded: true },
      waiting: { parentTaskId: 'root', depth: 1, aggregate, readiness: { status: 'waiting', prerequisites: [{ id: 'before', kind: 'step', title: '前置步骤', satisfied: false }] }, loaded: false },
    } satisfies Record<string, TaskboardPlanningNode>

    expect(projectTaskboardHierarchy(tasks, nodes, new Set(), 'roots').map(value => value.id)).toEqual(['root'])
    expect(projectTaskboardHierarchy(tasks, nodes, new Set(['root']), 'expanded').map(value => value.id)).toEqual(['root', 'child', 'waiting'])
    expect(projectTaskboardHierarchy(tasks, nodes, new Set(['root', 'child']), 'expanded').map(value => value.id)).toEqual(['root', 'child', 'leaf', 'waiting'])
    expect(projectTaskboardHierarchy(tasks, nodes, new Set(), 'ready').map(value => value.id)).toEqual(['root', 'child', 'leaf'])
  })

  test('only active and unarchived workflow tasks can start', () => {
    expect(canStartTask(task('backlog', 'backlog', 1024))).toBe(true)
    expect(canStartTask(task('review', 'in_review', 1024))).toBe(true)
    expect(canStartTask(task('done', 'done', 1024))).toBe(false)
    expect(canStartTask(task('canceled', 'canceled', 1024))).toBe(false)
    expect(canStartTask({ ...task('archived', 'todo', 1024), archivedAt: 2048 })).toBe(false)
  })

  test('top-level cards expose planning aggregates and expansion', () => {
    const root = task('root', 'todo', 1024)
    const aggregate = {
      directTotal: 2,
      directDone: 1,
      directSkipped: 1,
      descendantTaskCount: 3,
      openBlockerCount: 1,
      readyUnreadCount: 1,
    }
    const markup = renderToStaticMarkup(
      <TaskboardBoard
        expandedTaskIds={new Set()}
        hierarchyMode="expanded"
        pendingTaskIds={new Set()}
        planningNodes={{ root: { parentTaskId: null, depth: 0, aggregate, readiness: { status: 'ready' }, loaded: false } }}
        projectNames={new Map([[root.projectId, '项目']])}
        tasks={[root]}
        onLinkThread={async () => {}}
        onMove={async () => {}}
        onNewTask={() => {}}
        onOpen={() => {}}
        onStart={() => {}}
        onToggleTask={() => {}}
      />,
    )
    expect(markup).toContain('1/2 步')
    expect(markup).toContain('1 跳过')
    expect(markup).toContain('3 子任务')
    expect(markup).toContain('1 阻碍')
    expect(markup).toContain('1 已解锁')
    expect(markup).toContain('aria-label="展开 root 的子任务"')
    expect(markup).toContain('class="taskboard-card__open"')
    expect(markup).not.toContain('interactive-row interactive-row--adaptive taskboard-card__open')
    expect(markup).not.toMatch(/class="[^"]*ui-button[^"]*taskboard-card__open/)
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

  test('renders the fixed six workflow columns in product order', () => {
    const markup = renderBoard([])

    expect(columnStatuses(markup)).toEqual([
      'todo',
      'in_progress',
      'in_review',
      'backlog',
      'done',
      'canceled',
    ])
    expect(markup).toContain('data-column-count="6"')
    expect(markup).toContain('暂无任务')
    const columnAddLabels = new Set(
      [...markup.matchAll(/aria-label="(新建任务到[^"]+)"/g)].map(match => match[1]),
    )
    expect(columnAddLabels).toEqual(new Set([
      '新建任务到等待认领',
      '新建任务到处理中',
      '新建任务到等你确认',
      '新建任务到待立项',
      '新建任务到完成',
      '新建任务到取消',
    ]))
  })

  test('groups blocked and in-progress tasks in the processing column', () => {
    const tasks = [
      task('active', 'in_progress', 1024),
      task('blocked', 'blocked', 2048),
    ]
    const processingColumn = taskboardBoardColumns().find(column => column.status === 'in_progress')!
    const markup = renderBoard(tasks)

    expect(columnStatuses(markup)).toEqual(['todo', 'in_progress', 'in_review', 'backlog', 'done', 'canceled'])
    expect(taskboardTasksForColumn(tasks, processingColumn).map(task => task.id)).toEqual(['active', 'blocked'])
    expect((markup.match(/class="taskboard-card"/g) ?? []).length).toBe(2)
  })

  test('preserves blocked on same-column reorder and maps external drops to in-progress', () => {
    const blocked = task('blocked', 'blocked', 1024)

    expect(resolveBoardColumnDropStatus([blocked], blocked.id, 'in_progress')).toBe('blocked')
    expect(resolveBoardColumnDropStatus([blocked], 'external', 'in_progress')).toBe('in_progress')
  })

  test('archive sorts by archived time and keeps each task original status label', () => {
    const archivedTasks = [
      { ...task('older', 'done', 1024), archivedAt: 2048 },
      { ...task('newer', 'blocked', 2048), archivedAt: 3072 },
    ]
    const markup = renderToStaticMarkup(
      <TaskboardArchive
        projectNames={new Map([[archivedTasks[0]!.projectId, '项目']])}
        tasks={archivedTasks}
        onOpen={() => {}}
      />,
    )

    expect(markup.indexOf('打开已归档任务：newer')).toBeLessThan(markup.indexOf('打开已归档任务：older'))
    expect(markup).toContain('遇到阻碍')
    expect(markup).toContain('完成')
    expect(markup).toContain('class="taskboard-archive__row"')
    expect(markup).not.toContain('interactive-row')
    expect(markup).not.toContain('ui-button')
  })

  test('list disclosures and task openers keep native feature-owned button surfaces', () => {
    const item = task('list-task', 'todo', 1024)
    const markup = renderToStaticMarkup(
      <TaskboardList
        expandedTaskIds={new Set()}
        hierarchyMode="flat"
        pendingTaskIds={new Set()}
        planningNodes={{}}
        projectNames={new Map([[item.projectId, '项目']])}
        tasks={[item]}
        onMove={async () => {}}
        onOpen={() => {}}
        onStart={() => {}}
        onToggleTask={() => {}}
        onUpdate={async () => {}}
      />,
    )

    expect(markup).toContain('class="taskboard-list__group-header"')
    expect(markup).toContain('class="taskboard-list__open"')
    expect(markup).not.toContain('interactive-row')
    expect(markup).not.toMatch(/class="[^"]*ui-button[^"]*taskboard-list__(?:group-header|open)/)
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

  test.each([
    ['用户取消 blocked 移动', new Error('已取消移动')],
    ['move RPC 拒绝', new Error('RPC failed')],
  ])('%s 时回滚阶段且消费 rejection', async (_scenario, rejection) => {
    const statuses: string[] = []

    await expect(moveTaskDetailsStatus({
      previousStatus: 'in_progress',
      nextStatus: 'blocked',
      setStatus: status => statuses.push(status),
      onMove: async () => { throw rejection },
    })).resolves.toBeUndefined()

    expect(statuses).toEqual(['blocked', 'in_progress'])
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
      onOpenTask: () => {},
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
    expect(editable).not.toContain('taskboard-edit-form__assignee-slot')
    expect(editable).not.toContain('负责人')
    expect(editable).toContain('执行计划')
    expect(editable.indexOf('执行计划')).toBeLessThan(editable.indexOf('共享上下文'))

    const readOnly = renderToStaticMarkup(
      <TaskDetailsDrawer {...base} readOnly />,
    )
    expect(readOnly).toContain('项目已移除，仅可查看任务内容和历史记录。')
    expect(readOnly).toContain('永久删除任务')

    const archived = renderToStaticMarkup(
      <TaskDetailsDrawer {...base} detail={detailsOf({ ...task('archived', 'todo', 1024), archivedAt: 2048 })} readOnly={false} />,
    )
    expect(archived).toContain('删除任务树、步骤、阻碍和任务上下文')
    expect(archived).toContain('关联对话本身会保留')

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

  test('hydrates the activated session input from the task startup draft', () => {
    expect(resolveActivatedSessionComposerInput(undefined, 'startup context')).toBe('startup context')
    expect(resolveActivatedSessionComposerInput('', 'startup context')).toBe('startup context')
    expect(resolveActivatedSessionComposerInput('user draft', 'startup context')).toBe('user draft')
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
