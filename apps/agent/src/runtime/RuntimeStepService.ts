import { secretScrubber } from "../security/SecretScrubber"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import {
  RuntimeStepRepository,
  type RuntimeContextSnapshotRecord,
  type RuntimeInboxInput,
  type RuntimeStepRecord,
} from "../storage/repositories/runtime-step-repository"
import type { AgentLogger } from "../observability/AgentLogger"

export interface RuntimeStepStartResult {
  step: RuntimeStepRecord
  inputs: RuntimeInboxInput[]
}

export interface RuntimeContextSnapshotInput {
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
}

/**
 * 持久 step 状态机与 model-visible context invariant 的宿主侧服务。
 *
 * - claimAndStartStep：在同一事务内原子认领 inbox 输入、创建 running step、
 *   写 started durable event + outbox，提交后发布。
 * - persistContextSnapshot：Provider 请求前持久化规范化 semantic context；
 *   失败必须阻止请求（fail closed），prompt/JSON 写入前完成 SecretScrubber。
 */
export interface RuntimeStepService {
  claimAndStartStep(input: {
    threadId: string
    turnId: string
    runtimeManifestHash: string
    startedAt: number
  }): Promise<RuntimeStepStartResult>
  completeStep(stepId: string, stopReason?: string | null): Promise<void>
  failStep(stepId: string): Promise<void>
  interruptStep(stepId: string): Promise<void>
  persistContextSnapshot(input: RuntimeContextSnapshotInput): Promise<RuntimeContextSnapshotRecord>
  recoverInterruptedSteps(): Promise<Array<{ threadId: string; turnId: string; stepId: string; ordinal: number }>>
}

export class RuntimeStepServiceImpl implements RuntimeStepService {
  private readonly repo: RuntimeStepRepository

  constructor(private readonly options: {
    db: AgentDatabase
    publish: (event: ReturnType<AgentDatabase["insertEvent"]>) => Promise<void>
    logger?: AgentLogger
  }) {
    this.repo = new RuntimeStepRepository(options.db)
  }

  async claimAndStartStep(input: {
    threadId: string
    turnId: string
    runtimeManifestHash: string
    startedAt: number
  }): Promise<RuntimeStepStartResult> {
    const durable = this.options.db.transaction(() => {
      const step = this.repo.insertStep({
        threadId: input.threadId,
        turnId: input.turnId,
        claimedInputIds: [],
        runtimeManifestHash: input.runtimeManifestHash,
        startedAt: input.startedAt,
      })
      const inputs = this.repo.claimInputs(input.threadId, input.turnId, step.id)
      const events = [this.options.db.insertEvent(
        input.threadId,
        input.turnId,
        "runtime/step-started",
        {
          threadId: input.threadId,
          turnId: input.turnId,
          stepId: step.id,
          ordinal: step.ordinal,
          claimedInputIds: inputs.map((entry) => entry.id),
          startedAt: step.startedAt,
        },
      )]
      return { step, inputs, events }
    })
    for (const event of durable.events) await this.options.publish(event)
    return { step: durable.step, inputs: durable.inputs }
  }

  async completeStep(stepId: string, stopReason?: string | null): Promise<void> {
    const row = this.options.db.transaction(() => {
      this.repo.completeStep(stepId, Date.now(), stopReason ?? null)
      this.repo.consumeClaimedInputs(stepId)
      const step = this.options.db.sqlite.query(`
        SELECT thread_id, turn_id, ordinal FROM runtime_steps WHERE id = ?
      `).get(stepId) as { thread_id: string; turn_id: string; ordinal: number } | null
      if (!step) return null
      return this.options.db.insertEvent(
        step.thread_id,
        step.turn_id,
        "runtime/step-completed",
        {
          threadId: step.thread_id,
          turnId: step.turn_id,
          stepId,
          ordinal: step.ordinal,
          completedAt: Date.now(),
          ...(stopReason ? { stopReason } : {}),
        },
      )
    })
    if (row) await this.options.publish(row)
  }

  async failStep(stepId: string): Promise<void> {
    const row = this.options.db.transaction(() => {
      this.repo.failStep(stepId, Date.now())
      const step = this.options.db.sqlite.query(`
        SELECT thread_id, turn_id, ordinal FROM runtime_steps WHERE id = ?
      `).get(stepId) as { thread_id: string; turn_id: string; ordinal: number } | null
      if (!step) return null
      this.repo.releaseUncommittedClaims(step.thread_id, step.turn_id)
      return this.options.db.insertEvent(
        step.thread_id,
        step.turn_id,
        "runtime/step-failed",
        {
          threadId: step.thread_id,
          turnId: step.turn_id,
          stepId,
          ordinal: step.ordinal,
          errorCode: "STEP_FAILED",
        },
      )
    })
    if (row) await this.options.publish(row)
  }

  async interruptStep(stepId: string): Promise<void> {
    const row = this.options.db.transaction(() => {
      this.repo.interruptStep(stepId, Date.now())
      const step = this.options.db.sqlite.query(`
        SELECT thread_id, turn_id, ordinal FROM runtime_steps WHERE id = ?
      `).get(stepId) as { thread_id: string; turn_id: string; ordinal: number } | null
      if (!step) return null
      this.repo.releaseUncommittedClaims(step.thread_id, step.turn_id)
      return this.options.db.insertEvent(
        step.thread_id,
        step.turn_id,
        "runtime/step-interrupted",
        {
          threadId: step.thread_id,
          turnId: step.turn_id,
          stepId,
          ordinal: step.ordinal,
        },
      )
    })
    if (row) await this.options.publish(row)
  }

  async persistContextSnapshot(input: RuntimeContextSnapshotInput): Promise<RuntimeContextSnapshotRecord> {
    // prompt/JSON 写入前完成 SecretScrubber；失败阻止 Provider 请求。
    const promptText = secretScrubber.scrubText(input.promptText)
    const toolCatalogJson = secretScrubber.scrubText(input.toolCatalogJson)
    const runtimeManifestJson = secretScrubber.scrubText(input.runtimeManifestJson)
    return this.options.db.transaction(() => this.repo.insertContextSnapshot({
      threadId: input.threadId,
      turnId: input.turnId,
      stepId: input.stepId,
      attemptOrdinal: input.attemptOrdinal,
      piSessionId: input.piSessionId,
      piLeafEntryId: input.piLeafEntryId,
      messageEntryIds: input.messageEntryIds,
      messageDigest: input.messageDigest,
      promptText,
      toolCatalogJson,
      runtimeManifestJson,
      createdAt: Date.now(),
    }))
  }

  async recoverInterruptedSteps() {
    return this.options.db.transaction(() => this.repo.recoverInterruptedSteps())
  }
}
