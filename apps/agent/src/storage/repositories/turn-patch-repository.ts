import { createHash } from "node:crypto"
import { AgentError } from "../../domain"
import type {
  StoredTurnPatchBatch,
  StoredTurnPatchSet,
  TurnPatchApplyState,
  TurnPatchMutationBatch,
} from "../../patch/TurnPatchTypes"
import type { RepositoryDatabase } from "./RepositoryDatabase"

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)
const requestHash = (value: unknown) =>
  createHash("sha256").update(stringify(value), "utf8").digest("hex")

type PatchSetRow = {
  thread_id: string
  turn_id: string
  item_id: string
  apply_state: TurnPatchApplyState
  action_version: number
  evidence_complete: number
}

const patchSet = (row: PatchSetRow): StoredTurnPatchSet => ({
  threadID: row.thread_id,
  turnID: row.turn_id,
  itemID: row.item_id,
  applyState: row.apply_state,
  actionVersion: row.action_version,
  evidenceComplete: row.evidence_complete === 1,
})

export class TurnPatchRepository {
  constructor(private readonly db: RepositoryDatabase) {}

  recordBatch(input: TurnPatchMutationBatch) {
    if (input.files.length === 0) return
    const timestamp = Date.now()
    const itemID = `patch:${input.turnID}`
    this.db.transaction(() => {
      const execution = this.db.sqlite.query(
        "SELECT thread_id, turn_id FROM agent_executions WHERE id = ?",
      ).get(input.agentID) as { thread_id: string; turn_id: string } | null
      if (
        !execution
        || execution.thread_id !== input.threadID
        || execution.turn_id !== input.turnID
      ) {
        throw new AgentError("CONFLICT", "文件变更证据与当前执行不匹配", 409)
      }
      this.db.sqlite.query(`
        INSERT INTO turn_patch_sets (
          turn_id, thread_id, item_id, apply_state, action_version, evidence_complete, created_at, updated_at
        ) VALUES (?, ?, ?, 'applied', 0, 1, ?, ?)
        ON CONFLICT(turn_id) DO NOTHING
      `).run(input.turnID, input.threadID, itemID, timestamp, timestamp)

      const existing = this.db.sqlite.query(
        "SELECT turn_id, files FROM turn_patch_batches WHERE tool_call_id = ?",
      ).get(input.toolCallID) as { turn_id: string; files: string } | null
      const files = stringify(input.files)
      if (existing) {
        if (existing.turn_id !== input.turnID || existing.files !== files) {
          throw new AgentError("CONFLICT", "toolCallId 已绑定不同的文件变更证据", 409)
        }
        return
      }
      const ordinal = Number((this.db.sqlite.query(
        "SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM turn_patch_batches WHERE turn_id = ?",
      ).get(input.turnID) as { ordinal: number }).ordinal)
      this.db.sqlite.query(`
        INSERT INTO turn_patch_batches (
          turn_id, ordinal, tool_call_id, files, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(input.turnID, ordinal, input.toolCallID, files, timestamp)
      this.db.sqlite.query(
        "UPDATE turn_patch_sets SET updated_at = ? WHERE turn_id = ?",
      ).run(timestamp, input.turnID)
    })
  }

  markIncomplete(threadID: string, turnID: string) {
    const timestamp = Date.now()
    this.db.sqlite.query(`
      INSERT INTO turn_patch_sets (
        turn_id, thread_id, item_id, apply_state, action_version,
        evidence_complete, created_at, updated_at
      ) VALUES (?, ?, ?, 'applied', 0, 0, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        evidence_complete = 0,
        updated_at = excluded.updated_at
    `).run(turnID, threadID, `patch:${turnID}`, timestamp, timestamp)
  }

  getByItem(threadID: string, itemID: string): StoredTurnPatchSet | null {
    const row = this.db.sqlite.query(`
      SELECT thread_id, turn_id, item_id, apply_state, action_version, evidence_complete
      FROM turn_patch_sets
      WHERE thread_id = ? AND item_id = ?
    `).get(threadID, itemID) as PatchSetRow | null
    return row ? patchSet(row) : null
  }

  getByTurn(turnID: string): StoredTurnPatchSet | null {
    const row = this.db.sqlite.query(`
      SELECT thread_id, turn_id, item_id, apply_state, action_version, evidence_complete
      FROM turn_patch_sets
      WHERE turn_id = ?
    `).get(turnID) as PatchSetRow | null
    return row ? patchSet(row) : null
  }

  batches(turnID: string): StoredTurnPatchBatch[] {
    return (this.db.sqlite.query(`
      SELECT ordinal, tool_call_id, files
      FROM turn_patch_batches
      WHERE turn_id = ?
      ORDER BY ordinal
    `).all(turnID) as Array<{
      ordinal: number
      tool_call_id: string
      files: string
    }>).map((row) => ({
      ordinal: row.ordinal,
      toolCallID: row.tool_call_id,
      files: parse(row.files),
    }))
  }

  completedOperation(
    operationID: string,
    request: unknown,
  ): { itemID: string; applyState: TurnPatchApplyState; actionVersion: number } | null {
    const row = this.db.sqlite.query(`
      SELECT request_hash, result
      FROM turn_patch_operations
      WHERE operation_id = ?
    `).get(operationID) as { request_hash: string; result: string } | null
    if (!row) return null
    if (row.request_hash !== requestHash(request)) {
      throw new AgentError("CONFLICT", "operationId 已用于不同的撤销请求", 409)
    }
    return parse(row.result)
  }

  completeOperation(input: {
    operationID: string
    request: unknown
    turnID: string
    expectedVersion: number
    applyState: TurnPatchApplyState
    itemID: string
  }) {
    const timestamp = Date.now()
    return this.db.transaction(() => {
      const changed = this.db.sqlite.query(`
        UPDATE turn_patch_sets
        SET apply_state = ?, action_version = action_version + 1, updated_at = ?
        WHERE turn_id = ? AND action_version = ?
      `).run(
        input.applyState,
        timestamp,
        input.turnID,
        input.expectedVersion,
      )
      if (changed.changes !== 1) {
        throw new AgentError("CONFLICT", "修改文件卡片状态已经变化，请刷新后重试", 409)
      }
      const state = this.getByTurn(input.turnID)!
      const result = {
        itemID: input.itemID,
        applyState: state.applyState,
        actionVersion: state.actionVersion,
      }
      this.db.sqlite.query(`
        INSERT INTO turn_patch_operations (
          operation_id, turn_id, request_hash, result, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        input.operationID,
        input.turnID,
        requestHash(input.request),
        stringify(result),
        timestamp,
      )
      return result
    })
  }
}
