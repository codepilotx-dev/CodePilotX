import { Buffer } from "node:buffer"
import { Effect } from "effect"
import type { Message, Part, RunStatus, SessionListItem } from "@codepilotx/shared"
import { AgentError, type SessionPart } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import { Projection } from "../transport/Projection"

type SessionCursor = {
  sort: "updatedAt" | "createdAt"
  value: number
  id: string
}

type MessageCursor = {
  ordinal: number
  id: string
}

export type ListSessionsParams = {
  projectID?: string
  archived?: boolean
  search?: string
  cursor?: string
  limit?: number
  sort?: "updatedAt" | "createdAt"
}

export type SessionMetadataPatch = {
  title?: string | null
  archived?: boolean
}

export type ListSessionMessagesParams = {
  cursor?: string
  limit?: number
}

const clampLimit = (value: number | undefined, fallback: number, max: number) => {
  if (!Number.isFinite(value ?? NaN)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value!)))
}

const encodeCursor = (value: SessionCursor | MessageCursor) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")

const decodeCursor = <T>(value: string | undefined, label: string): T | null => {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T
  } catch {
    throw new AgentError("INVALID_CURSOR", `${label} cursor 无效`, 400)
  }
}

const runStatus = (status: string | null): RunStatus | null => {
  if (!status) return null
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_plan_confirmation") return "waiting-plan-confirmation"
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "interrupted") return status
  return "stopped"
}

const likePattern = (value: string) => `%${value.trim()}%`

