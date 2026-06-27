import { expect, test } from 'bun:test'
import {
  createDesktopAutoReviewService,
  parseAutoReviewResponse,
} from './autoReviewService.js'

test('parseAutoReviewResponse accepts strict allow deny and ask_user JSON', () => {
  expect(parseAutoReviewResponse('{"decision":"allow","reason":"low risk"}')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'allow',
      alwaysAllow: false,
    },
    reason: 'low risk',
  })

  expect(parseAutoReviewResponse('{"decision":"deny","reason":"destructive"}')).toEqual({
    type: 'decision',
    decision: {
      behavior: 'deny',
      message: 'destructive',
    },
    reason: 'destructive',
  })

  expect(parseAutoReviewResponse('{"decision":"ask_user","reason":"ambiguous"}')).toEqual({
    type: 'fallback',
    reason: 'ambiguous',
  })
})

test('parseAutoReviewResponse falls back for invalid reviewer output', () => {
  expect(parseAutoReviewResponse('yes, looks fine')).toEqual({
    type: 'fallback',
    reason: 'Reviewer returned invalid JSON',
  })
  expect(parseAutoReviewResponse('{"decision":"maybe"}')).toEqual({
    type: 'fallback',
    reason: 'Reviewer returned unsupported decision',
  })
})

test('createDesktopAutoReviewService maps reviewer failures to fallback', async () => {
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

  expect(result).toEqual({
    type: 'fallback',
    reason: 'model unavailable',
  })
})
