import { createHash } from "node:crypto"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import { projectMemoryKey, type MemoryService } from "../memory/MemoryService"
import { secretScrubber } from "../security/SecretScrubber"

export class TaskContextPromotionService {
  private draining: Promise<void> | null = null
  constructor(private readonly db: AgentDatabase, private readonly memory: MemoryService) {}

  drain() {
    if (this.draining) return this.draining
    this.draining = (async () => {
      while (await this.processNext()) { /* drain durable jobs serially */ }
    })().finally(() => { this.draining = null })
    return this.draining
  }

  private async processNext() {
    const job = this.db.transaction(() => {
      const row = this.db.sqlite.query("SELECT id, task_id, context_revision FROM task_context_promotion_jobs WHERE status IN ('pending','retryable') ORDER BY created_at LIMIT 1").get() as { id: string; task_id: string; context_revision: number } | null
      if (!row) return null
      const timestamp = Date.now()
      const claimed = this.db.sqlite.query("UPDATE task_context_promotion_jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','retryable')").run(timestamp, timestamp, row.id)
      return claimed.changes ? row : null
    })
    if (!job) return false
    try {
      const task = this.db.sqlite.query("SELECT project_id, title FROM taskboard_tasks WHERE id = ?").get(job.task_id) as { project_id: string; title: string }
      const entries = this.db.sqlite.query("SELECT section, title, content FROM task_context_entries WHERE task_id = ? AND status = 'active' AND section IN ('objective','decision','risk','code_map','validation','finding') ORDER BY section, updated_at, id").all(job.task_id) as Array<{ section: string; title: string; content: string }>
      const content = [`任务：${task.title}`, ...entries.map(entry => `[${entry.section}] ${entry.title}：${entry.content}`)].join("\n").slice(0, 2_000)
      const previous = this.db.sqlite.query("SELECT id, memory_entry_id FROM task_context_memory_promotions WHERE task_id = ? AND completed_at IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(job.task_id) as { id: string; memory_entry_id: string | null } | null
      const saved = this.memory.remember({ ...(previous?.memory_entry_id ? { id: previous.memory_entry_id } : {}), scope: "project", projectKey: projectMemoryKey(task.project_id), content })
      if (!saved) throw new Error("项目记忆未启用或内容未通过安全检查")
      const timestamp = Date.now()
      this.db.transaction(() => {
        const promotionId = crypto.randomUUID()
        this.db.sqlite.query("INSERT INTO task_context_memory_promotions (id, task_id, context_revision, memory_entry_id, content, content_hash, supersedes_promotion_id, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(promotionId, job.task_id, job.context_revision, saved.id, content, createHash("sha256").update(content).digest("hex"), previous?.id ?? null, timestamp, timestamp)
        this.db.sqlite.query("UPDATE task_context_promotion_jobs SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, job.id)
        this.db.sqlite.query("UPDATE task_context_state SET promoted_context_revision = ?, updated_at = ? WHERE task_id = ?").run(job.context_revision, timestamp, job.task_id)
      })
    } catch (cause) {
      const timestamp = Date.now()
      const error = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)).slice(0, 1_000)
      this.db.sqlite.query("UPDATE task_context_promotion_jobs SET status = 'retryable', error = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(error, timestamp, timestamp, job.id)
      return false
    }
    return true
  }
}
