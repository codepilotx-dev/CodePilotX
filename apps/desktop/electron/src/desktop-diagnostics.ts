export const AGENT_DIAGNOSTIC_CHANNEL = "agent:diagnostic" as const

export interface AgentDiagnostic {
  at: string
  level: "info" | "warn" | "error"
  source: "agent" | "desktop"
  code: string
  message: string
  details?: {
    phase?: string
    durationMs?: number
    failureCount?: number
    attempt?: number
    toolCallId?: string
  }
}

interface DiagnosticTarget {
  send(channel: string, diagnostic: AgentDiagnostic): void
}

const AGENT_LOG_PREFIX = "[CodePilotX Agent] "
const MAX_PENDING_AGENT_LOG_BYTES = 64 * 1024
const SECRET_VALUE = /\bBearer\s+[^\s,;"']+|\bsk-[A-Za-z0-9_-]+\b/gi
const SECRET_ASSIGNMENT = /\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi

const redactText = (value: string): string => value
  .replace(SECRET_VALUE, "[REDACTED]")
  .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")

const text = (value: unknown, maxLength: number): string | undefined =>
  typeof value === "string" && value.length > 0 ? redactText(value).slice(0, maxLength) : undefined

const nonNegativeNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined

/** Reconstructs the diagnostic so no unapproved field can cross into the renderer. */
export function sanitizeAgentDiagnostic(value: unknown): AgentDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.level !== "info" && input.level !== "warn" && input.level !== "error") return undefined
  if (input.source !== "agent" && input.source !== "desktop") return undefined
  const at = text(input.at, 64)
  const code = text(input.code, 128)
  const message = text(input.message, 1_000)
  if (!at || !code || !message) return undefined

  const rawDetails = input.details
  const detailsInput = rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
    ? rawDetails as Record<string, unknown>
    : undefined
  const details = detailsInput ? {
    phase: text(detailsInput.phase, 128),
    durationMs: nonNegativeNumber(detailsInput.durationMs),
    failureCount: nonNegativeNumber(detailsInput.failureCount),
    attempt: nonNegativeNumber(detailsInput.attempt),
    toolCallId: text(detailsInput.toolCallId, 256),
  } : undefined
  const compactDetails = details && Object.values(details).some(item => item !== undefined) ? details : undefined

  return { at, level: input.level, source: input.source, code, message, ...(compactDetails ? { details: compactDetails } : {}) }
}

/** Main-process integration point; callers pass BrowserWindow.webContents. */
export function publishAgentDiagnostic(target: DiagnosticTarget | undefined, value: unknown): boolean {
  const diagnostic = sanitizeAgentDiagnostic(value)
  if (!target || !diagnostic) return false
  target.send(AGENT_DIAGNOSTIC_CHANNEL, diagnostic)
  return true
}

const SANDBOX_MESSAGES: Record<string, string> = {
  "sandbox.worker.started": "SRT worker 已启动",
  "sandbox.worker.phase": "SRT worker 执行阶段已更新",
  "sandbox.worker.timeout": "SRT worker 执行超时",
  "sandbox.worker.exited": "SRT worker 已退出",
  "sandbox.worker.recovered": "SRT worker 已从上次故障恢复",
}

/** Converts only known sandbox lifecycle records from Agent stderr. */
export function diagnosticFromAgentLogLine(line: string): AgentDiagnostic | undefined {
  if (!line.startsWith(AGENT_LOG_PREFIX)) return undefined
  let value: unknown
  try { value = JSON.parse(line.slice(AGENT_LOG_PREFIX.length)) } catch { return undefined }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const event = typeof record.event === "string" ? record.event : ""
  const message = SANDBOX_MESSAGES[event]
  if (!message) return undefined
  const details = record.details && typeof record.details === "object" && !Array.isArray(record.details)
    ? record.details as Record<string, unknown>
    : {}
  return sanitizeAgentDiagnostic({
    at: record.at,
    level: record.level,
    source: "agent",
    code: typeof details.code === "string" ? details.code : event,
    message,
    details: {
      phase: details.phase,
      durationMs: details.durationMs,
      attempt: details.attempt,
      toolCallId: details.toolCallID,
    },
  })
}

/** Handles arbitrary stderr chunk boundaries without forwarding raw stderr. */
export class AgentDiagnosticLineDecoder {
  private pending = ""

  push(chunk: string | Buffer): AgentDiagnostic[] {
    this.pending += chunk.toString()
    if (Buffer.byteLength(this.pending, "utf8") > MAX_PENDING_AGENT_LOG_BYTES) {
      this.pending = ""
      return []
    }
    const lines = this.pending.split(/\r?\n/)
    this.pending = lines.pop() ?? ""
    return lines.flatMap((line) => {
      const diagnostic = diagnosticFromAgentLogLine(line)
      return diagnostic ? [diagnostic] : []
    })
  }
}
