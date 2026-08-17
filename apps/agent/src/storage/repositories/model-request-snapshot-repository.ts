import { createHash } from "node:crypto"
import type { AgentDatabase } from "../database/AgentDatabase"

export type RequestSnapshotStatus = "captured" | "missing"
export type RequestSnapshotErrorCode = "SERIALIZE_FAILED" | "SCRUB_FAILED" | "STORAGE_FAILED"

export interface RequestSnapshotSummary {
  id: string
  threadId: string
  turnId: string
  agentId: string
  requestOrdinal: number
  providerId: string
  api: string
  modelId: string
  status: RequestSnapshotStatus
  payloadBytes: number | null
  payloadSha256: string | null
  errorCode: RequestSnapshotErrorCode | null
  createdAt: number
}

export interface RequestSnapshotDetail extends RequestSnapshotSummary {
  payloadJson: string | null
  runtimeManifest: string
}

/** 版本化运行时清单 v1（只读兼容）；新写入只产生 v2。 */
export interface StoredRuntimeManifestV1 {
  version: 1
  presetID: string
  contributions: Array<{ id: string; version: number }>
  promptHash: string
  toolCatalogHash: string
  toolNames: string[]
  manifestHash: string
}

/** 版本化运行时清单 v2：携带组合层、插件 generation 绑定与服务绑定拓扑。 */
export interface StoredRuntimeManifestV2 {
  version: 2
  presetID: string
  layers: readonly { id: string; version: number; order: number }[]
  contributions: Array<{ id: string; version: number }>
  pluginBindings: readonly {
    pluginId: string
    generationId: string
    packageDigest: string
  }[]
  serviceBindings: readonly {
    serviceKey: string
    providerPluginId: string | null
    providerGenerationId: string | null
    version: string
  }[]
  interceptorBindings: readonly {
    id: string
    version: number
    point: string
  }[]
  promptHash: string
  toolCatalogHash: string
  toolNames: string[]
  serviceBindingHash: string
  manifestHash: string
}

export type StoredRuntimeManifest = StoredRuntimeManifestV1 | StoredRuntimeManifestV2

export const requestSnapshotPayloadHash = (payloadJson: string) =>
  createHash("sha256").update(payloadJson, "utf8").digest("hex")

type SnapshotRow = {
  id: string
  thread_id: string
  turn_id: string
  agent_id: string
  request_ordinal: number
  provider_id: string
  api: string
  model_id: string
  status: RequestSnapshotStatus
  payload_json: string | null
  payload_sha256: string | null
  payload_bytes: number | null
  runtime_manifest: string
  error_code: RequestSnapshotErrorCode | null
  created_at: number
}

const summaryColumns = `
  id, thread_id, turn_id, agent_id, request_ordinal, provider_id, api, model_id,
  status, payload_sha256, payload_bytes, error_code, created_at
`

const toSummary = (row: SnapshotRow): RequestSnapshotSummary => ({
  id: row.id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  agentId: row.agent_id,
  requestOrdinal: row.request_ordinal,
  providerId: row.provider_id,
  api: row.api,
  modelId: row.model_id,
  status: row.status,
  payloadBytes: row.payload_bytes,
  payloadSha256: row.payload_sha256,
  errorCode: row.error_code,
  createdAt: row.created_at,
})

const cursorValue = (row: { created_at: number; id: string }) => `${row.created_at}:${row.id}`
const parseCursor = (cursor: string): { createdAt: number; id: string } => {
  const separator = cursor.indexOf(":")
  if (separator <= 0) throw new Error("无效的快照分页游标")
  const createdAt = Number(cursor.slice(0, separator))
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("无效的快照分页游标")
  return { createdAt, id: cursor.slice(separator + 1) }
}

/**
 * 请求快照存储。ordinal 分配必须在调用方事务内完成；
 * 快照行与 created event/outbox 在同一事务提交后由调用方发布。
 */
export class ModelRequestSnapshotRepository {
  constructor(private readonly db: AgentDatabase) {}

  private nextOrdinal(sessionId: string) {
    const row = this.db.sqlite.query(
      "SELECT COALESCE(MAX(request_ordinal), -1) + 1 AS next FROM model_request_snapshots WHERE session_id = ?",
    ).get(sessionId) as { next: number }
    return row.next
  }

