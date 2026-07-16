import type { AgentInputItem, Session } from "@openai/agents"
import type { AgentDatabase } from "./Database"

export const isUserSessionItem = (item: AgentInputItem | Record<string, unknown>) => {
  const value = item as unknown as Record<string, unknown>
  return value.role === "user" || value.type === "message" && value.role === "user"
}

/** Returns logical user-round starts; consecutive contextual/user input items belong to one round. */
export const userRoundStarts = (items: readonly AgentInputItem[]) => items.flatMap((item, index) =>
  isUserSessionItem(item) && (index === 0 || !isUserSessionItem(items[index - 1]!)) ? [index] : [],
)

/** Durable Agents SDK history backed by the local SQLite sidecar database. */
export class SqliteAgentSession implements Session {
  constructor(
    private readonly db: AgentDatabase,
    private readonly sessionID: string,
  ) {}

  async getSessionId() {
    return this.sessionID
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const rows = limit === undefined
      ? this.db.sqlite.query("SELECT payload FROM agent_thread_items WHERE thread_id = ? ORDER BY ordinal").all(this.sessionID) as Array<{ payload: string }>
      : (this.db.sqlite.query("SELECT payload FROM (SELECT payload, ordinal FROM agent_thread_items WHERE thread_id = ? ORDER BY ordinal DESC LIMIT ?) ORDER BY ordinal").all(this.sessionID, limit) as Array<{ payload: string }>)
    return rows.map((row) => JSON.parse(row.payload) as AgentInputItem)
  }

  async addItems(items: AgentInputItem[]) {
    if (!items.length) return
    const timestamp = Date.now()
    this.db.transaction(() => {
      const row = this.db.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM agent_thread_items WHERE thread_id = ?").get(this.sessionID) as { ordinal: number }
      const insert = this.db.sqlite.query("INSERT INTO agent_thread_items (thread_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)")
      items.forEach((item, index) => insert.run(this.sessionID, row.ordinal + index + 1, JSON.stringify(item), timestamp))
    })
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.db.transaction(() => {
      const row = this.db.sqlite.query("SELECT ordinal, payload FROM agent_thread_items WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1").get(this.sessionID) as { ordinal: number; payload: string } | null
      if (!row) return undefined
      this.db.sqlite.query("DELETE FROM agent_thread_items WHERE thread_id = ? AND ordinal = ?").run(this.sessionID, row.ordinal)
      return JSON.parse(row.payload) as AgentInputItem
    })
  }

  async clearSession() {
    this.db.sqlite.query("DELETE FROM agent_thread_items WHERE thread_id = ?").run(this.sessionID)
  }

  async countItems() {
    const row = this.db.sqlite.query("SELECT COUNT(*) AS count FROM agent_thread_items WHERE thread_id = ?").get(this.sessionID) as { count: number }
    return row.count
  }

  /** Returns the first ordinal that may be appended by the next model attempt. */
  async nextOrdinal() {
    const row = this.db.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM agent_thread_items WHERE thread_id = ?").get(this.sessionID) as { ordinal: number }
    return row.ordinal
  }

  /** Removes only history appended by the current model attempt. */
  async rollbackFromOrdinal(ordinal: number) {
    if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error("session rollback ordinal 无效")
    return this.db.transaction(() => {
      const result = this.db.sqlite.query("DELETE FROM agent_thread_items WHERE thread_id = ? AND ordinal >= ?").run(this.sessionID, ordinal)
      return result.changes
    })
  }

  /** Atomically replaces model history. Used only after a compaction result is complete. */
  async replaceItems(items: AgentInputItem[]) {
    const timestamp = Date.now()
    this.db.transaction(() => {
      this.db.sqlite.query("DELETE FROM agent_thread_items WHERE thread_id = ?").run(this.sessionID)
      const insert = this.db.sqlite.query("INSERT INTO agent_thread_items (thread_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)")
      items.forEach((item, ordinal) => insert.run(this.sessionID, ordinal, JSON.stringify(item), timestamp))
    })
  }

  /** Drops one oldest complete conversational round, never a partial tail. */
  async dropOldestRound() {
    return this.db.transaction(() => {
      const rows = this.db.sqlite.query("SELECT ordinal, payload FROM agent_thread_items WHERE thread_id = ? ORDER BY ordinal").all(this.sessionID) as Array<{ ordinal: number; payload: string }>
      if (!rows.length) return 0
      const items = rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>)
      const start = items.findIndex(isUserSessionItem)
      if (start < 0) return 0
      let sawResponse = false
      let end = -1
      for (let index = start + 1; index < items.length; index += 1) {
        if (isUserSessionItem(items[index]!)) {
          if (sawResponse) { end = index; break }
        } else sawResponse = true
      }
      // One or more contextual/user inputs without a response form a dangling round.
      if (!sawResponse) return 0
      if (end < 0) end = items.length
      const ordinals = rows.slice(start, end).map((row) => row.ordinal)
      const placeholders = ordinals.map(() => "?").join(",")
      this.db.sqlite.query(`DELETE FROM agent_thread_items WHERE thread_id = ? AND ordinal IN (${placeholders})`).run(this.sessionID, ...ordinals)
      return ordinals.length
    })
  }
}
