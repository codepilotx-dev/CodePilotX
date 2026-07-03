import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
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
        getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
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
          getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
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

test('default reviewer runner writes a hidden internal guardian rollout', async () => {
  const previousConfigDir = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  const previousLegacyConfigDir = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  const configDir = await mkdtemp(join(tmpdir(), 'desktop-guardian-rollout-'))
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir
  try {
	    const service = createDesktopAutoReviewService({
	      createRuntime: (context: DesktopAgentRuntimeContext): DesktopAgentRuntime => ({
	        setModel: () => {},
	        setModelProvider: () => {},
	        setDebugConversationDump: () => {},
	        setPermissionMode: () => {},
	        setPlanModeActive: () => {},
          getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
	        runControlResponse: async () => {},
	        async runUserTurn() {
	          context.emit({
	            type: 'message',
	            sessionId: context.sessionId,
	            role: 'assistant',
	            text: '{"outcome":"allow","rationale":"safe"}',
	          })
	        },
	      }),
    })

    const result = await service.review({
      sessionId: 'parent-session',
      workspacePath: 'C:/repo',
      model: 'test-model',
      request: {
        requestId: 'permission-hidden',
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

    expect(result.guardianRolloutPath).toBeString()
    const content = await readFile(result.guardianRolloutPath!, 'utf8')
    expect(content).toContain('"source":"internal_guardian"')
    expect(content).toContain('"parentSessionId":"parent-session"')
    expect(content).toContain('Review this permission request. Return only JSON.')
    expect(content).toContain('\\"outcome\\":\\"allow\\"')
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env[CODEPILOTX_CONFIG_DIR_ENV]
    } else {
      process.env[CODEPILOTX_CONFIG_DIR_ENV] = previousConfigDir
    }
    if (previousLegacyConfigDir === undefined) {
      delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
    } else {
      process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = previousLegacyConfigDir
    }
    await rm(configDir, { recursive: true, force: true })
  }
})