  /** 必须在调用方事务内执行；对实际保存的 UTF-8 payload 计算 SHA-256 与字节数。 */
  insertCaptured(input: {
    threadId: string
    turnId: string
    agentId: string
    sessionId: string
    providerId: string
    api: string
    modelId: string
    payloadJson: string
    runtimeManifest: string
    createdAt: number
  }): RequestSnapshotSummary {
    const id = crypto.randomUUID()
    const requestOrdinal = this.nextOrdinal(input.sessionId)
    const payloadSha256 = requestSnapshotPayloadHash(input.payloadJson)
    const payloadBytes = Buffer.byteLength(input.payloadJson, "utf8")
    this.db.sqlite.query(`
      INSERT INTO model_request_snapshots (
        id, thread_id, turn_id, agent_id, session_id, request_ordinal,
        provider_id, api, model_id, status, payload_json, payload_sha256,
        payload_bytes, runtime_manifest, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, NULL, ?)
    `).run(
      id, input.threadId, input.turnId, input.agentId, input.sessionId, requestOrdinal,
      input.providerId, input.api, input.modelId, input.payloadJson, payloadSha256,
      payloadBytes, input.runtimeManifest, input.createdAt,
    )
    return {
      id,
      threadId: input.threadId,
      turnId: input.turnId,
      agentId: input.agentId,
      requestOrdinal,
      providerId: input.providerId,
      api: input.api,
      modelId: input.modelId,
      status: "captured",
      payloadBytes,
      payloadSha256,
      errorCode: null,
      createdAt: input.createdAt,
    }
  }

  /** 捕获失败时的小记录：无 payload，只保留固定安全错误码。 */
  insertMissing(input: {
    threadId: string
    turnId: string
    agentId: string
    sessionId: string
    providerId: string
    api: string
    modelId: string
    errorCode: RequestSnapshotErrorCode
    runtimeManifest: string
    createdAt: number
  }): RequestSnapshotSummary {
    const id = crypto.randomUUID()
    const requestOrdinal = this.nextOrdinal(input.sessionId)
    this.db.sqlite.query(`
      INSERT INTO model_request_snapshots (
        id, thread_id, turn_id, agent_id, session_id, request_ordinal,
        provider_id, api, model_id, status, payload_json, payload_sha256,
        payload_bytes, runtime_manifest, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'missing', NULL, NULL, NULL, ?, ?, ?)
    `).run(
      id, input.threadId, input.turnId, input.agentId, input.sessionId, requestOrdinal,
      input.providerId, input.api, input.modelId, input.runtimeManifest, input.errorCode, input.createdAt,
    )
    return {
      id,
      threadId: input.threadId,
      turnId: input.turnId,
      agentId: input.agentId,
      requestOrdinal,
      providerId: input.providerId,
      api: input.api,
      modelId: input.modelId,
      status: "missing",
      payloadBytes: null,
      payloadSha256: null,
      errorCode: input.errorCode,
      createdAt: input.createdAt,
    }
  }

  list(threadId: string, cursor?: string, limit = 50): { items: RequestSnapshotSummary[]; nextCursor?: string } {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit) || 50))
    let rows: SnapshotRow[]
    if (cursor) {
      const { createdAt, id } = parseCursor(cursor)
      rows = this.db.sqlite.query(`
        SELECT ${summaryColumns} FROM model_request_snapshots
        WHERE thread_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(threadId, createdAt, createdAt, id, bounded + 1) as SnapshotRow[]
    } else {
      rows = this.db.sqlite.query(`
        SELECT ${summaryColumns} FROM model_request_snapshots
        WHERE thread_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(threadId, bounded + 1) as SnapshotRow[]
    }
    const hasMore = rows.length > bounded
    const page = rows.slice(0, bounded)
    return {
      items: page.map(toSummary),
      ...(hasMore && page.length > 0 ? { nextCursor: cursorValue(page.at(-1)!) } : {}),
    }
  }

  /** 按 threadId + snapshotId 读取详情，防止跨任务读取。 */
  read(threadId: string, snapshotId: string): RequestSnapshotDetail | null {
    const row = this.db.sqlite.query(`
      SELECT id, thread_id, turn_id, agent_id, request_ordinal, provider_id, api, model_id,
             status, payload_json, payload_sha256, payload_bytes, runtime_manifest, error_code, created_at
      FROM model_request_snapshots
      WHERE thread_id = ? AND id = ?
    `).get(threadId, snapshotId) as SnapshotRow | null
    if (!row) return null
    return {
      ...toSummary(row),
      payloadJson: row.payload_json,
      runtimeManifest: row.runtime_manifest,
    }
  }
}
