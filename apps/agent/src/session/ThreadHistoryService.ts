import { Effect } from "effect"
import type { ThreadListItem, ThreadSettingsPatch } from "@codepilotx/shared/thread"
import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"

export type ThreadMetadataPatch = {
  title?: string | null
  archived?: boolean
}

type ThreadRow = {
  id: string
  project_id: string | null
  title: string
  preview: string | null
  first_user_message: string | null
  message_count: number
  latest_turn_status: string | null
  archived_at: number | null
  task_mode: ThreadListItem["settings"]["taskMode"]
  sandbox_mode: ThreadListItem["settings"]["permissionConfig"]["sandboxMode"]
  approval_policy: ThreadListItem["settings"]["permissionConfig"]["approvalPolicy"]
  approvals_reviewer: ThreadListItem["settings"]["permissionConfig"]["approvalsReviewer"]
  created_at: number
  updated_at: number
}

const turnStatus = (status: string | null): ThreadListItem["latestTurnStatus"] => {
  if (!status) return null
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_plan_confirmation") return "waiting-plan-confirmation"
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "interrupted") return status
  return "stopped"
}

export class ThreadHistoryService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
  ) {}

  getListItem(threadID: string): ThreadListItem | null {
    const row = this.db.sqlite.query(`
      SELECT t.id, t.project_id, t.title, t.preview, t.first_user_message, t.message_count, t.archived_at,
        t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer, t.created_at, t.updated_at,
        (SELECT u.status FROM turns AS u WHERE u.thread_id = t.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latest_turn_status
      FROM threads AS t
      WHERE t.id = ?
    `).get(threadID) as ThreadRow | null
    return row ? {
      id: row.id,
      projectID: row.project_id,
      title: row.title,
      preview: row.preview,
      firstUserMessage: row.first_user_message,
      messageCount: row.message_count,
      latestTurnStatus: turnStatus(row.latest_turn_status),
      archivedAt: row.archived_at,
      settings: {
        taskMode: row.task_mode,
        permissionConfig: {
          sandboxMode: row.sandbox_mode,
          approvalPolicy: row.approval_policy,
          approvalsReviewer: row.approvals_reviewer,
        },
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null
  }

  async patch(threadID: string, patch: ThreadMetadataPatch) {
    const existing = this.getListItem(threadID)
    if (!existing) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)

    const updates: string[] = []
    const values: Array<string | number | null> = []
    const updatedAt = Date.now()
    if ("title" in patch) {
      const title = patch.title === null ? existing.firstUserMessage?.trim() || "新对话" : patch.title?.trim()
      if (!title) throw new AgentError("INVALID_REQUEST", "title 参数无效", 400)
      updates.push("title = ?")
      values.push(title)
    }
    if (typeof patch.archived === "boolean") {
      updates.push("archived_at = ?")
      values.push(patch.archived ? updatedAt : null)
    }
    if (!updates.length) return existing

    updates.push("updated_at = ?")
    values.push(updatedAt, threadID)
    this.db.sqlite.query(`UPDATE threads SET ${updates.join(", ")} WHERE id = ?`).run(...values)
    const next = this.getListItem(threadID)
    if (!next) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    const event = this.db.insertEvent(threadID, null, "thread/updated", { threadId: threadID, patch, updatedAt })
    await Effect.runPromise(this.hub.publish(event))
    return next
  }

  async patchSettings(threadID: string, patch: ThreadSettingsPatch) {
    if (!this.getListItem(threadID)) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    const result = this.db.updateThreadSettings(threadID, patch)
    if (result.event) await Effect.runPromise(this.hub.publish(result.event))
    return { threadId: threadID, settings: result.settings }
  }

  async remove(threadID: string) {
    const existing = this.getListItem(threadID)
    if (!existing) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    if (this.db.activeTurn(threadID)) throw new AgentError("THREAD_ACTIVE", "运行中的 Thread 不能删除", 409)
    const event = this.db.transaction(() => {
      this.db.sqlite.query("DELETE FROM threads WHERE id = ?").run(threadID)
      return this.db.insertEvent(null, null, "thread/deleted", { threadId: threadID, deletedAt: Date.now() })
    })
    await Effect.runPromise(this.hub.publish(event))
  }
}
