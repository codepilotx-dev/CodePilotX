import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createRpcClient } from '@codepilotx/agent-protocol/client'
import type { ScheduledTask } from '@codepilotx/shared/scheduled-task'
import { AutomationView } from '../src/features/automation/AutomationView.js'
import { defaultAutomationDraft } from '../src/features/automation/automationModel.js'
import { taskDefinition } from '../src/features/automation/ScheduledTaskDetailPanel.js'
import { WorkspaceHeaderProvider } from '../src/features/layout/workspace-header/index.js'

describe('AutomationView', () => {
  test('one-off drafts create and update through exact RPC params without the recurring schedule', async () => {
    const draft = {
      ...defaultAutomationDraft({ projectId: 'project:calendar', model: { providerID: 'openai', id: 'gpt-5' } }),
      name: '发布检查',
      prompt: '检查发布结果。',
      scheduledFor: new Date(2026, 8, 5, 9).getTime(),
    }
    const definition = taskDefinition(draft)
    const task: ScheduledTask = {
      ...definition,
      id: 'scheduled-task:calendar',
      revision: 1,
      status: 'scheduled',
      threadId: null,
      turnId: null,
      worktreeId: null,
      readAt: null,
      safeErrorCode: null,
      createdAt: draft.scheduledFor,
      updatedAt: draft.scheduledFor,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    }
    const requests: Array<{ method: string; params: unknown }> = []
    const client = createRpcClient({
      request: async message => {
        requests.push({ method: message.method, params: message.params })
        return { jsonrpc: '2.0', id: message.id, result: { scheduledTask: task } }
      },
      notify: async () => {},
    })

    await expect(client.call('scheduled-task/create', { ...draft, operationId: 'create:invalid' })).rejects.toThrow()
    expect(requests).toHaveLength(0)
    const createParams = { ...definition, operationId: 'create:calendar' }
    await expect(client.call('scheduled-task/create', createParams)).resolves.toEqual({ scheduledTask: task })
    const updateParams = { ...taskDefinition(task), id: task.id, expectedRevision: task.revision }
    await expect(client.call('scheduled-task/update', updateParams)).resolves.toEqual({ scheduledTask: task })
    expect(definition).not.toHaveProperty('schedule')
    expect(definition.scheduledFor).toBe(draft.scheduledFor)
    expect(requests).toEqual([
      { method: 'scheduled-task/create', params: createParams },
      { method: 'scheduled-task/update', params: updateParams },
    ])
  })

  test('renders the task calendar shell and execution records inside a router', () => {
    const calendarHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/automations?date=2026-09-05']}>
        <WorkspaceHeaderProvider routeScope="/automations">
          <AutomationView />
        </WorkspaceHeaderProvider>
      </MemoryRouter>,
    )

    expect(calendarHtml.match(/<h1/g)).toHaveLength(1)
    expect(calendarHtml).toContain('任务日历')
    expect(calendarHtml).toContain('placeholder="搜索已安排任务"')
    expect(calendarHtml).toContain('id="automation-calendar-panel"')
    expect(calendarHtml).toContain('正在载入任务日历')
    expect(calendarHtml).not.toContain('primary-page-layout__navigation')
    expect(calendarHtml).not.toContain('automation-detail-presence')
    expect(calendarHtml).not.toContain('收起当日议程')
    expect(calendarHtml).not.toContain('展开当日议程')

    const runsHtml = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/automations?tab=runs']}>
        <WorkspaceHeaderProvider routeScope="/automations">
          <AutomationView />
        </WorkspaceHeaderProvider>
      </MemoryRouter>,
    )

    expect(runsHtml.match(/<h1/g)).toHaveLength(1)
    expect(runsHtml).toContain('执行记录')
    expect(runsHtml).toContain('placeholder="搜索执行记录"')
    expect(runsHtml).toContain('id="automation-runs-panel"')
    expect(runsHtml).toContain('正在载入执行记录')
  })
})
