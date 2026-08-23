import { z } from "zod"
import {
  TASK_CONTEXT_CONTENT_MAX_LENGTH,
  TASK_CONTEXT_PUBLISH_MAX_CHANGES,
  TASK_CONTEXT_TITLE_MAX_LENGTH,
} from "@codepilotx/shared/taskboard"
import { AgentError } from "../../domain"
import type { TaskContextService } from "../../task-context/TaskContextService"
import type { ToolContext, ToolDefinition } from "../ToolRegistry"

const sections = z.enum(["objective", "code_map", "decision", "finding", "progress", "validation", "risk"])
const change = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), section: sections, title: z.string().trim().min(1).max(TASK_CONTEXT_TITLE_MAX_LENGTH), content: z.string().trim().min(1).max(TASK_CONTEXT_CONTENT_MAX_LENGTH) }).strict(),
  z.object({ op: z.literal("replace"), entryId: z.string().uuid(), expectedEntryVersion: z.number().int().positive(), title: z.string().trim().min(1).max(TASK_CONTEXT_TITLE_MAX_LENGTH), content: z.string().trim().min(1).max(TASK_CONTEXT_CONTENT_MAX_LENGTH) }).strict(),
  z.object({ op: z.literal("retire"), entryId: z.string().uuid(), expectedEntryVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(TASK_CONTEXT_CONTENT_MAX_LENGTH) }).strict(),
])

const invocation = (context: ToolContext) => {
  if (!context.invocation) throw new AgentError("TASKBOARD_CONTEXT_REQUIRED", "任务上下文工具缺少受信任的执行上下文", 403)
  return context.invocation
}

const common = {
  allowedProfiles: ["main", "default", "explorer", "worker"] as const,
  approvalStrategy: "policy" as const,
  executionMode: "sequential" as const,
}

export const createTaskContextDefinitions = (service: TaskContextService): readonly ToolDefinition<any, any>[] => [
  {
    ...common,
    sdkName: "task_context_read",
    name: "task_context.read",
    description: "按需读取当前任务的共享上下文条目和待处理证据；需要延续长期任务决策时可包含祖先任务。任务由受信任的当前会话解析，不能指定其他 taskId。",
    schema: z.object({ sections: z.array(sections).max(7).optional(), includeEvidence: z.boolean().optional(), includeUnverified: z.boolean().optional(), includeAncestors: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
    capabilities: { filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false },
    allowedModes: ["chat", "plan"],
    visibility: "eager",
    inputSchema: { type: "object", properties: { sections: { type: "array", maxItems: 7, items: { type: "string", enum: sections.options } }, includeEvidence: { type: "boolean" }, includeUnverified: { type: "boolean" }, includeAncestors: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 200 }, offset: { type: "integer", minimum: 0 } }, additionalProperties: false },
    execute: (input, context) => Promise.resolve(service.readForThread(invocation(context).threadID, input)),
  },
  {
    ...common,
    sdkName: "task_context_publish",
    name: "task_context.publish",
    description: "将确定、可复用的结论发布到当前任务共享上下文。使用乐观版本；冲突后必须重新读取。",
    schema: z.object({ expectedContextRevision: z.number().int().positive(), changes: z.array(change).min(1).max(TASK_CONTEXT_PUBLISH_MAX_CHANGES) }).strict(),
    capabilities: { filesystem: "none", network: "none", process: false, externalState: true, userInteraction: false },
    allowedModes: ["chat"],
    visibility: "eager",
    inputSchema: { type: "object", properties: { expectedContextRevision: { type: "integer", minimum: 1 }, changes: { type: "array", minItems: 1, maxItems: TASK_CONTEXT_PUBLISH_MAX_CHANGES, items: { type: "object" } } }, required: ["expectedContextRevision", "changes"], additionalProperties: false },
    execute: async (input, context) => {
      const trusted = invocation(context)
      const owner = service.resolveTaskForThread(trusted.threadID)
      if (!owner) throw new AgentError("TASKBOARD_CONTEXT_REQUIRED", "当前会话未关联任务上下文", 403)
      const result = service.publish({ taskId: owner.taskId, expectedContextRevision: input.expectedContextRevision, changes: input.changes, sourceKind: "agent", sourceThreadId: trusted.threadID, sourceTurnId: trusted.turnID })
      await service.broadcast(result.event)
      if (result.rollupEvent) await service.broadcast(result.rollupEvent)
      return result.snapshot
    },
  },
]
