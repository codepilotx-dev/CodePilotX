import { createHash } from "node:crypto"
import type { AgentDatabase } from "../database/AgentDatabase"
import type { RuntimeCompositionSnapshotV1 } from "../../runtime-composition/types"

export type StoredRuntimeCompositionPlan = {
  turnID: string
  agentID: string
  compositionID: string
  snapshotVersion: number
  snapshot: RuntimeCompositionSnapshotV1
  snapshotHash: string
  createdAt: number
}

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  const walk = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object") return entry
    if (seen.has(entry as object)) return null
    seen.add(entry as object)
    if (Array.isArray(entry)) return entry.map(walk)
    const record = entry as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      next[key] = walk(record[key] ?? null)
    }
    return next
  }
  return JSON.stringify(walk(value))
}

export const hashRuntimeCompositionSnapshot = (snapshot: RuntimeCompositionSnapshotV1) =>
  createHash("sha256").update(stableStringify(snapshot), "utf8").digest("hex")

export class RuntimeCompositionRepository {
  constructor(private readonly db: AgentDatabase) {}

  hasTable(): boolean {
    return Boolean(
      this.db.sqlite.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_composition_plans'",
      ).get(),
    )
  }

  /**
   * Insert the snapshot if absent; never UPDATE the durable row. Returns the
   * existing or newly-persisted record and whether it was newly inserted.
   */
  insertOrGet(input: {
    turnID: string
    agentID: string
    compositionID: string
    snapshot: RuntimeCompositionSnapshotV1
  }): { plan: StoredRuntimeCompositionPlan; inserted: boolean } {
    if (!this.hasTable()) {
      throw new Error("runtime_composition_plans 表不存在，ephemeral composition 必须直接返回")
    }
    const snapshotHash = hashRuntimeCompositionSnapshot(input.snapshot)
    const createdAt = Date.now()
    const inserted = this.db.sqlite.query(`
      INSERT INTO runtime_composition_plans (
        turn_id, agent_id, composition_id, snapshot_version, snapshot_json, snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO NOTHING
    `).run(
      input.turnID,
      input.agentID,
      input.compositionID,
      input.snapshot.version,
      JSON.stringify(input.snapshot),
      snapshotHash,
      createdAt,
    ).changes > 0
    const authoritative = this.get(input.turnID)
    if (!authoritative) throw new Error("Runtime composition persistence failed")
    if (authoritative.compositionID !== input.compositionID) {
      throw new Error("Runtime composition identity conflict")
    }
    if (inserted && authoritative.snapshotHash !== snapshotHash) {
      throw new Error("Runtime composition persistence verification failed")
    }
    return { plan: authoritative, inserted }
  }

  get(turnID: string): StoredRuntimeCompositionPlan | null {
    if (!this.hasTable()) return null
    const row = this.db.sqlite.query(`
      SELECT turn_id, agent_id, composition_id, snapshot_version, snapshot_json, snapshot_hash, created_at
      FROM runtime_composition_plans
      WHERE turn_id = ?
    `).get(turnID) as
      | {
        turn_id: string
        agent_id: string
        composition_id: string
        snapshot_version: number
        snapshot_json: string
        snapshot_hash: string
        created_at: number
      }
      | undefined
    if (!row) return null
    let snapshot: RuntimeCompositionSnapshotV1
    try {
      snapshot = JSON.parse(row.snapshot_json) as RuntimeCompositionSnapshotV1
    } catch {
      throw new Error("Runtime composition snapshot is invalid")
    }
    if (row.snapshot_version !== 1 || snapshot.version !== 1) {
      throw new Error("Runtime composition snapshot version is unsupported")
    }
    if (snapshot.identity.id !== row.composition_id) {
      throw new Error("Runtime composition identity verification failed")
    }
    if (snapshot.identity.hash !== snapshot.hashes.overall) {
      throw new Error("Runtime composition overall hash verification failed")
    }
    if (hashRuntimeCompositionSnapshot(snapshot) !== row.snapshot_hash) {
      throw new Error("Runtime composition snapshot hash verification failed")
    }
    return {
      turnID: row.turn_id,
      agentID: row.agent_id,
      compositionID: row.composition_id,
      snapshotVersion: row.snapshot_version,
      snapshot,
      snapshotHash: row.snapshot_hash,
      createdAt: row.created_at,
    }
  }
}
