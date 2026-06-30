import { expect, test } from 'bun:test'
import type { DesktopAgentRuntime, DesktopAgentRuntimeContext } from './agentRuntime.js'
import {
  createDesktopAutoReviewService,
  parseAutoReviewResponse,
} from './autoReviewService.js'

test('parseAutoReviewResponse accepts Guardian allow and deny JSON', () => {
  expect(parseAutoReviewResponse('{"outcome":"allow","rationale":"low risk"}')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'allow',
      alwaysAllow: false,
    },
    assessment: {
      outcome: 'allow',
      rationale: 'low risk',
      riskLevel: 'low',
      userAuthorization: 'unknown',
    },
    reason: 'low risk',
  })

  expect(parseAutoReviewResponse('{"outcome":"deny","rationale":"destructive"}')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'deny',
      message:
        'This action was rejected due to unacceptable risk.\nReason: destructive\nThe agent must not attempt to achieve the same outcome via workaround, indirect execution, or policy circumvention. Proceed only with a materially safer alternative, or if the user explicitly approves the action after being informed of the risk. Otherwise, stop and request user input.',
    },
    assessment: {
      outcome: 'deny',
      rationale: 'destructive',
      riskLevel: 'high',
      userAuthorization: 'unknown',
    },
    reason: 'destructive',
  })
})

test('parseAutoReviewResponse denies invalid reviewer output', () => {
  expect(parseAutoReviewResponse('yes, looks fine')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'deny',
      message:
        'This action was rejected due to unacceptable risk.\nReason: Automatic approval review failed: Reviewer returned invalid JSON\nThe agent must not attempt to achieve the same outcome via workaround, indirect execution, or policy circumvention. Proceed only with a materially safer alternative, or if the user explicitly approves the action after being informed of the risk. Otherwise, stop and request user input.',
    },
    assessment: {
      outcome: 'deny',
      rationale: 'Automatic approval review failed: Reviewer returned invalid JSON',
      riskLevel: 'high',
      userAuthorization: 'unknown',
    },
    reason: 'Reviewer returned invalid JSON',
  })
  expect(parseAutoReviewResponse('{"outcome":"maybe"}')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'deny',
      message:
        'This action was rejected due to unacceptable risk.\nReason: Automatic approval review failed: Reviewer returned unsupported outcome\nThe agent must not attempt to achieve the same outcome via workaround, indirect execution, or policy circumvention. Proceed only with a materially safer alternative, or if the user explicitly approves the action after being informed of the risk. Otherwise, stop and request user input.',
    },
    assessment: {
      outcome: 'deny',
      rationale: 'Automatic approval review failed: Reviewer returned unsupported outcome',
      riskLevel: 'high',
      userAuthorization: 'unknown',
    },
    reason: 'Reviewer returned unsupported decision',
  })
})

test('createDesktopAutoReviewService maps reviewer failures to fail-closed denial', async () => {
  const service = createDesktopAutoReviewService({
    runReviewerPrompt: async () => {
      throw new Error('model unavailable')
    },
  })

  const result = await service.review({
    sessionId: 'session-1',
    workspacePath: 'C:/repo',
    model: 'main-model',
    reviewModel: 'experimental-reviewer',
    request: {
      requestId: 'permission-1',
      toolName: 'PowerShell',
      input: { command: 'echo ok' },
      description: 'Run shell',
    },
    policy: {
      profile: ':workspace',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    },
  })

  expect(result).toMatchObject({
    type: 'decision',
    decision: {
      behavior: 'deny',
    },
    assessment: {
      outcome: 'deny',
      riskLevel: 'high',
      userAuthorization: 'unknown',
      rationale: 'Automatic approval review failed: model unavailable',
    },
  })
})

test('reviewer runtime abort returns fail-closed deny', async () => {
  const service = createDesktopAutoReviewService({
    timeoutMs: 50,
    createRuntime: (
      context: DesktopAgentRuntimeContext,
    ): DesktopAgentRuntime => ({
      setModel: () => {},
      setModelProvider: () => {},
      setDebugConversationDump: () => {},
      setPermissionMode: () => {},
      setPlanModeActive: () => {},
      runControlResponse: async () => {},
      async runUserTurn(_content, signal) {
        await new Promise<void>(resolve => {
          if (signal.aborted) {
            resolve()
            return
          }
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }),
  })

  const result = await service.review({
    sessionId: 'session-abort',
    workspacePath: 'C:/repo',
    model: 'test-model',
    request: {
      requestId: 'permission-abort',
      toolName: 'PowerShell',
      input: { command: 'rm -rf /' },
      description: 'Destructive command',
    },
    policy: {
      profile: ':workspace',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    },
  })

  expect(result).toMatchObject({
    type: 'decision',
    decision: {
      behavior: 'deny',
    },
    assessment: {
      outcome: 'deny',
      riskLevel: 'high',
      userAuthorization: 'unknown',
    },
  })
})

test('createRuntimeReviewerPromptRunner passes serializeHeadlessTurns:false to sub-runtime context', async () => {
  let capturedContext: DesktopAgentRuntimeContext | undefined
  const service = createDesktopAutoReviewService({
    createRuntime: (context: DesktopAgentRuntimeContext): DesktopAgentRuntime => {
      capturedContext = context
      return {
        setModel: () => {},
        setModelProvider: () => {},
        setDebugConversationDump: () => {},
        setPermissionMode: () => {},
        setPlanModeActive: () => {},
        runControlResponse: async () => {},
        async runUserTurn() {
          // Complete immediately — we only need to verify context
        },
      }
    },
  })

  await service.review({
    sessionId: 'session-ctx',
    workspacePath: 'C:/repo',
    model: 'test-model',
    request: {
      requestId: 'permission-ctx',
      toolName: 'PowerShell',
      input: { command: 'echo ok' },
      description: 'Run shell',
    },
    policy: {
      profile: ':workspace',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    },
  })

  expect(capturedContext).toBeDefined()
  expect(capturedContext!.serializeHeadlessTurns).toBe(false)
  // sessionId must be a standard UUID (no colons or other path-illegal chars)
  expect(capturedContext!.sessionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
})
