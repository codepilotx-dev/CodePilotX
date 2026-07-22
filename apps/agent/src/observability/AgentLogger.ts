import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SENSITIVE_KEY = /authorization|token|api[-_]?key|password|secret|credential|cookie/i
const BEARER_VALUE = /\bBearer\s+[^\s,;"']+/gi
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]+\b/g

type LogValue = string | number | boolean | null | undefined | LogValue[] | { [key: string]: LogValue }

const sanitizeString = (value: string) => value
  .replace(BEARER_VALUE, "Bearer [REDACTED]")
  .replace(OPENAI_KEY, "[REDACTED]")
  .replace(/\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi, "$1=[REDACTED]")

const sanitize = (value: unknown, key?: string): LogValue => {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (typeof value === "string") return sanitizeString(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]))
  return String(value)
}

export class AgentLogger {
  private readonly activeFile: string

  constructor(private readonly directory: string) {
    this.activeFile = join(directory, "agent.jsonl")
    this.prepare()
  }

  info(event: string, details?: Record<string, unknown>) {
    this.write("info", event, details)
  }

  warn(event: string, details?: Record<string, unknown>) {
    this.write("warn", event, details)
  }

  error(event: string, details?: Record<string, unknown>) {
    this.write("error", event, details)
  }

  request(input: { method: string; path: string; status: number; durationMs: number }) {
    this.info("http.request", input)
  }

  private write(level: "info" | "warn" | "error", event: string, details?: Record<string, unknown>) {
    try {
      this.rotateIfNeeded()
      const record = { at: new Date().toISOString(), level, event, ...(details ? { details: sanitize(details) } : {}) }
      const line = `${JSON.stringify(record)}\n`
      appendFileSync(this.activeFile, line, "utf8")
      if (level !== "info" || event.startsWith("sandbox.worker.")) {
        process.stderr.write(`[CodePilotX Agent] ${JSON.stringify(record)}\n`)
      }
    } catch {
      // Observability must never take the local sidecar down.
    }
  }

  private prepare() {
    try {
      mkdirSync(this.directory, { recursive: true })
      this.pruneExpired()
    } catch {
      // The logger intentionally becomes a no-op when its directory is unavailable.
    }
  }

  private rotateIfNeeded() {
    this.prepare()
    if (!existsSync(this.activeFile) || statSync(this.activeFile).size < MAX_FILE_BYTES) return
    const oldest = join(this.directory, `agent.${MAX_FILES - 1}.jsonl`)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let index = MAX_FILES - 2; index >= 1; index -= 1) {
      const source = join(this.directory, `agent.${index}.jsonl`)
      if (existsSync(source)) renameSync(source, join(this.directory, `agent.${index + 1}.jsonl`))
    }
    renameSync(this.activeFile, join(this.directory, "agent.1.jsonl"))
  }

  private pruneExpired() {
    const threshold = Date.now() - MAX_AGE_MS
    for (const entry of readdirSync(this.directory)) {
      if (!/^agent(?:\.\d+)?\.jsonl$/.test(entry)) continue
      const path = join(this.directory, entry)
      if (statSync(path).mtimeMs < threshold) unlinkSync(path)
    }
  }
}
