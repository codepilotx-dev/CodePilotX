import { randomUUID } from 'node:crypto'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import {
  createDesktopAgentRuntime,
  type DesktopAgentRuntime,
  type DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import type {
  DesktopPermissionDecision,
  DesktopPermissionRequest,
} from '../shared/types.js'

export type DesktopAutoReviewOutcome =
  | {
      type: 'decision'
      decision: DesktopPermissionDecision
      reason: string
    }
  | {
      type: 'fallback'
      reason: string
    }

export type DesktopAutoReviewRequest = {
  sessionId: string
  workspacePath: string
  model?: string
  reviewModel?: string
  request: DesktopPermissionRequest
  policy: AgentPermissionPolicy
}

export type DesktopAutoReviewRunner = (
  request: DesktopAutoReviewRequest,
  prompt: string,
) => Promise<string>

export type DesktopAutoReviewService = {
  review(request: DesktopAutoReviewRequest): Promise<DesktopAutoReviewOutcome>
}

export function createDesktopAutoReviewService(options: {
  runReviewerPrompt?: DesktopAutoReviewRunner
  createRuntime?: (context: DesktopAgentRuntimeContext) => DesktopAgentRuntime
  timeoutMs?: number
} = {}): DesktopAutoReviewService {
  const runReviewerPrompt =
    options.runReviewerPrompt ??
    createRuntimeReviewerPromptRunner(
      options.createRuntime ?? createDesktopAgentRuntime,
      options.timeoutMs ?? 60_000,
    )
  return {
    async review(request) {
      const startedAt = Date.now()
      const model = request.reviewModel?.trim() || request.model?.trim()
      logAutoReview('request', {
        sessionId: request.sessionId,
        requestId: request.request.requestId,
        toolName: request.request.toolName,
        model: model ?? null,
        experimentalReviewModel: Boolean(request.reviewModel?.trim()),
      })
      try {
        const text = await runReviewerPrompt(
          request,
          buildAutoReviewPrompt(request),
        )
        const outcome = parseAutoReviewResponse(text)
        logAutoReview(outcome.type === 'decision' ? 'decision' : 'fallback', {
          sessionId: request.sessionId,
          requestId: request.request.requestId,
          toolName: request.request.toolName,
          behavior:
            outcome.type === 'decision'
              ? outcome.decision.behavior
              : 'ask_user',
          reason: outcome.reason,
          durationMs: Date.now() - startedAt,
        })
        return outcome
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logAutoReview('fallback', {
          sessionId: request.sessionId,
          requestId: request.request.requestId,
          toolName: request.request.toolName,
          reason,
          durationMs: Date.now() - startedAt,
        })
        return {
          type: 'fallback',
          reason,
        }
      }
    },
  }
}

export function parseAutoReviewResponse(text: string): DesktopAutoReviewOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    return {
      type: 'fallback',
      reason: 'Reviewer returned invalid JSON',
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      type: 'fallback',
      reason: 'Reviewer returned invalid JSON',
    }
  }
  const record = parsed as Record<string, unknown>
  const reason =
    typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim().slice(0, 500)
      : 'Auto-review did not provide a reason'
  if (record.decision === 'allow') {
    return {
      type: 'decision',
      decision: {
        behavior: 'allow',
        alwaysAllow: false,
      },
      reason,
    }
  }
  if (record.decision === 'deny') {
    return {
      type: 'decision',
      decision: {
        behavior: 'deny',
        message: reason,
      },
      reason,
    }
  }
  if (record.decision === 'ask_user') {
    return {
      type: 'fallback',
      reason,
    }
  }
  return {
    type: 'fallback',
    reason: 'Reviewer returned unsupported decision',
  }
}

function createRuntimeReviewerPromptRunner(
  createRuntime: (context: DesktopAgentRuntimeContext) => DesktopAgentRuntime,
  timeoutMs: number,
): DesktopAutoReviewRunner {
  return async request => {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), timeoutMs)
    const assistantMessages: string[] = []
    const runtime = createRuntime({
      sessionId: `${request.sessionId}:auto-review:${randomUUID()}`,
      workspacePath: request.workspacePath,
      runtimePreference: 'embedded-headless',
      permissionProfile: ':read-only',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      model: request.reviewModel?.trim() || request.model?.trim(),
      systemPrompt: AUTO_REVIEW_SYSTEM_PROMPT,
      emit: event => {
        if (event.type === 'message' && event.role === 'assistant') {
          assistantMessages.push(event.text)
        }
      },
      requestPermission: async () => ({
        behavior: 'deny',
        message: 'Auto-review reviewer is not allowed to request permissions',
      }),
    })
    try {
      await runtime.runUserTurn(buildAutoReviewPrompt(request), abortController.signal)
    } finally {
      clearTimeout(timeout)
    }
    const text = assistantMessages.join('\n').trim()
    if (!text) throw new Error('Reviewer returned no response')
    return text
  }
}

function buildAutoReviewPrompt(request: DesktopAutoReviewRequest): string {
  return [
    'Review this permission request. Return only JSON.',
    '',
    `Workspace: ${request.workspacePath}`,
    `Sandbox mode: ${request.policy.sandboxMode ?? 'unknown'}`,
    `Approval mode: ${request.policy.approvalMode ?? 'unknown'}`,
    `Permission profile: ${request.policy.profile}`,
    `Tool: ${request.request.toolName}`,
    `Kind: ${request.request.requestKind ?? 'tool'}`,
    `Description: ${request.request.description}`,
    `Input JSON: ${JSON.stringify(safeTruncateInput(request.request.input))}`,
    '',
    'Allowed output schema:',
    '{"decision":"allow"|"deny"|"ask_user","reason":"short reason"}',
  ].join('\n')
}

const AUTO_REVIEW_SYSTEM_PROMPT = [
  'You are a restricted auto-reviewer for desktop tool permission requests.',
  'Apply a conservative risk framework.',
  'Approve only low-risk requests that fit the active sandbox and user intent.',
  'Deny clearly destructive, exfiltrating, credential-seeking, or policy-violating requests.',
  'Return ask_user when intent, risk, or context is ambiguous.',
  'Return only valid JSON with keys decision and reason.',
].join('\n')

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function safeTruncateInput(input: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(input)
  if (json.length <= 4_000) return input
  return {
    truncated: true,
    preview: json.slice(0, 4_000),
  }
}

function logAutoReview(event: string, fields: Record<string, unknown>): void {
  console.info(
    `[desktop-auto-review] ${new Date().toISOString()} ${event} ${JSON.stringify(fields)}`,
  )
}
