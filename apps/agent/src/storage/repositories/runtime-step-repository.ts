import { createHash } from "node:crypto"
import type { AgentDatabase } from "../database/AgentDatabase"

export type RuntimeStepStatus = "pending" | "running" | "completed" | "failed" | "interrupted"

export type RuntimeDeliveryKind = "wake" | "steer" | "follow-up" | "next-turn" | "context"

export interface RuntimeStepRecord {
  id: string
  threadId: string
  turnId: string
  ordinal: number
  status: RuntimeStepStatus
  claimedInputIds: string[]
  runtimeManifestHash: string
  startedAt: number
  completedAt: number | null
  stopReason: string | null
}

export interface RuntimeInboxInput {
  id: string
  threadId: string
  turnId: string
  deliveryKind: RuntimeDeliveryKind
  content: string
  createdAt: number
}

export interface RuntimeContextSnapshotRecord {
  id: string
  threadId: string
  turnId: string
  stepId: string
  attemptOrdinal: number
  piSessionId: string
  piLeafEntryId: string | null
  messageEntryIds: string[]
  messageDigest: string
  promptText: string
  toolCatalogJson: string
  runtimeManifestJson: string
  contextDigest: string
  createdAt: number
}

export const computeCanonicalMessagesDigest = (messages: readonly unknown[]) =>
  createHash("sha256")
    .update(JSON.stringify(messages.map((m: any) => ({
      role: m?.role,
      content: m?.content,
      toolCallId: m?.toolCallId,
      toolCalls: m?.toolCalls,
      isError: m?.isError,
      cacheControl: m?.cacheControl,
    }))), "utf8")
    .digest("hex")

export const runtimeContextDigest = (input: {
  messageEntryIds: readonly string[]
  messageDigest: string
  promptText: string
  toolCatalogJson: string
  runtimeManifestJson: string
}) => createHash("sha256")
  .update(JSON.stringify({
    messageEntryIds: [...input.messageEntryIds],
    messageDigest: input.messageDigest,
    promptText: input.promptText,
    toolCatalogJson: input.toolCatalogJson,
    runtimeManifestJson: input.runtimeManifestJson,
  }), "utf8")
  .digest("hex")

const STEP_COLUMNS = "id, thread_id, turn_id, ordinal, status, claimed_input_ids, runtime_manifest_hash, started_at, completed_at, stop_reason"

const stepFromRow = (row: Record<string, unknown>): RuntimeStepRecord => ({
  id: String(row.id),
  threadId: String(row.thread_id),
  turnId: String(row.turn_id),
  ordinal: Number(row.ordinal),
  status: row.status as RuntimeStepStatus,
  claimedInputIds: JSON.parse(String(row.claimed_input_ids)) as string[],
  runtimeManifestHash: String(row.runtime_manifest_hash),
  startedAt: Number(row.started_at),
  completedAt: row.completed_at === null ? null : Number(row.completed_at),
  stopReason: row.stop_reason === null ? null : String(row.stop_reason),
})

/**
 * 统一 Turn Inbox 与持久 step 状态机。
 *
 * - 所有输入先持久化（delivery_kind 标注），step 开始前在事务内按 created_at,id
 *   原子 claim 并写 claimed_step_id；savepoint 成功后标记 consumed（原 mailbox 语义）。
 * - 每次 Provider 请求对应一个 step ordinal；retry 属于同一 step，reactive
 *   compaction 后重新请求产生新的 context snapshot attempt ordinal。
 * - 启动恢复：running step 标记 interrupted，未完成 step 的 claim 释放回 inbox。
 */
export class RuntimeStepRepository {
  constructor(private readonly db: AgentDatabase) {}

