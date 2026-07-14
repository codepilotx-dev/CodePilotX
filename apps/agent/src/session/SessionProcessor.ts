import { Effect } from "effect"
import type { EventEnvelope, NormalizedLLMEvent, SessionPart } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"

const now = () => Date.now()

export class SessionProcessor {
  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub) {}

  private async publish(sessionID: string, type: string, payload: unknown) {
    const event = this.db.insertEvent(sessionID, type, payload)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  private async savePart(sessionID: string, part: SessionPart): Promise<EventEnvelope> {
    const event = this.db.transaction(() => {
      this.db.upsertPart(sessionID, part)
      return this.db.insertEvent(sessionID, "part.updated", part)
    })
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async consume(sessionID: string, runID: string, event: NormalizedLLMEvent) {
    const timestamp = now()
    switch (event.type) {
      case "reasoning-start":
        return this.savePart(sessionID, { id: event.id, runID, type: "reasoning", status: "running", data: { text: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "reasoning-delta":
      case "text-delta": {
        const existing = this.db.getPart(event.id)
        const type = event.type === "reasoning-delta" ? "reasoning" : "activity"
        return this.savePart(sessionID, {
          id: event.id,
          runID,
          type: existing?.type ?? type,
          status: "running",
          data: { ...(existing?.data ?? {}), text: `${typeof existing?.data.text === "string" ? existing.data.text : ""}${event.delta}` },
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        })
      }
      case "text-start":
        return this.savePart(sessionID, { id: event.id, runID, type: "activity", status: "running", data: { text: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "text-end":
      case "reasoning-end": {
        const existing = this.db.getPart(event.id)
        if (!existing) return
        return this.savePart(sessionID, { ...existing, status: "completed", updatedAt: timestamp })
      }
      case "tool-input-start":
        return this.savePart(sessionID, { id: event.id, runID, type: "tool", status: "pending", data: { toolName: event.toolName, inputText: "" }, createdAt: timestamp, updatedAt: timestamp })
      case "tool-input-delta": {
        const existing = this.db.getPart(event.id)
        if (!existing) return
        return this.savePart(sessionID, { ...existing, data: { ...existing.data, inputText: `${typeof existing.data.inputText === "string" ? existing.data.inputText : ""}${event.delta}` }, updatedAt: timestamp })
      }
      case "tool-call": {
        const existing = this.db.getPart(event.id)
        this.db.run(`INSERT INTO tool_calls (id, session_id, run_id, tool_name, input, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?) ON CONFLICT(id) DO UPDATE SET input = excluded.input, status = 'running', started_at = excluded.started_at`, event.id, sessionID, runID, event.toolName, JSON.stringify(event.input ?? null), timestamp)
        return this.savePart(sessionID, { id: event.id, runID, type: "tool", status: "running", data: { ...(existing?.data ?? {}), toolName: event.toolName, input: event.input }, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp })
      }
      case "tool-result": {
        const existing = this.db.getPart(event.id)
        this.db.run("UPDATE tool_calls SET output = ?, status = 'completed', finished_at = ? WHERE id = ?", JSON.stringify(event.output ?? null), timestamp, event.id)
        if (!existing) return
        return this.savePart(sessionID, { ...existing, status: "completed", data: { ...existing.data, output: event.output }, updatedAt: timestamp })
      }
      case "tool-error": {
        const existing = this.db.getPart(event.id)
        this.db.run("UPDATE tool_calls SET error = ?, status = 'error', finished_at = ? WHERE id = ?", event.error, timestamp, event.id)
        if (!existing) return
        return this.savePart(sessionID, { ...existing, status: "error", data: { ...existing.data, error: event.error }, updatedAt: timestamp })
      }
      case "step-start": return this.publish(sessionID, "run.step-started", { runID, stepID: event.id })
      case "step-finish": return this.publish(sessionID, "run.step-finished", { runID, stepID: event.id, finishReason: event.finishReason })
      case "provider-error": return this.publish(sessionID, "run.provider-error", { runID, message: event.message, retryable: event.retryable })
      case "finish": return this.publish(sessionID, "run.model-finished", { runID, finishReason: event.finishReason })
      case "tool-input-end": return
    }
  }

  async finalize(sessionID: string, runID: string) {
    const textRows = this.db.sqlite.query("SELECT id FROM parts WHERE run_id = ? AND type = 'activity' AND json_extract(data, '$.text') <> '' ORDER BY created_at").all(runID) as Array<{ id: string }>
    const final = textRows.at(-1)
    if (final) {
      const run = this.db.sqlite.query("SELECT mode FROM runs WHERE id = ?").get(runID) as { mode: string } | null
      const current = this.db.getPart(final.id)
      if (run?.mode === "plan" && current) {
        this.db.run("UPDATE parts SET type = 'plan', data = ?, updated_at = ? WHERE id = ?", JSON.stringify({ title: "实施计划", markdown: typeof current.data.text === "string" ? current.data.text : "" }), now(), final.id)
      } else {
        this.db.run("UPDATE parts SET type = 'text', updated_at = ? WHERE id = ?", now(), final.id)
      }
      const part = this.db.getPart(final.id)
      if (part) await this.publish(sessionID, "part.updated", part)
    }
  }
}
