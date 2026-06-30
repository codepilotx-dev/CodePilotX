/**
 * On-failure approval policy retry logic for sandboxable shell tools.
 *
 * When approvalPolicy is "on-failure":
 * 1. Sandboxable Bash/PowerShell commands run in the sandbox (allowed by permissions)
 * 2. If the command exits non-zero AND is not an interrupt/timeout/background/pre-spawn failure,
 *    trigger an upgrade approval prompt
 * 3. If approved by the user, retry once with dangerouslyDisableSandbox: true
 * 4. If denied or no interactive context, return the original failure result
 */

import { feature } from 'bun:bundle'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { logForDebugging } from '../debug.js'

export type OnFailureRetryState = {
  /** Whether to retry the command outside the sandbox */
  shouldRetry: boolean
  /** Whether this is a retry attempt (to prevent infinite loops) */
  isRetry: boolean
}

/**
 * Determine if the on-failure approval policy is active for this tool and input.
 * Returns null if not applicable, or the retry state if it is.
 */
export function checkOnFailurePolicyState(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolPermissionContext,
): OnFailureRetryState | null {
  if (
    context.approvalPolicy !== 'on-failure' ||
    (toolName !== BASH_TOOL_NAME && toolName !== POWERSHELL_TOOL_NAME)
  ) {
    return null
  }

  if (input.dangerouslyDisableSandbox) {
    return null
  }

  return { shouldRetry: false, isRetry: false }
}

/**
 * Determine if a non-zero exit code from a sandboxed command warrants
 * an on-failure upgrade approval. Returns true when the failure is
 * not an interrupt, timeout, background task, or pre-spawn failure.
 */
export function isOnFailureRetriableExit(
  result: {
    exitCode: number | null
    code: number | null
    interrupted?: boolean
    timedOut?: boolean
    backgroundTaskId?: string
    backgroundedByUser?: boolean
    killSignal?: string
  },
): boolean {
  if (result.exitCode === null && result.code === null) return false
  const exitCode = result.exitCode ?? result.code
  if (exitCode === null || exitCode === 0) return false

  if (result.interrupted) return false
  if (result.timedOut) return false
  if (result.backgroundTaskId) return false
  if (result.backgroundedByUser) return false

  // Pre-spawn failures (e.g. ENOENT, command not found) - shell error codes
  // 126 = command invoked cannot execute, 127 = command not found
  if (exitCode === 126 || exitCode === 127) return false

  return true
}

/**
 * Build the on-failure approval message for the user.
 */
export function buildOnFailureApprovalMessage(
  toolName: string,
  command: string,
  exitCode: number | null,
  stderr: string,
): string {
  const truncatedStderr = stderr.length > 300
    ? stderr.slice(0, 300) + '...'
    : stderr
  const codeInfo = exitCode !== null ? ` (exit code ${exitCode})` : ''
  return `${toolName} command failed${codeInfo}. Retry outside the sandbox?\n\nCommand: ${command}\n\n${truncatedStderr ? `Stderr: ${truncatedStderr}` : ''}`
}

/**
 * Log the on-failure flow for debugging.
 */
export function logOnFailureFlow(
  stage: 'initial-allow' | 'failure-detected' | 'approved-retry' | 'denied' | 'no-interactive',
  details?: string,
): void {
  if ("external" !== 'ant') {
    logForDebugging(`[on-failure] ${stage}${details ? `: ${details}` : ''}`)
  }
}
