import { secretScrubber } from "../security/SecretScrubber"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import {
  ModelRequestSnapshotRepository,
  type RequestSnapshotErrorCode,
  type StoredRuntimeManifest,
} from "../storage/repositories/model-request-snapshot-repository"
import type { AgentLogger } from "../observability/AgentLogger"

export interface RequestSnapshotCaptureInput {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  providerId: string
  api: string
  modelId: string
  /** 已由 SecretScrubber 出库前脱敏的 Provider payload。 */
  payload: unknown
  runtimeManifest: StoredRuntimeManifest
}

export interface RequestSnapshotRecorder {
  /** 记录失败不阻断 Provider 请求；可记录时生成 missing 行，否则只产生安全诊断。 */
  capture(input: RequestSnapshotCaptureInput): Promise<void>
}

/**
 * 完整 Provider 请求快照采集器。
 *
 * 快照行与 created event/outbox 在同一事务写入，提交后才发布；
 * 配置关闭时不采集且不删除历史记录。payload 不含认证头与响应数据。
 */
export class ModelRequestSnapshotRecorder implements RequestSnapshotRecorder {
  private readonly repo: ModelRequestSnapshotRepository

  constructor(private readonly options: {
    db: AgentDatabase
    enabled: () => boolean
    publish: (event: ReturnType<AgentDatabase["insertEvent"]>) => Promise<void>
    logger?: AgentLogger
  }) {
    this.repo = new ModelRequestSnapshotRepository(options.db)
  }

  async capture(input: RequestSnapshotCaptureInput): Promise<void> {
    if (!this.options.enabled()) return
    const runtimeManifest = JSON.stringify(input.runtimeManifest)
    const createdAt = Date.now()
    let payloadJson: string
    try {
      payloadJson = JSON.stringify(input.payload)
    } catch {
      await this.recordMissing(input, runtimeManifest, createdAt, "SERIALIZE_FAILED")
      return
    }
    // 防御性再脱敏：序列化文本无法通过统一脱敏边界时只落 missing 记录。
    try {
      payloadJson = secretScrubber.scrubText(payloadJson)
    } catch {
      await this.recordMissing(input, runtimeManifest, createdAt, "SCRUB_FAILED")
      return
    }
    let durable: ReturnType<AgentDatabase["insertEvent"]>
    try {
      durable = this.options.db.transaction(() => {
        const summary = this.repo.insertCaptured({
          threadId: input.threadID,
          turnId: input.turnID,
          agentId: input.agentID,
          sessionId: input.sessionID,
          providerId: input.providerId,
          api: input.api,
          modelId: input.modelId,
          payloadJson,
          runtimeManifest,
          createdAt,
        })
        return this.options.db.insertEvent(
          input.threadID,
          input.turnID,
          "runtime/request-snapshot/created",
          { threadId: input.threadID, snapshot: summary },
        )
      })
    } catch {
      // 事务失败：只落 missing 记录，绝不持久化原文。
      await this.recordMissing(input, runtimeManifest, createdAt, "STORAGE_FAILED")
      return
    }
    try {
      await this.options.publish(durable)
    } catch {
      // 事务已提交：依赖 outbox replay 投递，只写安全诊断，不追加 missing，
      // 避免 captured + missing 双记录。
      this.options.logger?.warn("request-snapshot.publish.failed", {
        context: {
          threadId: input.threadID,
          turnId: input.turnID,
          agentId: input.agentID,
        },
        details: { code: "STORAGE_FAILED" },
      })
    }
  }

  private async recordMissing(
    input: RequestSnapshotCaptureInput,
    runtimeManifest: string,
    createdAt: number,
    errorCode: RequestSnapshotErrorCode,
  ) {
    try {
      const durable = this.options.db.transaction(() => {
        const summary = this.repo.insertMissing({
          threadId: input.threadID,
          turnId: input.turnID,
          agentId: input.agentID,
          sessionId: input.sessionID,
          providerId: input.providerId,
          api: input.api,
          modelId: input.modelId,
          errorCode,
          runtimeManifest,
          createdAt,
        })
        return this.options.db.insertEvent(
          input.threadID,
          input.turnID,
          "runtime/request-snapshot/created",
          { threadId: input.threadID, snapshot: summary },
        )
      })
      await this.options.publish(durable)
    } catch {
      // 数据库本身不可写：只记录无 payload 的安全诊断，Provider 请求继续。
      this.options.logger?.warn("request-snapshot.record.failed", {
        context: {
          threadId: input.threadID,
          turnId: input.turnID,
          agentId: input.agentID,
        },
        details: { code: errorCode },
      })
    }
  }
}
