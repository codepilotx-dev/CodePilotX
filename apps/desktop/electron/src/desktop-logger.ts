import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from "node:fs"
import { join } from "node:path"

const MAX_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const TERMINAL_INFO_EVENTS = new Set([
  "desktop.starting",
  "desktop.ready",
  "desktop.connection-state",
  "desktop.connection-recovered",
  "desktop.renderer-reused",
  "desktop.connection-lost",
  "sidecar.connected",
  "sidecar.invalidated",
  "sidecar.spawned",
  "sidecar.shutdown-request",
  "sidecar.watchdog-recovered",
])

export interface DesktopLogger {
  readonly directory: string
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

const redactString = (value: string): string => {
  const redacted = value
      .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
      .replace(/\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi, "$1=[REDACTED]")
  return redacted.length > 2_000 ? `${redacted.slice(0, 2_000)}…` : redacted
}

const serialize = (value: unknown) => {
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    }
  }
  if (typeof value === "string") return redactString(value)
  return value
}

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (value instanceof Error) return serialize(value)
  if (!value || typeof value !== "object") return serialize(value)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (/token|authorization|cookie|api[-_]?key|secret|password/i.test(key)) return [key, "[REDACTED]"]
    return [key, redact(item)]
  }))
}

function rotate(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size >= MAX_BYTES) {
      const oldest = `${path}.${MAX_FILES - 1}`
      if (existsSync(oldest)) unlinkSync(oldest)
      for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
        const source = `${path}.${index}`
        const target = `${path}.${index + 1}`
        if (existsSync(source)) renameSync(source, target)
      }
      renameSync(path, `${path}.1`)
    }
  } catch { /* logging must never prevent startup */ }
}

function cleanup(directory: string, path: string): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS
    for (const name of readdirSync(directory)) {
      if (!name.startsWith("desktop.log")) continue
      const candidate = join(directory, name)
      if (candidate !== path && statSync(candidate).mtimeMs < cutoff) unlinkSync(candidate)
    }
  } catch { /* logging must never prevent startup */ }
}

export function createDesktopLogger(directory: string): DesktopLogger {
  const path = join(directory, "desktop.log")
  try { mkdirSync(directory, { recursive: true }) } catch { /* logging must never prevent startup */ }
  cleanup(directory, path)
  const write = (level: string, event: string, fields: Record<string, unknown> = {}) => {
    try {
      rotate(path)
      const safeFields = redact(fields)
      const record = safeFields && typeof safeFields === "object" && !Array.isArray(safeFields) ? safeFields as Record<string, unknown> : { details: safeFields }
      const entry = { at: new Date().toISOString(), level, event, ...record }
      appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8")
      if (level === "error") console.error("[CodePilotX]", entry)
      else if (level === "warn") console.warn("[CodePilotX]", entry)
      else if (TERMINAL_INFO_EVENTS.has(event)) console.info("[CodePilotX]", entry)
    } catch { /* logging must never prevent startup */ }
  }
  return { directory, info: (event, fields) => write("info", event, fields), warn: (event, fields) => write("warn", event, fields), error: (event, fields) => write("error", event, fields) }
}
