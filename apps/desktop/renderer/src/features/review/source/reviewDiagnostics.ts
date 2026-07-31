import { AgentRpcError } from '../../../services/agentRpcClient.js'

export type ReviewDiagnosticContext = Readonly<
  Record<string, string | number | boolean | null | undefined>
>

const MAX_MESSAGE_LENGTH = 2_000

function sanitizeDiagnosticString(value: string): string {
  const sanitized = value
    .replace(/\bBearer\s+[^\s,;"']+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/gu, '[REDACTED]')
    .replace(
      /\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/giu,
      '$1=[REDACTED]',
    )
    .replace(/(["'])[A-Za-z]:[\\/].*?\1/gu, '$1[PATH]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;)"']+/gu, '[PATH]')
    .replace(/\\\\[^\\\s]+\\[^\s,;)"']+/gu, '[PATH]')
  return sanitized.length > MAX_MESSAGE_LENGTH
    ? `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}…`
    : sanitized
}

function reviewDiagnosticError(error: unknown): Record<string, unknown> {
  if (error instanceof AgentRpcError) {
    return {
      errorName: error.name,
      errorCode: error.errorCode,
      status: error.status,
      message: sanitizeDiagnosticString(error.message),
    }
  }
  if (error instanceof Error) {
    return {
      errorName: error.name,
      message: sanitizeDiagnosticString(error.message),
    }
  }
  return {
    errorName: 'UnknownError',
    message: sanitizeDiagnosticString(String(error)),
  }
}

export function reviewDiagnosticMessage(
  event: string,
  context: ReviewDiagnosticContext,
  error?: unknown,
): string {
  return `[review] ${JSON.stringify({
    event,
    ...context,
    ...(error === undefined ? {} : reviewDiagnosticError(error)),
  })}`
}

export function reportReviewDiagnostic(
  level: 'warning' | 'error',
  event: string,
  context: ReviewDiagnosticContext,
  error?: unknown,
): void {
  const message = reviewDiagnosticMessage(event, context, error)
  if (level === 'warning') console.warn(message)
  else console.error(message)
}
