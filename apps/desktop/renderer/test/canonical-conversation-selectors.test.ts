import { describe, expect, test } from 'bun:test'
import {
  createCanonicalThreadState,
  type CanonicalThreadPage,
} from '@codepilotx/session-view'

import { selectCanonicalConversationAuxiliaryState } from '../src/features/session/conversation/canonicalConversationSelectors.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const
const model = { providerID: 'openai', id: 'gpt-5' }

describe('canonical conversation auxiliary selector', () => {
  test('derives permissions, usage, sources, title, and message presence', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-1',
        projectID: null,
        title: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 12,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-1',
            threadId: 'thread-1',
            sourceInputID: 'input-1',
            status: 'waiting-permission',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: null,
            elapsedSeconds: 10,
            error: null,
          },
          inputs: [
            {
              id: 'input-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
              content: '请分析这个链接\n并继续',
              delivery: 'start',
              mode: 'chat',
              model,
              permissionConfig,
              state: 'active',
              createdAt: 2,
            },
          ],
          messages: [],
          agents: [],
          items: [
            {
              id: 'text-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'text',
              placement: 'result',
              text: '参考 [文档](https://example.com/docs) 和 http://localhost/private',
              status: 'completed',
              usage: {
                provider: 'openai',
                model: 'gpt-5',
                contextWindow: 10_000,
                input: 100,
                output: 20,
                cacheRead: 200,
                cacheWrite: 10,
                reasoning: 5,
              },
              createdAt: 10,
            },
            {
              id: 'tool-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'shell',
              title: '运行测试',
              state: 'waiting-permission',
              input: { command: 'bun test' },
              command: 'bun test',
              output: null,
              error: null,
              startedAt: 7,
              finishedAt: null,
              durationMs: null,
              createdAt: 7,
            },
            {
              id: 'question-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'question',
              prompt: '继续吗？',
              choices: [
                {
                  id: 'yes',
                  label: '继续',
                  description: '继续执行',
                  recommended: true,
                },
                {
                  id: 'no',
                  label: '停止',
                  description: '停止执行',
                  recommended: false,
                },
              ],
              status: 'pending',
              answer: null,
              createdAt: 8,
            },
          ],
          approvals: [
            {
              id: 'approval-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              toolCallID: 'call-1',
              tool: 'shell',
              command: 'bun test',
              cwd: null,
              paths: [],
              requestedPermissions: {
                readPaths: [],
                writePaths: [],
                networkDomains: [],
              },
              review: null,
              risk: 'medium',
              reason: '需要运行测试',
              status: 'pending',
              createdAt: 7,
            },
          ],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-1', sequence: 1 },
    }

    const result = selectCanonicalConversationAuxiliaryState(
      createCanonicalThreadState(page),
    )

    expect(result.hasConversationMessages).toBe(true)
    expect(result.fallbackTitle).toBe('请分析这个链接')
    expect(result.contextUsage).toMatchObject({
      usedTokens: 310,
      totalTokens: 330,
      reasoningTokens: 5,
    })
    expect(result.pendingPermissions).toHaveLength(2)
    expect(result.pendingPermissions[0]).toMatchObject({
      requestId: 'approval-1',
      toolUseId: 'call-1',
      description: '需要运行测试',
    })
    expect(result.pendingPermissions[1]?.toolName).toBe('AskUserQuestion')
    expect(result.sourceLinks).toEqual([
      { label: '文档', url: 'https://example.com/docs' },
    ])
  })

  test('returns an empty projection before canonical history is ready', () => {
    expect(selectCanonicalConversationAuxiliaryState(null)).toEqual({
      hasConversationMessages: false,
      pendingPermissions: [],
      contextUsage: null,
      sourceLinks: [],
      fallbackTitle: null,
    })
  })
})
