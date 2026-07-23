import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { AttachmentBinding, AttachmentCatalog, AttachmentRecord } from "./AttachmentService"

export class SqliteAttachmentCatalog implements AttachmentCatalog {
  constructor(private readonly db: AgentDatabase) {}

  async insertMany(records: readonly AttachmentRecord[]) {
    this.db.transaction(() => {
      for (const record of records) {
        this.db.sqlite.query("INSERT INTO input_attachments (id, thread_id, input_id, kind, name, media_type, size_bytes, sha256, storage_path, created_at, bound_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)").run(
          record.id, record.kind, record.name, record.mimeType, record.size, record.sha256, record.sha256, record.createdAt,
        )
      }
    })
  }

  async get(id: string) {
    return this.row(id)
  }

  async getMany(ids: readonly string[]) {
    return ids.flatMap((id) => { const value = this.row(id); return value ? [value] : [] })
  }

  async listByBinding(binding: AttachmentBinding) {
    if (binding.type !== "input") return []
    const rows = this.db.sqlite.query("SELECT id FROM input_attachments WHERE input_id = ? ORDER BY created_at, id").all(binding.id) as Array<{ id: string }>
    return rows.flatMap(({ id }) => { const value = this.row(id); return value ? [value] : [] })
  }

  async bindMany(ids: readonly string[], binding: AttachmentBinding) {
    if (binding.type !== "input") throw new AgentError("ATTACHMENT_BINDING_INVALID", "附件只能绑定到 input", 400)
    const input = this.db.sqlite.query("SELECT thread_id FROM inputs WHERE id = ?").get(binding.id) as { thread_id: string } | null
    if (!input) throw new AgentError("INPUT_NOT_FOUND", "附件目标 input 不存在", 404)
    this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db.sqlite.query("SELECT input_id FROM input_attachments WHERE id = ?").get(id) as { input_id: string | null } | null
        if (!row) throw new AgentError("ATTACHMENT_NOT_FOUND", "一个或多个附件不存在", 404)
        if (row.input_id && row.input_id !== binding.id) throw new AgentError("ATTACHMENT_ALREADY_BOUND", "附件已绑定到其他 input", 409)
        this.db.sqlite.query("UPDATE input_attachments SET thread_id = ?, input_id = ?, bound_at = COALESCE(bound_at, ?) WHERE id = ?").run(input.thread_id, binding.id, Date.now(), id)
      }
    })
  }

  async unbindMany(ids: readonly string[], binding: AttachmentBinding) {
    this.db.transaction(() => {
      for (const id of ids) {
        const changed = this.db.sqlite.query("UPDATE input_attachments SET thread_id = NULL, input_id = NULL, bound_at = NULL WHERE id = ? AND input_id = ?").run(id, binding.id)
        if (changed.changes !== 1) throw new AgentError("ATTACHMENT_BINDING_MISMATCH", "附件绑定对象不匹配", 409)
      }
    })
  }

  async removeMany(ids: readonly string[]) {
    this.db.transaction(() => { for (const id of ids) this.db.sqlite.query("DELETE FROM input_attachments WHERE id = ?").run(id) })
  }

  async removeOrphans(createdBefore: number, limit: number) {
    const ids = (this.db.sqlite.query("SELECT id FROM input_attachments WHERE input_id IS NULL AND created_at <= ? ORDER BY created_at, id LIMIT ?").all(createdBefore, limit) as Array<{ id: string }>).map(({ id }) => id)
    const records = await this.getMany(ids)
    await this.removeMany(ids)
    return records
  }

  async countBySha256(sha256: string) {
    return (this.db.sqlite.query("SELECT COUNT(*) AS count FROM input_attachments WHERE sha256 = ?").get(sha256) as { count: number }).count
  }

  private row(id: string): AttachmentRecord | null {
    const row = this.db.sqlite.query("SELECT id, input_id, kind, name, media_type, size_bytes, sha256, created_at FROM input_attachments WHERE id = ?").get(id) as Record<string, string | number | null> | null
    if (!row) return null
    return {
      id: String(row.id), kind: String(row.kind) as AttachmentRecord["kind"], name: String(row.name), mimeType: String(row.media_type),
      size: Number(row.size_bytes), sha256: String(row.sha256), createdAt: Number(row.created_at),
      binding: row.input_id == null ? null : { type: "input", id: String(row.input_id) },
    }
  }
}
