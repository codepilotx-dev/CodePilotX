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
  settings: { defaultModel: null, plannerModel: null, developerModel: null, reviewerModel: null },
}

describe('agent thread adapter', () => {
  test('maps thread list item status and workspace fields', () => {
    const thread: ThreadListItem = {
      id: 'thread-1', projectID: project.id, title: '历史对话', preview: '预览',
      firstUserMessage: '第一条消息', messageCount: 3, latestTurnStatus: 'waiting-permission',
      archivedAt: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000,
    }
    const item = agentThreadListItemToDesktop(thread, project)
    expect(item.status).toBe('waiting')
    expect(item.workspacePath).toBe(project.rootPath)
    expect(item.firstPrompt).toBe('第一条消息')
  })

  test('maps native snapshot text, plan, tool, patch, approval, and question', () => {
    const snapshot: ThreadSnapshot = {
      thread: { id: 'thread-1', title: '历史对话', projectID: project.id, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_008_000 },
      turns: [{
        id: 'turn-1', threadId: 'thread-1', sourceInputID: 'input-1', status: 'running', mode: 'plan',
        model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }, currentStage: 'developer',
        canContinueFromPlan: false, stages: [], mergedInputIDs: [], startedAt: 1_700_000_001_000,
        finishedAt: null, elapsedSeconds: 7, error: null,
      }],
      inputs: [{
        id: 'input-1', threadId: 'thread-1', turnId: 'turn-1', content: '实现历史对话', strategy: 'queue',
        mode: 'plan', model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' },
        state: 'active', createdAt: 1_700_000_001_000,
      }],
      messages: [],
      items: [
        { id: 'text-1', messageID: 'turn-1', turnId: 'turn-1', type: 'text', placement: 'result', text: '可以开始。', status: 'completed', createdAt: 1_700_000_002_000 },
        { id: 'tool-1', messageID: 'turn-1', turnId: 'turn-1', type: 'tool', callID: 'tool-1', tool: 'powershell.exec', title: '运行 PowerShell', state: 'completed', input: { command: 'bun test' }, command: 'bun test', output: 'pass', error: null, startedAt: 1_700_000_003_000, finishedAt: 1_700_000_004_000, durationMs: 1000, createdAt: 1_700_000_003_000 },
        { id: 'plan-1', messageID: 'turn-1', turnId: 'turn-1', type: 'plan', title: '计划', markdown: '- 改 adapter', version: 1, state: 'awaiting-confirmation', createdAt: 1_700_000_005_000 },
        { id: 'patch-1', messageID: 'turn-1', turnId: 'turn-1', type: 'patch', files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: 'diff' }], totalAdditions: 1, totalDeletions: 0, createdAt: 1_700_000_006_000 },
        { id: 'question-1', messageID: 'turn-1', turnId: 'turn-1', type: 'question', prompt: '继续吗？', choices: [{ id: 'yes', label: '继续', description: '继续执行', recommended: true }, { id: 'no', label: '停止', description: '停止执行', recommended: false }], status: 'pending', answer: null, createdAt: 1_700_000_007_000 },
      ],
      approvals: [{ id: 'approval-1', threadId: 'thread-1', turnId: 'turn-1', toolCallID: 'tool-1', tool: 'powershell.exec', command: 'bun test', cwd: null, paths: [], requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] }, risk: 'medium', reason: '需要运行测试', status: 'pending', createdAt: 1_700_000_003_500 }],
      proposals: [],
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
    expect(desktop.view.pendingPermissions.map(request => request.toolName)).toEqual(
      expect.arrayContaining(['powershell.exec', 'ExitPlanMode', 'AskUserQuestion']),
    )
    const question = desktop.view.pendingPermissions.find(request => request.toolName === 'AskUserQuestion')
    expect(agentQuestionIdFromRequestId(question!.requestId)).toBe('question-1')
  })

  test('maps native item notification into a live desktop event', () => {
    const notification: AgentNotification = {
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: { id: 'text-1', messageID: 'turn-1', turnId: 'turn-1', type: 'text', placement: 'result', text: '完成', status: 'completed', createdAt: 1_700_000_010_000 },
      },
    }
    expect(agentEventsFromNotification(notification)).toEqual([{
      type: 'message', sessionId: 'thread-1', role: 'assistant', text: '完成', createdAt: '2023-11-14T22:13:30.000Z',
    }])
  })
})
