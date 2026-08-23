import { describe, expect, test } from 'bun:test'
import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import { createAgentTaskboardApi } from '../src/services/desktop-client/agent-taskboard-api.js'
import type { DesktopTaskboardApi } from '../src/services/desktop-client/types.js'

describe('desktop taskboard planning client', () => {
  test('gates and forwards every planning RPC while supplying operation ids', async () => {
    const capabilities: ProtocolCapability[] = []
    const calls: Array<{ method: string; params: unknown }> = []
    const rpc = {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params })
        return {}
      },
    } as Parameters<typeof createAgentTaskboardApi>[0]['rpc']
    const api = createAgentTaskboardApi({
      requireAgentCapability: capability => capabilities.push(capability),
      rpc,
      mockClient: {} as DesktopTaskboardApi,
      withRequiredAgent: operation => operation(),
      withAgentOrMock: agentOperation => agentOperation(),
    })

    await api.listTaskboardPlanningRoots!({ projectId: 'project-1' })
    await api.readTaskboardPlanning!({ taskId: 'task-1' })
    await api.applyTaskboardPlanning!({
      parentTaskId: 'task-1',
      expectedVersion: 1,
      items: [{ clientId: 'step-1', kind: 'step', title: '调研' }],
    })
    await api.updateTaskboardPlanningStep!({
      itemId: 'item-1',
      expectedVersion: 1,
      patch: { status: 'done' },
    })
    await api.promoteTaskboardPlanningStep!({
      itemId: 'item-1',
      expectedVersion: 1,
      task: {},
    })
    await api.reorderTaskboardPlanningItem!({
      itemId: 'item-1',
      expectedVersion: 1,
      beforeItemId: null,
    })
    await api.reparentTaskboardPlanningChild!({
      childTaskId: 'task-2',
      expectedVersion: 1,
      parentTaskId: 'task-1',
    })
    await api.setTaskboardPlanningDependencies!({
      itemId: 'item-1',
      expectedVersion: 1,
      prerequisiteItemIds: ['item-0'],
    })
    await api.createTaskboardPlanningBlocker!({
      taskId: 'task-1',
      reason: '等待用户确认',
    })
    await api.resolveTaskboardPlanningBlocker!({
      blockerId: 'blocker-1',
      expectedVersion: 1,
      resolution: '用户已经确认',
    })
    await api.markTaskboardPlanningAttentionRead!({ taskId: 'task-1' })
    await api.archiveTaskboardPlanningTree!({
      rootTaskId: 'task-1',
      expectedVersion: 1,
      includeLinkedThreads: false,
    })
    await api.restoreTaskboardPlanningTree!({ rootTaskId: 'task-1' })
    await api.deleteTaskboardPlanningTree!({ rootTaskId: 'task-1' })

    expect(calls.map(call => call.method)).toEqual([
      'taskboard/planning/roots',
      'taskboard/planning/read',
      'taskboard/planning/apply',
      'taskboard/planning/step/update',
      'taskboard/planning/step/promote',
      'taskboard/planning/item/reorder',
      'taskboard/planning/child/reparent',
      'taskboard/planning/dependencies/set',
      'taskboard/planning/blocker/create',
      'taskboard/planning/blocker/resolve',
      'taskboard/planning/attention/mark-read',
      'taskboard/planning/archive-tree',
      'taskboard/planning/restore-tree',
      'taskboard/planning/delete-tree',
    ])
    expect(capabilities).toEqual(
      calls.map(() => 'taskboard.planning.v1'),
    )
    expect(calls.slice(0, 2).every(call =>
      !Object.prototype.hasOwnProperty.call(call.params, 'operationId')),
    ).toBe(true)
    expect(calls.slice(2).every(call =>
      typeof (call.params as { operationId?: unknown }).operationId === 'string'),
    ).toBe(true)
  })
})
