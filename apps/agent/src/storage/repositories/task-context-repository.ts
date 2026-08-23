import type {
  TaskContextChange,
  TaskContextEntry,
  TaskContextEvidence,
  TaskContextSection,
  TaskContextSnapshot,
  TaskContextSourceKind,
  TaskContextProposal,
} from "@codepilotx/shared/taskboard"
import {
  TASK_CONTEXT_CONTENT_MAX_LENGTH,
  TASK_CONTEXT_DIGEST_MAX_LENGTH,
  TASK_CONTEXT_PUBLISH_MAX_CHANGES,
  TASK_CONTEXT_TITLE_MAX_LENGTH,
} from "@codepilotx/shared/taskboard"
import { AgentError, type EventEnvelope } from "../../domain"
import type { AgentDatabase } from "../database/AgentDatabase"
import type { EventHub } from "../events/EventHub"
import { Effect } from "effect"
import { secretScrubber } from "../../security/SecretScrubber"

type StateRow = { task_id: string; evidence_revision: number; context_revision: number; summarized_through_evidence_revision: number; frozen_at: number | null; promoted_context_revision: number | null; created_at: number; updated_at: number }
type EntryRow = { id: string; task_id: string; section: TaskContextSection; title: string; content: string; status: TaskContextEntry["status"]; version: number; source_kind: TaskContextSourceKind; source_thread_id: string | null; source_turn_id: string | null; supersedes_entry_id: string | null; created_at: number; updated_at: number }
type EvidenceRow = { id: string; task_id: string; revision: number; source_kind: TaskContextEvidence["sourceKind"]; source_id: string; source_thread_id: string | null; source_turn_id: string | null; verified: number; summary: string; created_at: number }

const sections: readonly TaskContextSection[] = ["objective", "decision", "risk", "progress", "code_map", "validation", "finding"]
const entry = (row: EntryRow): TaskContextEntry => ({ id: row.id, taskId: row.task_id, section: row.section, title: row.title, content: row.content, status: row.status, version: row.version, sourceKind: row.source_kind, sourceThreadId: row.source_thread_id, sourceTurnId: row.source_turn_id, supersedesEntryId: row.supersedes_entry_id, createdAt: row.created_at, updatedAt: row.updated_at })
const evidence = (row: EvidenceRow): TaskContextEvidence => ({ id: row.id, taskId: row.task_id, revision: row.revision, sourceKind: row.source_kind, sourceId: row.source_id, sourceThreadId: row.source_thread_id, sourceTurnId: row.source_turn_id, verified: row.verified === 1, summary: row.summary, createdAt: row.created_at })

export class TaskContextRepository {
  private promotionDrain?: () => void
  constructor(private readonly db: AgentDatabase, private readonly hub?: EventHub, private readonly now: () => number = Date.now) {}

  async broadcast(event: EventEnvelope) {
    if (this.hub) await Effect.runPromise(this.hub.publish(event))
  }

  setPromotionDrain(drain: () => void) { this.promotionDrain = drain }

  resolveTaskForThread(threadId: string): { taskId: string; projectId: string } | null {
    let current: string | null = threadId
    for (let depth = 0; current && depth < 8; depth += 1) {
      const direct = this.db.sqlite.query(`SELECT l.task_id, t.project_id FROM taskboard_task_threads l JOIN taskboard_tasks t ON t.id = l.task_id WHERE l.thread_id = ?`).get(current) as { task_id: string; project_id: string } | null
      if (direct) return { taskId: direct.task_id, projectId: direct.project_id }
      const thread = this.db.sqlite.query("SELECT kind, parent_thread_id FROM threads WHERE id = ?").get(current) as { kind: string; parent_thread_id: string | null } | null
      if (!thread || thread.kind !== "subagent") return null
      current = thread.parent_thread_id
    }
    return null
  }

