import { Effect } from "effect"
import type { EventEnvelope, Item, NormalizedLLMEvent } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"

const now = () => Date.now()

export class ThreadProcessor {
  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub) {}

  private async publish(threadID: string, turnID: string, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  private async saveItem(threadID: string, item: Item): Promise<EventEnvelope> {
    const event = this.db.transaction(() => {
      this.db.upsertItem(threadID, item)
      const method = item.status === "pending" || item.status === "running" ? "item/started" : "item/completed"
      return this.db.insertEvent(threadID, item.turnID, method, { item })
    })
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async consume(threadID: string, turnID: string, event: NormalizedLLMEvent) {
    const timestamp = now()
    switch (event.type) {
      case "reasoning-start":
        return this.saveItem(threadID, { id: event.id, turnID, type: "reasoning", status: "running", data: { text: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "reasoning-delta":
      case "text-delta": {
        const existing = this.db.getItem(event.id)
        const type = event.type === "reasoning-delta" ? "reasoning" : "activity"
        return this.saveItem(threadID, {
          id: event.id,
          turnID,
          type: existing?.type ?? type,
          status: "running",
          data: { ...(existing?.data ?? {}), text: `${typeof existing?.data.text === "string" ? existing.data.text : ""}${event.delta}` },
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        })
      }
      case "text-start":
        return this.saveItem(threadID, { id: event.id, turnID, type: "activity", status: "running", data: { text: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "text-end":
      case "reasoning-end": {
        const existing = this.db.getItem(event.id)
        if (!existing) return
        return this.saveItem(threadID, { ...existing, status: "completed", updatedAt: timestamp })
      }
      case "tool-input-start":
        return this.saveItem(threadID, { id: event.id, turnID, type: "tool", status: "pending", data: { toolName: event.toolName, inputText: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "tool-input-delta": {
        const existing = this.db.getItem(event.id)
        if (!existing) return
        return this.saveItem(threadID, { ...existing, data: { ...existing.data, inputText: `${typeof existing.data.inputText === "string" ? existing.data.inputText : ""}${event.delta}` }, updatedAt: timestamp })
      }
      case "tool-call": {
        const existing = this.db.getItem(event.id)
        this.db.run(`INSERT INTO tool_calls (id, thread_id, turn_id, tool_name, input, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?) ON CONFLICT(id) DO UPDATE SET input = excluded.input, status = 'running', started_at = excluded.started_at`, event.id, threadID, turnID, event.toolName, JSON.stringify(event.input ?? null), timestamp)
        return this.saveItem(threadID, { id: event.id, turnID, type: "tool", status: "running", data: { ...(existing?.data ?? {}), toolName: event.toolName, input: event.input }, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp })
      }
      case "tool-result": {
        const existing = this.db.getItem(event.id)
        this.db.run("UPDATE tool_calls SET output = ?, status = 'completed', finished_at = ? WHERE id = ?", JSON.stringify(event.output ?? null), timestamp, event.id)
        if (!existing) return
        return this.saveItem(threadID, { ...existing, status: "completed", data: { ...existing.data, output: event.output }, updatedAt: timestamp })
      }
      case "tool-error": {
        const existing = this.db.getItem(event.id)
        this.db.run("UPDATE tool_calls SET error = ?, status = 'error', finished_at = ? WHERE id = ?", event.error, timestamp, event.id)
        if (!existing) return
        return this.saveItem(threadID, { ...existing, status: "error", data: { ...existing.data, error: event.error }, updatedAt: timestamp })
      }
      case "step-start": return this.publish(threadID, turnID, "turn/statusChanged", { turnId: turnID, stepID: event.id, state: "step-started" })
      case "step-finish": return this.publish(threadID, turnID, "turn/statusChanged", { turnId: turnID, stepID: event.id, state: "step-finished", finishReason: event.finishReason })
      case "provider-error": return this.publish(threadID, turnID, "turn/statusChanged", { turnId: turnID, state: "provider-error", message: event.message, retryable: event.retryable })
      case "finish": return this.publish(threadID, turnID, "turn/statusChanged", { turnId: turnID, state: "model-finished", finishReason: event.finishReason })
      case "tool-input-end": return
    }
  }

  async finalize(threadID: string, turnID: string) {
    const textRows = this.db.sqlite.query("SELECT id FROM items WHERE turn_id = ? AND type = 'activity' AND json_extract(data, '$.text') <> '' ORDER BY created_at").all(turnID) as Array<{ id: string }>
    const final = textRows.at(-1)
    if (final) {
      const turn = this.db.sqlite.query("SELECT mode FROM turns WHERE id = ?").get(turnID) as { mode: string } | null
      const current = this.db.getItem(final.id)
      if (turn?.mode === "plan" && current) {
        this.db.run("UPDATE items SET type = 'plan', data = ?, updated_at = ? WHERE id = ?", JSON.stringify({ title: "实施计划", markdown: typeof current.data.text === "string" ? current.data.text : "" }), now(), final.id)
      } else {
        this.db.run("UPDATE items SET type = 'text', updated_at = ? WHERE id = ?", now(), final.id)
      }
      const item = this.db.getItem(final.id)
      if (item) await this.publish(threadID, turnID, "item/completed", { item })
    }
  }
}
