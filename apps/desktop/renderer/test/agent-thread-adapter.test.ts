import { describe, expect, test } from 'bun:test'
import type { AgentNotification, Project, ThreadListItem, ThreadSnapshot } from '@codepilotx/shared/thread'
import {
  agentEventsFromNotification,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktop,
  agentThreadSnapshotToDesktop,
} from '../src/services/agentThreadAdapter.js'

const project: Project = {
  id: 'project-1',
  name: 'CodePilotX-Ts',
  rootPath: 'F:\\CodeProject\\CodePilotX-Ts',
  lastOpenedAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  settings: { defaultModel: null },
}

describe('agent thread adapter', () => {
  test('maps thread list item status and workspace fields', () => {
    const thread: ThreadListItem = {
      id: 'thread-1', projectID: project.id, title: '历史对话', preview: '预览',
      firstUserMessage: '第一条消息', messageCount: 3, latestTurnStatus: 'waiting-permission',
      settings: { taskMode: 'plan', permissionConfig: { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'auto_review' } },
      archivedAt: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000,
    }
    const item = agentThreadListItemToDesktop(thread, project)
    expect(item.status).toBe('waiting')
    expect(item.workspacePath).toBe(project.rootPath)
    expect(item.firstPrompt).toBe('第一条消息')
    expect(item.permissionMode).toBe('full-access')
    expect(item.planModeActive).toBe(true)
  })

  test('maps native snapshot text, plan, tool, patch, approval, and question', () => {
    const snapshot: ThreadSnapshot = {
      thread: { id: 'thread-1', title: '历史对话', projectID: project.id, settings: { taskMode: 'plan', permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' } }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_008_000 },
      turns: [{
        id: 'turn-1', threadId: 'thread-1', sourceInputID: 'input-1', status: 'running', mode: 'plan',
        model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }, rootAgentId: 'agent-1',
        canContinueFromPlan: false, mergedInputIDs: [], startedAt: 1_700_000_001_000,
        finishedAt: null, elapsedSeconds: 7, error: null,
      }],
      agents: [{
        id: 'agent-1', threadId: 'thread-1', turnId: 'turn-1', parentAgentId: null,
        profile: 'main', task: '实现历史对话', model: { providerID: 'openai', id: 'gpt-5' },
        sessionId: 'thread-1:main', depth: 0, status: 'running', error: null,
        createdAt: 1_700_000_001_000, updatedAt: 1_700_000_008_000,
      }],
      inputs: [{
        id: 'input-1', threadId: 'thread-1', turnId: 'turn-1', content: '实现历史对话', strategy: 'queue',
        mode: 'plan', model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' },
        state: 'active', createdAt: 1_700_000_001_000,
      }],
      messages: [],
      items: [
        { id: 'text-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'text', placement: 'result', text: '可以开始。', status: 'completed', createdAt: 1_700_000_002_000 },
        { id: 'tool-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'tool', callID: 'tool-1', tool: 'powershell.exec', title: '运行 PowerShell', state: 'completed', input: { command: 'bun test' }, command: 'bun test', output: 'pass', error: null, startedAt: 1_700_000_003_000, finishedAt: 1_700_000_004_000, durationMs: 1000, createdAt: 1_700_000_003_000 },
        { id: 'plan-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'plan', title: '计划', markdown: '- 改 adapter', version: 1, state: 'awaiting-confirmation', createdAt: 1_700_000_005_000 },
        { id: 'patch-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'patch', files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: 'diff' }], totalAdditions: 1, totalDeletions: 0, createdAt: 1_700_000_006_000 },
        { id: 'question-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'question', prompt: '继续吗？', choices: [{ id: 'yes', label: '继续', description: '继续执行', recommended: true }, { id: 'no', label: '停止', description: '停止执行', recommended: false }], status: 'pending', answer: null, createdAt: 1_700_000_007_000 },
      ],
      approvals: [{ id: 'approval-1', threadId: 'thread-1', turnId: 'turn-1', agentId: 'agent-1', toolCallID: 'tool-1', tool: 'powershell.exec', command: 'bun test', cwd: null, paths: [], requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] }, review: null, risk: 'medium', reason: '需要运行测试', status: 'pending', createdAt: 1_700_000_003_500 }],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.status).toBe('running')
    expect(desktop.item.planModeActive).toBe(true)
    expect(desktop.item.permissionMode).toBe('auto-review')
    expect(desktop.view.messages.map(message => message.text)).toContain('实现历史对话')
    expect(desktop.view.messages.map(message => message.text)).toContain('可以开始。')
    expect(desktop.view.toolLog).toHaveLength(2)
    expect(desktop.events?.some(event => event.type === 'proposed_plan')).toBe(true)
    expect(desktop.events?.some(event => event.type === 'file_patch')).toBe(true)
    expect(desktop.events?.find(event => event.id === 'patch-1')?.metadata?.agentId).toBe('agent-1')
    expect(desktop.events?.find(event => event.id === 'approval-1')?.metadata?.agentId).toBe('agent-1')
    expect(desktop.view.pendingPermissions.map(request => request.toolName)).toEqual(
      expect.arrayContaining(['powershell.exec', 'ExitPlanMode', 'AskUserQuestion']),
    )
    const question = desktop.view.pendingPermissions.find(request => request.toolName === 'AskUserQuestion')
    expect(agentQuestionIdFromRequestId(question!.requestId)).toBe('question-1')
  })

  test('uses current thread settings instead of the latest historical turn snapshot', () => {
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-settings', title: '设置投影', projectID: project.id,
        settings: { taskMode: 'chat', permissionConfig: { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'auto_review' } },
        createdAt: 1_700_000_000_000, updatedAt: 1_700_000_008_000,
      },
      turns: [{
        id: 'turn-old', threadId: 'thread-settings', sourceInputID: 'input-old', status: 'completed', mode: 'plan',
        model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }, rootAgentId: 'agent-old',
        canContinueFromPlan: false, mergedInputIDs: [], startedAt: 1_700_000_001_000,
        finishedAt: 1_700_000_002_000, elapsedSeconds: 1, error: null,
      }],
      agents: [{
        id: 'agent-old', threadId: 'thread-settings', turnId: 'turn-old', parentAgentId: null,
        profile: 'main', task: '历史任务', model: { providerID: 'openai', id: 'gpt-5' },
        sessionId: 'thread-settings:main', depth: 0, status: 'completed', error: null,
        createdAt: 1_700_000_001_000, updatedAt: 1_700_000_002_000,
      }],
      inputs: [], messages: [], items: [], approvals: [],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.planModeActive).toBe(false)
    expect(desktop.item.permissionMode).toBe('full-access')
  })

  test('projects queued inputs in queue order without duplicating them in the timeline', () => {
    const permissionConfig = { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' } as const
    const model = { providerID: 'openai', id: 'gpt-5' }
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-queue', title: '队列投影', projectID: project.id,
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1_700_000_000_000, updatedAt: 1_700_000_004_000,
      },
      queue: { version: 4, pauseReason: 'interrupted' },
      turns: [
        {
          id: 'turn-active', threadId: 'thread-queue', sourceInputID: 'input-active', status: 'running', mode: 'chat', model, permissionConfig,
          rootAgentId: 'agent-active', canContinueFromPlan: false, mergedInputIDs: [], startedAt: 1_700_000_001_000,
          finishedAt: null, elapsedSeconds: 3, error: null,
        },
        {
          id: 'turn-third', threadId: 'thread-queue', sourceInputID: 'input-third', status: 'queued', mode: 'chat', model, permissionConfig,
          rootAgentId: 'agent-third', canContinueFromPlan: false, mergedInputIDs: [], queuePosition: 2, startedAt: null,
          finishedAt: null, elapsedSeconds: 0, error: null,
        },
        {
          id: 'turn-second', threadId: 'thread-queue', sourceInputID: 'input-second', status: 'queued', mode: 'chat', model, permissionConfig,
          rootAgentId: 'agent-second', canContinueFromPlan: false, mergedInputIDs: [], queuePosition: 1, startedAt: null,
          finishedAt: null, elapsedSeconds: 0, error: null,
        },
      ],
      agents: [],
      inputs: [
        { id: 'input-active', threadId: 'thread-queue', turnId: 'turn-active', content: '正在执行', strategy: 'queue', mode: 'chat', model, permissionConfig, state: 'active', createdAt: 1_700_000_001_000 },
        { id: 'input-third', threadId: 'thread-queue', turnId: 'turn-third', content: '第三条', strategy: 'queue', mode: 'chat', model, permissionConfig, state: 'queued', createdAt: 1_700_000_003_000 },
        { id: 'input-second', threadId: 'thread-queue', turnId: 'turn-second', content: '第二条', strategy: 'queue', mode: 'chat', model, permissionConfig, state: 'queued', createdAt: 1_700_000_002_000 },
      ],
      messages: [], items: [], approvals: [],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.status).toBe('running')
    expect(desktop.queuedFollowUps?.map(item => item.previewText)).toEqual(['第二条', '第三条'])
    expect(desktop.queuePauseReason).toBe('interrupted')
    expect(desktop.queueVersion).toBe(4)
    expect(desktop.view.messages.map(message => message.text)).toEqual(['正在执行'])
  })

  test('maps native item notification into a live desktop event', () => {
    const notification: AgentNotification = {
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: { id: 'text-1', messageID: 'turn-1', turnId: 'turn-1', agentId: 'agent-1', type: 'text', placement: 'result', text: '完成', status: 'completed', createdAt: 1_700_000_010_000 },
      },
    }
    expect(agentEventsFromNotification(notification)).toEqual([{
      type: 'message', sessionId: 'thread-1', role: 'assistant', text: '完成', createdAt: '2023-11-14T22:13:30.000Z',
    }])
  })

  test('ignores agent upsert notifications until the renderer has an agent tree UI', () => {
    const notification: AgentNotification = {
      jsonrpc: '2.0',
      method: 'agent/upserted',
      params: {
        threadId: 'thread-1',
        agent: {
          id: 'agent-1', threadId: 'thread-1', turnId: 'turn-1', parentAgentId: null,
          profile: 'main', task: '实现历史对话', model: { providerID: 'openai', id: 'gpt-5' },
          sessionId: 'thread-1:main', depth: 0, status: 'running', error: null,
          createdAt: 1_700_000_001_000, updatedAt: 1_700_000_008_000,
        },
      },
    }
    expect(agentEventsFromNotification(notification)).toEqual([])
  })
})