  read(taskId: string, input: { sections?: TaskContextSection[]; includeEvidence?: boolean; includeUnverified?: boolean; limit?: number; offset?: number } = {}) {
    this.ensureState(taskId)
    const wanted = input.sections?.length ? input.sections : [...sections]
    const limit = Math.max(1, Math.min(200, input.limit ?? 100))
    const placeholders = wanted.map(() => "?").join(",")
    const entries = (this.db.sqlite.query(`SELECT * FROM task_context_entries WHERE task_id = ? AND status = 'active' AND section IN (${placeholders}) ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).all(taskId, ...wanted, limit, Math.max(0, input.offset ?? 0)) as EntryRow[]).map(entry)
    const values = input.includeEvidence
      ? (this.db.sqlite.query(`SELECT * FROM task_context_evidence WHERE task_id = ? AND revision > (SELECT summarized_through_evidence_revision FROM task_context_state WHERE task_id = ?) ${input.includeUnverified ? "" : "AND verified = 1"} ORDER BY revision LIMIT ?`).all(taskId, taskId, limit) as EvidenceRow[]).map(evidence)
      : []
    return { snapshot: this.snapshot(taskId), entries, evidence: values }
  }

  readForThread(threadId: string, input: Parameters<TaskContextRepository["read"]>[1] = {}) {
    const owner = this.resolveTaskForThread(threadId)
    if (!owner) throw new AgentError("TASKBOARD_CONTEXT_REQUIRED", "当前会话未关联任务上下文", 403)
    return this.read(owner.taskId, input)
  }

  publish(input: { taskId: string; expectedContextRevision: number; changes: TaskContextChange[]; sourceKind: TaskContextSourceKind; sourceThreadId?: string; sourceTurnId?: string }) {
    if (!input.changes.length || input.changes.length > TASK_CONTEXT_PUBLISH_MAX_CHANGES) throw new AgentError("INVALID_REQUEST", "任务上下文单次只能包含 1 到 10 个变更", 400)
    const result = this.db.transaction(() => {
      const state = this.ensureState(input.taskId)
      if (state.frozen_at !== null) throw new AgentError("TASKBOARD_CONTEXT_FROZEN", "任务上下文已冻结", 409)
      if (state.context_revision !== input.expectedContextRevision) throw new AgentError("TASKBOARD_CONTEXT_REVISION_CONFLICT", "任务上下文版本已变化", 409)
      const timestamp = this.now()
      for (const change of input.changes) this.applyChange(input.taskId, change, input.sourceKind, input.sourceThreadId ?? null, input.sourceTurnId ?? null, timestamp)
      this.db.sqlite.query("UPDATE task_context_state SET context_revision = context_revision + 1, updated_at = ? WHERE task_id = ?").run(timestamp, input.taskId)
      const snapshot = this.snapshot(input.taskId)
      return { snapshot, event: this.changedEvent(input.taskId, snapshot, timestamp) }
    })
    return result
  }

  captureEvidence(input: { threadId: string; turnId: string; sourceKind?: "turn" | "subagent" | "thread" | "task"; sourceId?: string; verified: boolean; summary: string }) {
    const owner = this.resolveTaskForThread(input.threadId)
    if (!owner) return null
    const summary = this.safeEvidenceSummary(owner.projectId, input.summary)
    if (!summary) return null
    return this.db.transaction(() => {
      const state = this.ensureState(owner.taskId)
      const sourceKind = input.sourceKind ?? "turn"
      const sourceId = input.sourceId ?? input.turnId
      const known = this.db.sqlite.query("SELECT id FROM task_context_evidence WHERE task_id = ? AND source_kind = ? AND source_id = ?").get(owner.taskId, sourceKind, sourceId)
      if (known) return null
      const timestamp = this.now()
      const revision = state.evidence_revision + 1
      this.db.sqlite.query("INSERT INTO task_context_evidence (id, task_id, revision, source_kind, source_id, source_thread_id, source_turn_id, verified, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), owner.taskId, revision, sourceKind, sourceId, input.threadId, input.turnId, input.verified ? 1 : 0, summary, timestamp)
      this.db.sqlite.query("UPDATE task_context_state SET evidence_revision = ?, updated_at = ? WHERE task_id = ?").run(revision, timestamp, owner.taskId)
      const snapshot = this.snapshot(owner.taskId)
      return { snapshot, event: this.changedEvent(owner.taskId, snapshot, timestamp) }
    })
  }

  async captureAndBroadcast(input: Parameters<TaskContextRepository["captureEvidence"]>[0]) {
    const result = this.captureEvidence(input)
    if (result) await this.broadcast(result.event)
    return result?.snapshot ?? null
  }

  async backfillThread(threadId: string) {
    const turns = this.db.sqlite.query("SELECT id, status FROM turns WHERE thread_id = ? AND status IN ('completed','failed','interrupted','stopped') ORDER BY created_at, id").all(threadId) as Array<{ id: string; status: string }>
    for (const turn of turns) {
      let summary = "Turn 未成功完成；只保留可能已经发生的副作用供人工核对。"
      if (turn.status === "completed") {
        const rows = this.db.sqlite.query("SELECT data FROM items WHERE turn_id = ? AND type = 'text' AND status = 'completed' ORDER BY ordinal, created_at").all(turn.id) as Array<{ data: string }>
        const texts = rows.flatMap(({ data }) => { try { const value = JSON.parse(data) as { placement?: string; text?: string }; return value.placement === "result" && value.text ? [value.text] : [] } catch { return [] } })
        summary = texts.at(-1) ?? "Turn 已完成；未发现可复用的文本结果。"
      }
      await this.captureAndBroadcast({ threadId, turnId: turn.id, verified: turn.status === "completed", summary })
    }
  }

  setFrozen(taskId: string, frozen: boolean, promote = false) {
    return this.db.transaction(() => {
      const state = this.ensureState(taskId)
      const timestamp = this.now()
      this.db.sqlite.query("UPDATE task_context_state SET frozen_at = ?, updated_at = ? WHERE task_id = ?").run(frozen ? timestamp : null, timestamp, taskId)
      if (frozen && promote) this.db.sqlite.query("INSERT OR IGNORE INTO task_context_promotion_jobs (id, task_id, context_revision, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(crypto.randomUUID(), taskId, state.context_revision, timestamp, timestamp)
      const snapshot = this.snapshot(taskId)
      const result = { snapshot, event: this.changedEvent(taskId, snapshot, timestamp) }
      if (frozen && promote) queueMicrotask(() => this.promotionDrain?.())
      return result
    })
  }

  createProposal(input: { taskId: string; baseContextRevision: number; throughEvidenceRevision: number; changes: TaskContextChange[]; modelRef: string | null }): TaskContextProposal {
    const snapshot = this.snapshot(input.taskId)
    if (snapshot.frozen) throw new AgentError("TASKBOARD_CONTEXT_FROZEN", "任务上下文已冻结", 409)
    if (snapshot.contextRevision !== input.baseContextRevision) throw new AgentError("TASKBOARD_CONTEXT_REVISION_CONFLICT", "任务上下文版本已变化", 409)
    if (input.throughEvidenceRevision > snapshot.evidenceRevision) throw new AgentError("INVALID_REQUEST", "任务上下文 evidence revision 无效", 400)
    if (input.changes.length > TASK_CONTEXT_PUBLISH_MAX_CHANGES) throw new AgentError("INVALID_REQUEST", "AI proposal 变更过多", 400)
    for (const change of input.changes) this.validateChange(input.taskId, change)
    const timestamp = this.now()
    const proposal: TaskContextProposal = { id: crypto.randomUUID(), taskId: input.taskId, baseContextRevision: input.baseContextRevision, throughEvidenceRevision: input.throughEvidenceRevision, changes: input.changes, status: "draft", modelRef: input.modelRef, createdAt: timestamp, updatedAt: timestamp }
    this.db.sqlite.query("INSERT INTO task_context_ai_proposals (id, task_id, base_context_revision, through_evidence_revision, changes, status, model_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)").run(proposal.id, proposal.taskId, proposal.baseContextRevision, proposal.throughEvidenceRevision, JSON.stringify(proposal.changes), proposal.modelRef, timestamp, timestamp)
    return proposal
  }

  proposal(id: string): TaskContextProposal {
    const row = this.db.sqlite.query("SELECT * FROM task_context_ai_proposals WHERE id = ?").get(id) as { id: string; task_id: string; base_context_revision: number; through_evidence_revision: number; changes: string; status: TaskContextProposal["status"]; model_ref: string | null; created_at: number; updated_at: number } | null
    if (!row) throw new AgentError("TASKBOARD_PROPOSAL_NOT_FOUND", "任务上下文 proposal 不存在", 404)
    return { id: row.id, taskId: row.task_id, baseContextRevision: row.base_context_revision, throughEvidenceRevision: row.through_evidence_revision, changes: JSON.parse(row.changes) as TaskContextChange[], status: row.status, modelRef: row.model_ref, createdAt: row.created_at, updatedAt: row.updated_at }
  }

  applyProposal(id: string) {
    const result = this.db.transaction(() => {
      const proposal = this.proposal(id)
      if (proposal.status !== "draft") throw new AgentError("CONFLICT", "任务上下文 proposal 已处理", 409)
      const state = this.ensureState(proposal.taskId)
      if (state.frozen_at !== null) throw new AgentError("TASKBOARD_CONTEXT_FROZEN", "任务上下文已冻结", 409)
      if (state.context_revision !== proposal.baseContextRevision) {
        this.db.sqlite.query("UPDATE task_context_ai_proposals SET status = 'stale', updated_at = ? WHERE id = ?").run(this.now(), id)
        return { stale: true as const }
      }
      const timestamp = this.now()
      for (const change of proposal.changes) this.applyChange(proposal.taskId, change, "ai", null, null, timestamp)
      this.db.sqlite.query("UPDATE task_context_state SET context_revision = context_revision + 1, summarized_through_evidence_revision = MAX(summarized_through_evidence_revision, ?), updated_at = ? WHERE task_id = ?").run(proposal.throughEvidenceRevision, timestamp, proposal.taskId)
      this.db.sqlite.query("UPDATE task_context_ai_proposals SET status = 'applied', updated_at = ? WHERE id = ?").run(timestamp, id)
      const snapshot = this.snapshot(proposal.taskId)
      return { stale: false as const, proposal: { ...proposal, status: "applied" as const, updatedAt: timestamp }, snapshot, event: this.changedEvent(proposal.taskId, snapshot, timestamp) }
    })
    if (result.stale) throw new AgentError("TASKBOARD_PROPOSAL_STALE", "任务上下文 proposal 已过期", 409)
    return result
  }

  discardProposal(id: string) {
    const proposal = this.proposal(id)
    if (proposal.status !== "draft") throw new AgentError("CONFLICT", "任务上下文 proposal 已处理", 409)
    const timestamp = this.now()
    this.db.sqlite.query("UPDATE task_context_ai_proposals SET status = 'discarded', updated_at = ? WHERE id = ?").run(timestamp, id)
    return { ...proposal, status: "discarded" as const, updatedAt: timestamp }
  }

  promotionStatus(taskId: string) {
    this.ensureState(taskId)
    return this.db.sqlite.query("SELECT id, task_id AS taskId, context_revision AS contextRevision, status, error, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt FROM task_context_promotion_jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId) ?? null
  }

  snapshot(taskId: string): TaskContextSnapshot {
    const state = this.ensureState(taskId)
    const pending = Number((this.db.sqlite.query("SELECT COUNT(*) AS count FROM task_context_evidence WHERE task_id = ? AND revision > ?").get(taskId, state.summarized_through_evidence_revision) as { count: number }).count)
    return { taskId, evidenceRevision: state.evidence_revision, contextRevision: state.context_revision, summarizedThroughEvidenceRevision: state.summarized_through_evidence_revision, pendingEvidenceCount: pending, digest: this.digest(taskId), frozen: state.frozen_at !== null, frozenAt: state.frozen_at, promotedContextRevision: state.promoted_context_revision }
  }

  promptForThread(threadId: string) {
    const owner = this.resolveTaskForThread(threadId)
    if (!owner) return null
    const value = this.snapshot(owner.taskId)
    return `<task_context task_id=${JSON.stringify(value.taskId)} context_revision=${JSON.stringify(value.contextRevision)} evidence_revision=${JSON.stringify(value.evidenceRevision)} pending=${JSON.stringify(value.pendingEvidenceCount)}>\n${value.digest}\n章节：${sections.join(", ")}\n详细内容按需使用 task_context_read；只有确定且可复用的信息才使用 task_context_publish。\n</task_context>`
  }

  private ensureState(taskId: string): StateRow {
    const task = this.db.sqlite.query("SELECT id FROM taskboard_tasks WHERE id = ?").get(taskId)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    let row = this.db.sqlite.query("SELECT * FROM task_context_state WHERE task_id = ?").get(taskId) as StateRow | null
    if (!row) { const timestamp = this.now(); this.db.sqlite.query("INSERT OR IGNORE INTO task_context_state (task_id, created_at, updated_at) VALUES (?, ?, ?)").run(taskId, timestamp, timestamp); row = this.db.sqlite.query("SELECT * FROM task_context_state WHERE task_id = ?").get(taskId) as StateRow }
    return row
  }

  private digest(taskId: string) {
    const task = this.db.sqlite.query("SELECT title, description FROM taskboard_tasks WHERE id = ?").get(taskId) as { title: string; description: string }
    const rows = (this.db.sqlite.query("SELECT * FROM task_context_entries WHERE task_id = ? AND status = 'active' ORDER BY updated_at DESC, id").all(taskId) as EntryRow[]).map(entry)
    const lines = [`目标：${task.title}${task.description.trim() ? `\n${task.description.trim()}` : ""}`]
    for (const section of sections) for (const item of rows.filter(value => value.section === section)) lines.push(`[${section}] ${item.title}：${item.content}`)
    return lines.join("\n").slice(0, TASK_CONTEXT_DIGEST_MAX_LENGTH)
  }

  private applyChange(taskId: string, change: TaskContextChange, sourceKind: TaskContextSourceKind, sourceThreadId: string | null, sourceTurnId: string | null, timestamp: number) {
    if (change.op === "add") { this.validateText(change.title, change.content); this.db.sqlite.query("INSERT INTO task_context_entries (id, task_id, section, title, content, status, version, source_kind, source_thread_id, source_turn_id, supersedes_entry_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, NULL, ?, ?)").run(crypto.randomUUID(), taskId, change.section, change.title.trim(), change.content.trim(), sourceKind, sourceThreadId, sourceTurnId, timestamp, timestamp); return }
    const current = this.db.sqlite.query("SELECT * FROM task_context_entries WHERE id = ? AND task_id = ? AND status = 'active'").get(change.entryId, taskId) as EntryRow | null
    if (!current || current.version !== change.expectedEntryVersion) throw new AgentError("TASKBOARD_CONTEXT_REVISION_CONFLICT", "任务上下文条目版本已变化", 409)
    this.db.sqlite.query("UPDATE task_context_entries SET status = ?, version = version + 1, updated_at = ? WHERE id = ?").run(change.op === "replace" ? "superseded" : "retired", timestamp, current.id)
    if (change.op === "replace") { this.validateText(change.title, change.content); this.db.sqlite.query("INSERT INTO task_context_entries (id, task_id, section, title, content, status, version, source_kind, source_thread_id, source_turn_id, supersedes_entry_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), taskId, current.section, change.title.trim(), change.content.trim(), sourceKind, sourceThreadId, sourceTurnId, current.id, timestamp, timestamp) }
  }

  private validateChange(taskId: string, change: TaskContextChange) {
    if (change.op === "add") { this.validateText(change.title, change.content); return }
    const current = this.db.sqlite.query("SELECT version FROM task_context_entries WHERE id = ? AND task_id = ? AND status = 'active'").get(change.entryId, taskId) as { version: number } | null
    if (!current || current.version !== change.expectedEntryVersion) throw new AgentError("TASKBOARD_CONTEXT_REVISION_CONFLICT", "任务上下文条目版本已变化", 409)
    if (change.op === "replace") this.validateText(change.title, change.content)
  }

  private validateText(title: string, content: string) {
    if (!title.trim() || title.length > TASK_CONTEXT_TITLE_MAX_LENGTH || !content.trim() || content.length > TASK_CONTEXT_CONTENT_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "任务上下文标题或内容长度无效", 400)
    if (secretScrubber.scrubText(`${title}\n${content}`) !== `${title}\n${content}`) throw new AgentError("INVALID_REQUEST", "任务上下文不能包含凭据或敏感信息", 400)
  }
  private safeEvidenceSummary(projectId: string, value: string) {
    const root = this.db.getProject(projectId)?.rootPath.replaceAll("\\", "/").replace(/\/$/, "")
    let safe = secretScrubber.scrubText(value).replaceAll("\\", "/")
    if (root) safe = safe.replaceAll(root, ".")
    return safe.replace(/\b[A-Za-z]:\/(?:[^\s<>"']+)/g, "[ABSOLUTE_PATH_REDACTED]").trim().slice(0, 8_000)
  }
  private changedEvent(taskId: string, snapshot: TaskContextSnapshot, changedAt: number): EventEnvelope { const task = this.db.sqlite.query("SELECT project_id FROM taskboard_tasks WHERE id = ?").get(taskId) as { project_id: string }; return this.db.insertEvent(null, null, "taskboard/context/changed", { projectId: task.project_id, taskId, evidenceRevision: snapshot.evidenceRevision, contextRevision: snapshot.contextRevision, pendingEvidenceCount: snapshot.pendingEvidenceCount, frozen: snapshot.frozen, changedAt }) }
}