type SessionRow = {
  id: string
  project_id: string | null
  title: string
  preview: string | null
  first_user_message: string | null
  message_count: number
  latest_run_status: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

export class SessionHistoryService {
  private readonly projection: Projection

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
  ) {
    this.projection = new Projection(db)
  }

  list(params: ListSessionsParams = {}) {
    const limit = clampLimit(params.limit, 50, 100)
    const sort = params.sort === "createdAt" ? "createdAt" : "updatedAt"
    const sortColumn = sort === "createdAt" ? "created_at" : "updated_at"
    const cursor = decodeCursor<SessionCursor>(params.cursor, "sessions")
    const where: string[] = [params.archived ? "s.archived_at IS NOT NULL" : "s.archived_at IS NULL"]
    const values: Array<string | number | null> = []

    if (params.projectID) {
      where.push("s.project_id = ?")
      values.push(params.projectID)
    }
    if (params.search?.trim()) {
      const pattern = likePattern(params.search)
      where.push(`(
        s.title LIKE ? COLLATE NOCASE
        OR s.preview LIKE ? COLLATE NOCASE
        OR s.first_user_message LIKE ? COLLATE NOCASE
        OR EXISTS (SELECT 1 FROM messages AS m WHERE m.session_id = s.id AND m.content LIKE ? COLLATE NOCASE)
      )`)
      values.push(pattern, pattern, pattern, pattern)
    }
    if (cursor) {
      if (cursor.sort !== sort || typeof cursor.value !== "number" || typeof cursor.id !== "string") throw new AgentError("INVALID_CURSOR", "sessions cursor 与排序不匹配", 400)
      where.push(`(s.${sortColumn} < ? OR (s.${sortColumn} = ? AND s.id < ?))`)
      values.push(cursor.value, cursor.value, cursor.id)
    }

    const rows = this.db.sqlite.query(`
      SELECT s.id, s.project_id, s.title, s.preview, s.first_user_message, s.message_count, s.archived_at, s.created_at, s.updated_at,
        (SELECT r.status FROM runs AS r WHERE r.session_id = s.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_status
      FROM sessions AS s
      WHERE ${where.join(" AND ")}
      ORDER BY s.${sortColumn} DESC, s.id DESC
      LIMIT ?
    `).all(...values, limit + 1) as SessionRow[]

    const page = rows.slice(0, limit).map((row) => this.session(row))
    const last = page.at(-1)
    return {
      sessions: page,
      nextCursor: rows.length > limit && last ? encodeCursor({ sort, value: sort === "createdAt" ? last.createdAt : last.updatedAt, id: last.id }) : null,
    }
  }

  getListItem(sessionID: string) {
    const row = this.db.sqlite.query(`
      SELECT s.id, s.project_id, s.title, s.preview, s.first_user_message, s.message_count, s.archived_at, s.created_at, s.updated_at,
        (SELECT r.status FROM runs AS r WHERE r.session_id = s.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_run_status
      FROM sessions AS s
      WHERE s.id = ?
    `).get(sessionID) as SessionRow | null
    return row ? this.session(row) : null
  }

  async patch(sessionID: string, patch: SessionMetadataPatch) {
    const existing = this.getListItem(sessionID)
    if (!existing) throw new AgentError("SESSION_NOT_FOUND", "会话不存在", 404)

    const updates: string[] = []
    const values: Array<string | number | null> = []
    const timestamp = Date.now()
    if ("title" in patch) {
      const title = patch.title === null ? existing.firstUserMessage?.trim() || "新对话" : patch.title?.trim()
      if (!title) throw new AgentError("INVALID_REQUEST", "title 参数无效", 400)
      updates.push("title = ?")
      values.push(title)
    }
    if (typeof patch.archived === "boolean") {
      updates.push("archived_at = ?")
      values.push(patch.archived ? timestamp : null)
    }
    if (!updates.length) return existing

    updates.push("updated_at = ?")
    values.push(timestamp)
    values.push(sessionID)
    this.db.sqlite.query(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values)
    const next = this.getListItem(sessionID)
    if (!next) throw new AgentError("SESSION_NOT_FOUND", "会话不存在", 404)
    const event = this.db.insertEvent(sessionID, "session.updated", { id: sessionID, patch, updatedAt: timestamp })
    await Effect.runPromise(this.hub.publish(event))
    return next
  }

  async remove(sessionID: string) {
    const existing = this.getListItem(sessionID)
    if (!existing) throw new AgentError("SESSION_NOT_FOUND", "会话不存在", 404)
    if (this.db.activeRun(sessionID)) throw new AgentError("SESSION_ACTIVE", "运行中的会话不能删除", 409)
    const event = this.db.transaction(() => {
      this.db.sqlite.query("DELETE FROM sessions WHERE id = ?").run(sessionID)
      return this.db.insertEvent(null, "session.deleted", { id: sessionID, deletedAt: Date.now() })
    })
    await Effect.runPromise(this.hub.publish(event))
  }

  listMessages(sessionID: string, params: ListSessionMessagesParams = {}) {
    if (!this.getListItem(sessionID)) throw new AgentError("SESSION_NOT_FOUND", "会话不存在", 404)
    const limit = clampLimit(params.limit, 50, 200)
    const cursor = decodeCursor<MessageCursor>(params.cursor, "messages")
    const values: Array<string | number> = [sessionID]
    const cursorClause = cursor ? "AND (ordinal > ? OR (ordinal = ? AND id > ?))" : ""
    if (cursor) {
      if (typeof cursor.ordinal !== "number" || typeof cursor.id !== "string") throw new AgentError("INVALID_CURSOR", "messages cursor 无效", 400)
      values.push(cursor.ordinal, cursor.ordinal, cursor.id)
    }
    const rows = this.db.sqlite.query(`
      SELECT id, session_id, run_id, role, created_at, ordinal
      FROM messages
      WHERE session_id = ? ${cursorClause}
      ORDER BY ordinal, id
      LIMIT ?
    `).all(...values, limit + 1) as Array<{ id: string; session_id: string; run_id: string | null; role: Message["role"]; created_at: number; ordinal: number }>

    const pageRows = rows.slice(0, limit)
    const messages = pageRows.map((row): Message => ({
      id: row.id,
      sessionID: row.session_id,
      runID: row.run_id,
      role: row.role,
      createdAt: row.created_at,
    }))
    const runIDs = Array.from(new Set(pageRows.flatMap((row) => row.run_id ? [row.run_id] : [])))
    const parts = this.partsForRuns(runIDs)
    const last = pageRows.at(-1)
    return {
      messages,
      parts,
      nextCursor: rows.length > limit && last ? encodeCursor({ ordinal: last.ordinal, id: last.id }) : null,
    }
  }

  private session(row: SessionRow): SessionListItem {
    return {
      id: row.id,
      projectID: row.project_id,
      title: row.title,
      preview: row.preview,
      firstUserMessage: row.first_user_message,
      messageCount: row.message_count,
      latestRunStatus: runStatus(row.latest_run_status),
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private partsForRuns(runIDs: string[]): Part[] {
    if (!runIDs.length) return []
    const placeholders = runIDs.map(() => "?").join(",")
    const rows = this.db.sqlite.query(`
      SELECT id, run_id, type, status, data, created_at, updated_at
      FROM parts
      WHERE run_id IN (${placeholders})
      ORDER BY created_at, id
    `).all(...runIDs) as Array<{ id: string; run_id: string; type: string; status: string; data: string; created_at: number; updated_at: number }>
    return rows.flatMap((row) => {
      const part = this.projection.part({
        id: row.id,
        runID: row.run_id,
        type: row.type as SessionPart["type"],
        status: row.status as SessionPart["status"],
        data: JSON.parse(row.data) as Record<string, unknown>,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      return part ? [part] : []
    })
  }
}