  /** 在调用方事务内执行；按 (created_at, id) 原子认领未 claim 的唤醒类输入。 */
  claimInputs(threadId: string, turnId: string, stepId: string, limit = 8): RuntimeInboxInput[] {
    const rows = this.db.sqlite.query(`
      SELECT id, thread_id, turn_id, delivery_kind, content, created_at
      FROM inputs
      WHERE thread_id = ? AND turn_id = ? AND claimed_step_id IS NULL
        AND delivery_kind IN ('wake', 'steer', 'follow-up')
      ORDER BY created_at, id
      LIMIT ?
    `).all(threadId, turnId, limit) as Array<Record<string, unknown>>
    const inputs: RuntimeInboxInput[] = rows.map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      deliveryKind: row.delivery_kind as RuntimeDeliveryKind,
      content: String(row.content),
      createdAt: Number(row.created_at),
    }))
    if (inputs.length === 0) return inputs
    const placeholders = inputs.map(() => "?").join(", ")
    this.db.sqlite.query(
      `UPDATE inputs SET claimed_step_id = ? WHERE id IN (${placeholders})`,
    ).run(stepId, ...inputs.map((input) => input.id))
    return inputs
  }

  /** 未完成 step 的 claim 释放回 inbox（abort/crash 恢复）。 */
  releaseUncommittedClaims(threadId: string, turnId: string) {
    this.db.sqlite.query(`
      UPDATE inputs
      SET claimed_step_id = NULL
      WHERE thread_id = ? AND turn_id = ?
        AND claimed_step_id IS NOT NULL
        AND claimed_step_id NOT IN (
          SELECT id FROM runtime_steps WHERE turn_id = ? AND status = 'completed'
        )
    `).run(threadId, turnId, turnId)
  }

  /** Step 成功完成后标记 claimed inputs 为 consumed。 */
  consumeClaimedInputs(stepId: string) {
    this.db.sqlite.query(`
      UPDATE inputs
      SET status = 'consumed'
      WHERE claimed_step_id = ?
    `).run(stepId)
  }

  /** 在调用方事务内执行；为同一 turn 分配下一个 step ordinal。 */
  insertStep(input: {
    threadId: string
    turnId: string
    claimedInputIds: readonly string[]
    runtimeManifestHash: string
    startedAt: number
  }): RuntimeStepRecord {
    const row = this.db.sqlite.query(
      "SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM runtime_steps WHERE turn_id = ?",
    ).get(input.turnId) as { next: number }
    const record: RuntimeStepRecord = {
      id: crypto.randomUUID(),
      threadId: input.threadId,
      turnId: input.turnId,
      ordinal: row.next,
      status: "running",
      claimedInputIds: [...input.claimedInputIds],
      runtimeManifestHash: input.runtimeManifestHash,
      startedAt: input.startedAt,
      completedAt: null,
      stopReason: null,
    }
    this.db.sqlite.query(`
      INSERT INTO runtime_steps (
        id, thread_id, turn_id, ordinal, status, claimed_input_ids,
        runtime_manifest_hash, started_at, completed_at, stop_reason
      ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, NULL, NULL)
    `).run(
      record.id, record.threadId, record.turnId, record.ordinal,
      JSON.stringify(record.claimedInputIds), record.runtimeManifestHash, record.startedAt,
    )
    return record
  }

  completeStep(stepId: string, completedAt: number, stopReason?: string | null) {
    this.db.sqlite.query(`
      UPDATE runtime_steps SET status = 'completed', completed_at = ?, stop_reason = ?
      WHERE id = ?
    `).run(completedAt, stopReason ?? null, stepId)
  }

  failStep(stepId: string, completedAt: number) {
    this.db.sqlite.query(`
      UPDATE runtime_steps SET status = 'failed', completed_at = ?
      WHERE id = ?
    `).run(completedAt, stepId)
  }

  interruptStep(stepId: string, completedAt: number) {
    this.db.sqlite.query(`
      UPDATE runtime_steps SET status = 'interrupted', completed_at = ?
      WHERE id = ?
    `).run(completedAt, stepId)
  }

  /** 启动恢复：把运行中的 step 标记为 interrupted 并释放未完成 claim。 */
  recoverInterruptedSteps(): Array<{ threadId: string; turnId: string; stepId: string; ordinal: number }> {
    const running = this.db.sqlite.query(`
      SELECT id, thread_id, turn_id, ordinal FROM runtime_steps WHERE status = 'running'
    `).all() as Array<Record<string, unknown>>
    const now = Date.now()
    const interrupted: Array<{ threadId: string; turnId: string; stepId: string; ordinal: number }> = []
    for (const row of running) {
      const stepId = String(row.id)
      this.db.sqlite.query(
        "UPDATE runtime_steps SET status = 'interrupted', completed_at = ? WHERE id = ?",
      ).run(now, stepId)
      interrupted.push({
        threadId: String(row.thread_id),
        turnId: String(row.turn_id),
        stepId,
        ordinal: Number(row.ordinal),
      })
      this.releaseUncommittedClaims(String(row.thread_id), String(row.turn_id))
    }
    return interrupted
  }

  listSteps(turnId: string): RuntimeStepRecord[] {
    const rows = this.db.sqlite.query(
      `SELECT ${STEP_COLUMNS} FROM runtime_steps WHERE turn_id = ? ORDER BY ordinal`,
    ).all(turnId) as Array<Record<string, unknown>>
    return rows.map(stepFromRow)
  }

  /** 在调用方事务内执行；prompt/JSON 写入前已由调用方完成 SecretScrubber。 */
  insertContextSnapshot(input: {
    threadId: string
    turnId: string
    stepId: string
    attemptOrdinal: number
    piSessionId: string
    piLeafEntryId: string | null
    messageEntryIds: readonly string[]
    messageDigest: string
    promptText: string
    toolCatalogJson: string
    runtimeManifestJson: string
    createdAt: number
  }): RuntimeContextSnapshotRecord {
    const contextDigest = runtimeContextDigest({
      messageEntryIds: input.messageEntryIds,
      messageDigest: input.messageDigest,
      promptText: input.promptText,
      toolCatalogJson: input.toolCatalogJson,
      runtimeManifestJson: input.runtimeManifestJson,
    })
    const record: RuntimeContextSnapshotRecord = {
      id: crypto.randomUUID(),
      threadId: input.threadId,
      turnId: input.turnId,
      stepId: input.stepId,
      attemptOrdinal: input.attemptOrdinal,
      piSessionId: input.piSessionId,
      piLeafEntryId: input.piLeafEntryId,
      messageEntryIds: [...input.messageEntryIds],
      messageDigest: input.messageDigest,
      promptText: input.promptText,
      toolCatalogJson: input.toolCatalogJson,
      runtimeManifestJson: input.runtimeManifestJson,
      contextDigest,
      createdAt: input.createdAt,
    }
    this.db.sqlite.query(`
      INSERT INTO runtime_context_snapshots (
        id, thread_id, turn_id, step_id, attempt_ordinal, pi_session_id,
        pi_leaf_entry_id, message_entry_ids, message_digest, prompt_text,
        tool_catalog_json, runtime_manifest_json, context_digest, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.threadId, record.turnId, record.stepId, record.attemptOrdinal,
      record.piSessionId, record.piLeafEntryId, JSON.stringify(record.messageEntryIds),
      record.messageDigest, record.promptText, record.toolCatalogJson,
      record.runtimeManifestJson, record.contextDigest, record.createdAt,
    )
    return record
  }
}
