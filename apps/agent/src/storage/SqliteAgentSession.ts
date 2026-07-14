import type { AgentInputItem, Session } from "@openai/agents"
import type { AgentDatabase } from "./Database"

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
      ? this.db.sqlite.query("SELECT payload FROM agent_session_items WHERE session_id = ? ORDER BY ordinal").all(this.sessionID) as Array<{ payload: string }>
      : (this.db.sqlite.query("SELECT payload FROM (SELECT payload, ordinal FROM agent_session_items WHERE session_id = ? ORDER BY ordinal DESC LIMIT ?) ORDER BY ordinal").all(this.sessionID, limit) as Array<{ payload: string }>)
    return rows.map((row) => JSON.parse(row.payload) as AgentInputItem)
  }

  async addItems(items: AgentInputItem[]) {
    if (!items.length) return
    const timestamp = Date.now()
    this.db.transaction(() => {
      const row = this.db.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM agent_session_items WHERE session_id = ?").get(this.sessionID) as { ordinal: number }
      const insert = this.db.sqlite.query("INSERT INTO agent_session_items (session_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)")
      items.forEach((item, index) => insert.run(this.sessionID, row.ordinal + index + 1, JSON.stringify(item), timestamp))
    })
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.db.transaction(() => {
      const row = this.db.sqlite.query("SELECT ordinal, payload FROM agent_session_items WHERE session_id = ? ORDER BY ordinal DESC LIMIT 1").get(this.sessionID) as { ordinal: number; payload: string } | null
      if (!row) return undefined
      this.db.sqlite.query("DELETE FROM agent_session_items WHERE session_id = ? AND ordinal = ?").run(this.sessionID, row.ordinal)
      return JSON.parse(row.payload) as AgentInputItem
    })
  }

  async clearSession() {
    this.db.sqlite.query("DELETE FROM agent_session_items WHERE session_id = ?").run(this.sessionID)
  }
}
