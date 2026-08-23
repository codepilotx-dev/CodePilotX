import { z } from "zod"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { PiModelService } from "../provider/pi"
import type { ConfigService } from "../config/ConfigService"
import { AgentError } from "../domain"
import { generatePiObject } from "../provider/pi/PiStructuredOutput"
import { resolveAuxiliaryPiModel } from "../provider/pi/PiAuxiliaryModelResolver"
import type { TaskContextService } from "./TaskContextService"

const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), section: z.enum(["objective", "code_map", "decision", "finding", "progress", "validation", "risk"]), title: z.string().min(1).max(120), content: z.string().min(1).max(2_000) }).strict(),
  z.object({ op: z.literal("replace"), entryId: z.string().uuid(), expectedEntryVersion: z.number().int().positive(), title: z.string().min(1).max(120), content: z.string().min(1).max(2_000) }).strict(),
  z.object({ op: z.literal("retire"), entryId: z.string().uuid(), expectedEntryVersion: z.number().int().positive(), reason: z.string().min(1).max(2_000) }).strict(),
])

export class TaskContextSummaryService {
  constructor(private readonly db: AgentDatabase, private readonly models: PiModelService, private readonly config: ConfigService, private readonly context: TaskContextService) {}

  async preview(taskId: string) {
    const task = this.db.sqlite.query("SELECT project_id FROM taskboard_tasks WHERE id = ?").get(taskId) as { project_id: string } | null
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    const current = this.context.read(taskId, { includeEvidence: true, includeUnverified: true, limit: 200 })
    const selected = await resolveAuxiliaryPiModel({ db: this.db, models: this.models, configService: this.config, projectId: task.project_id })
    if (!selected) throw new AgentError("TASKBOARD_AI_MODEL_UNAVAILABLE", "没有可用于更新任务上下文的模型", 409)
    const batches: typeof current.evidence[] = []
    let batch: typeof current.evidence = []
    let length = 0
    for (const evidence of current.evidence) {
      const size = JSON.stringify(evidence).length
      if (batch.length && length + size > 30_000) { batches.push(batch); batch = []; length = 0 }
      batch.push(evidence); length += size
    }
    if (batch.length || !batches.length) batches.push(batch)
    let changes: z.output<typeof changeSchema>[] = []
    for (const evidence of batches) {
      const payload = JSON.stringify({ entries: current.entries, evidence, candidateChanges: changes }).slice(0, 40_000)
      const generated = await generatePiObject({ models: this.models.pi, model: selected.model, schema: z.object({ changes: z.array(changeSchema).max(10) }), schemaName: "task_context_changes", system: "根据任务证据增量维护共享上下文，并把 candidateChanges 折叠成最终 patch。只保留确定、可复用、无凭据的信息；未验证证据不得形成肯定结论。路径写成项目相对路径。不要保存完整命令输出或原始异常。", prompt: `<untrusted_task_context>${payload}</untrusted_task_context>` })
      changes = generated.changes
    }
    return this.context.createProposal({ taskId, baseContextRevision: current.snapshot.contextRevision, throughEvidenceRevision: current.snapshot.evidenceRevision, changes, modelRef: `${selected.ref.providerID}/${selected.ref.id}` })
  }
}
