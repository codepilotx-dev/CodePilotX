import { z } from "zod"
import {
  TASKBOARD_COMMENT_MAX_LENGTH,
  TASKBOARD_DESCRIPTION_MAX_LENGTH,
  TASKBOARD_LABELS_PER_TASK_MAX,
  TASKBOARD_TITLE_MAX_LENGTH,
} from "@codepilotx/shared/taskboard"
import { AgentError } from "../../domain"
import type { TaskboardService } from "../../taskboard/TaskboardService"
import type { TaskboardPlanningService } from "../../taskboard/TaskboardPlanningService"
import type { ToolContext, ToolDefinition } from "../ToolRegistry"

const taskId = z.string().uuid().optional()
const expectedVersion = z.number().int().positive()
const priority = z.enum(["none", "urgent", "high", "medium", "low"])
const labelIds = z.array(z.string().uuid())
  .max(TASKBOARD_LABELS_PER_TASK_MAX)

const identity = (context: ToolContext) => {
  const invocation = context.invocation
  if (!invocation) throw new AgentError("TASKBOARD_CONTEXT_REQUIRED", "任务看板工具缺少受信任的执行上下文", 403)
  return {
    threadId: invocation.threadID,
    turnId: invocation.turnID,
    agentId: invocation.agentID,
    operationId: `taskboard-tool:${invocation.toolCallID}`,
  }
}

const capabilities = (externalState: boolean) => ({
  filesystem: "none" as const,
  network: "none" as const,
  process: false,
  externalState,
  userInteraction: false,
})

const base = {
  allowedProfiles: ["main"] as const,
  approvalStrategy: "policy" as const,
  visibility: "deferred" as const,
  executionMode: "sequential" as const,
}

const readSchema = z.object({ taskId }).strict()
const createSchema = z.object({
  title: z.string().trim().min(1).max(TASKBOARD_TITLE_MAX_LENGTH),
  description: z.string().max(TASKBOARD_DESCRIPTION_MAX_LENGTH).optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
}).strict()
const updateSchema = z.object({
  taskId,
  expectedVersion,
  title: z.string().trim().min(1).max(TASKBOARD_TITLE_MAX_LENGTH).optional(),
  description: z.string().max(TASKBOARD_DESCRIPTION_MAX_LENGTH).optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
}).strict().refine(
  ({ taskId: _taskId, expectedVersion: _version, ...patch }) => Object.values(patch).some((value) => value !== undefined),
  "至少提供一个需要更新的字段",
)
const commentSchema = z.object({
  taskId,
  expectedVersion,
  body: z.string().trim().min(1).max(TASKBOARD_COMMENT_MAX_LENGTH),
}).strict()
const transitionSchema = z.object({
  taskId,
  expectedVersion,
  action: z.enum(["submit_review", "report_blocked"]),
  note: z.string().trim().min(1).max(TASKBOARD_COMMENT_MAX_LENGTH),
}).strict()

const planReadSchema = z.object({ taskId }).strict()
const planItemSchema = z.discriminatedUnion("kind", [
  z.object({
    clientId: z.string().trim().min(1),
    kind: z.literal("step"),
    title: z.string().trim().min(1).max(TASKBOARD_TITLE_MAX_LENGTH),
    description: z.string().max(TASKBOARD_DESCRIPTION_MAX_LENGTH).optional(),
    position: z.number().optional(),
  }).strict(),
  z.object({
    clientId: z.string().trim().min(1),
    kind: z.literal("task"),
    title: z.string().trim().min(1).max(TASKBOARD_TITLE_MAX_LENGTH),
    description: z.string().max(TASKBOARD_DESCRIPTION_MAX_LENGTH).optional(),
    status: z.enum(["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"]).optional(),
    priority: priority.optional(),
    labelIds: labelIds.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    position: z.number().optional(),
  }).strict(),
])
const planApplySchema = z.object({
  parentTaskId: z.string().uuid().optional(),
  expectedVersion,
  items: z.array(planItemSchema),
  dependencies: z.array(z.object({
    dependentClientId: z.string().trim().min(1),
    prerequisiteClientId: z.string().trim().min(1),
  }).strict()).optional(),
}).strict()
const stepUpdateSchema = z.object({
  itemId: z.string().uuid(),
  expectedVersion,
  title: z.string().trim().min(1).max(TASKBOARD_TITLE_MAX_LENGTH).optional(),
  description: z.string().max(TASKBOARD_DESCRIPTION_MAX_LENGTH).optional(),
  status: z.enum(["todo", "done", "skipped"]).optional(),
  skipReason: z.string().trim().min(1).nullable().optional(),
}).strict().refine(
  ({ itemId: _itemId, expectedVersion: _version, ...patch }) => Object.values(patch).some((value) => value !== undefined),
  "至少提供一个需要更新的字段",
)
const blockerCreateSchema = z.object({
  taskId,
  planItemId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(1).max(TASKBOARD_COMMENT_MAX_LENGTH),
}).strict()
const blockerResolveSchema = z.object({
  blockerId: z.string().uuid(),
  expectedVersion,
  resolution: z.string().trim().min(1).max(TASKBOARD_COMMENT_MAX_LENGTH),
}).strict()
const linkCurrentSchema = z.object({ taskId: z.string().uuid(), expectedVersion }).strict()

export const createTaskboardDefinitions = (
  service: TaskboardService,
  planning?: TaskboardPlanningService,
): readonly ToolDefinition<any, any>[] => {
  const definitions: ToolDefinition<any, any>[] = [
  {
    ...base,
    sdkName: "taskboard_read",
    name: "taskboard.read",
    schema: readSchema,
    description: "读取当前执行对话关联的任务看板任务，或按 taskId 读取同一项目任务。开始执行任务时应先调用此工具确认目标和当前版本。",
    capabilities: capabilities(false),
    allowedModes: ["chat", "plan"],
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string", format: "uuid" } },
      additionalProperties: false,
    },
    execute: (input, context) => service.agentRead({ ...identity(context), taskId: input.taskId }),
  },
  {
    ...base,
    sdkName: "taskboard_create",
    name: "taskboard.create",
    schema: createSchema,
    description: "在当前项目创建一条待立项任务。用于记录新发现的、独立于当前工作的后续事项；不会自动关联当前对话。",
    capabilities: capabilities(true),
    allowedModes: ["chat"],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: TASKBOARD_TITLE_MAX_LENGTH },
        description: { type: "string", maxLength: TASKBOARD_DESCRIPTION_MAX_LENGTH },
        priority: { type: "string", enum: ["none", "urgent", "high", "medium", "low"] },
        labelIds: { type: "array", maxItems: TASKBOARD_LABELS_PER_TASK_MAX, items: { type: "string", format: "uuid" } },
      },
      required: ["title"],
      additionalProperties: false,
    },
    execute: (input, context) => service.agentCreate({ ...identity(context), ...input }),
  },
  {
    ...base,
    sdkName: "taskboard_update",
    name: "taskboard.update",
    schema: updateSchema,
    description: "更新当前主执行对话关联任务的标题、描述、优先级或标签。提交验收和报告阻碍必须使用 taskboard_transition。",
    capabilities: capabilities(true),
    allowedModes: ["chat"],
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 1 },
        title: { type: "string", minLength: 1, maxLength: TASKBOARD_TITLE_MAX_LENGTH },
        description: { type: "string", maxLength: TASKBOARD_DESCRIPTION_MAX_LENGTH },
        priority: { type: "string", enum: ["none", "urgent", "high", "medium", "low"] },
        labelIds: { type: "array", maxItems: TASKBOARD_LABELS_PER_TASK_MAX, items: { type: "string", format: "uuid" } },
      },
      required: ["expectedVersion"],
      additionalProperties: false,
    },
    execute: (input, context) => service.agentUpdate({ ...identity(context), ...input }),
  },
  {
    ...base,
    sdkName: "taskboard_comment",
    name: "taskboard.comment",
    schema: commentSchema,
    description: "向当前关联任务追加 Agent 评论，用于记录验证结果、阻塞原因或需要用户关注的事项。",
    capabilities: capabilities(true),
    allowedModes: ["chat"],
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 1 },
        body: { type: "string", minLength: 1, maxLength: TASKBOARD_COMMENT_MAX_LENGTH },
      },
      required: ["expectedVersion", "body"],
      additionalProperties: false,
    },
    execute: (input, context) => service.agentComment({ ...identity(context), ...input }),
  },
  {
    ...base,
    sdkName: "taskboard_transition",
    name: "taskboard.transition",
    schema: transitionSchema,
    description: "原子提交任务验收或报告阻碍。说明、工作流状态、未读提醒和活动记录会一起提交；只有任务主执行对话可以调用。",
    capabilities: capabilities(true),
    allowedModes: ["chat"],
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 1 },
        action: { type: "string", enum: ["submit_review", "report_blocked"] },
        note: { type: "string", minLength: 1, maxLength: TASKBOARD_COMMENT_MAX_LENGTH },
      },
      required: ["expectedVersion", "action", "note"],
      additionalProperties: false,
    },
    execute: (input, context) => service.agentTransition({ ...identity(context), ...input }),
  },
  ]
  if (!planning) return definitions
  definitions.push(
    {
      ...base,
      sdkName: "taskboard_plan_read",
      name: "taskboard.plan.read",
      schema: planReadSchema,
      description: "读取当前关联任务或同项目指定任务的执行计划、父级路径、依赖、阻碍和聚合进度。规划前先调用以避免重复项。",
      capabilities: capabilities(false),
      allowedModes: ["chat", "plan"],
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
      execute: async (input, context) => {
        const trusted = identity(context)
        const result = await service.agentRead({ threadId: trusted.threadId, taskId: input.taskId })
        return planning.read(result.task.task.id)
      },
    },
    {
      ...base,
      sdkName: "taskboard_plan_apply",
      name: "taskboard.plan.apply",
      schema: planApplySchema,
      description: "经用户确认后，为当前关联任务原子创建一组轻量步骤、子任务和 allOf 依赖。整个批次要么全部成功，要么全部回滚。",
      capabilities: capabilities(true),
      allowedModes: ["chat"],
      inputSchema: {
        type: "object",
        properties: {
          parentTaskId: { type: "string", format: "uuid" },
          expectedVersion: { type: "integer", minimum: 1 },
          items: {
            type: "array",
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    clientId: { type: "string", minLength: 1 },
                    kind: { const: "step" },
                    title: { type: "string", minLength: 1, maxLength: TASKBOARD_TITLE_MAX_LENGTH },
                    description: { type: "string", maxLength: TASKBOARD_DESCRIPTION_MAX_LENGTH },
                    position: { type: "number" },
                  },
                  required: ["clientId", "kind", "title"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    clientId: { type: "string", minLength: 1 },
                    kind: { const: "task" },
                    title: { type: "string", minLength: 1, maxLength: TASKBOARD_TITLE_MAX_LENGTH },
                    description: { type: "string", maxLength: TASKBOARD_DESCRIPTION_MAX_LENGTH },
                    status: { type: "string", enum: ["backlog", "todo", "in_progress", "blocked", "in_review", "done", "canceled"] },
                    priority: { type: "string", enum: ["none", "urgent", "high", "medium", "low"] },
                    labelIds: { type: "array", maxItems: TASKBOARD_LABELS_PER_TASK_MAX, items: { type: "string", format: "uuid" } },
                    startDate: { type: ["string", "null"] },
                    dueDate: { type: ["string", "null"] },
                    position: { type: "number" },
                  },
                  required: ["clientId", "kind", "title"],
                  additionalProperties: false,
                },
              ],
            },
          },
          dependencies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dependentClientId: { type: "string", minLength: 1 },
                prerequisiteClientId: { type: "string", minLength: 1 },
              },
              required: ["dependentClientId", "prerequisiteClientId"],
              additionalProperties: false,
            },
          },
        },
        required: ["expectedVersion", "items"],
        additionalProperties: false,
      },
      execute: (input, context) => {
        const trusted = identity(context)
        const currentTaskId = service.agentCurrentTaskId(trusted.threadId)
        const parentTaskId = input.parentTaskId ?? currentTaskId
        if (parentTaskId !== currentTaskId) throw new AgentError("PERMISSION_DENIED", "只能规划当前会话直接关联的任务", 403)
        return planning.apply({ ...input, parentTaskId, operationId: trusted.operationId })
      },
    },
    {
      ...base,
      sdkName: "taskboard_step_update",
      name: "taskboard.step.update",
      schema: stepUpdateSchema,
      description: "更新当前关联任务中的轻量步骤；跳过步骤时必须提供 skipReason。",
      capabilities: capabilities(true),
      allowedModes: ["chat"],
      inputSchema: {
        type: "object",
        properties: {
          itemId: { type: "string", format: "uuid" },
          expectedVersion: { type: "integer", minimum: 1 },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["todo", "done", "skipped"] },
          skipReason: { type: ["string", "null"] },
        },
        required: ["itemId", "expectedVersion"],
        additionalProperties: false,
      },
      execute: (input, context) => {
        const trusted = identity(context)
        const currentTaskId = service.agentCurrentTaskId(trusted.threadId)
        if (planning.read(currentTaskId).snapshot.items.every(({ id }) => id !== input.itemId)) {
          throw new AgentError("PERMISSION_DENIED", "只能更新当前关联任务的步骤", 403)
        }
        const { itemId, expectedVersion, ...patch } = input
        return planning.updateStep({ operationId: trusted.operationId, itemId, expectedVersion, patch })
      },
    },
    {
      ...base,
      sdkName: "taskboard_blocker_create",
      name: "taskboard.blocker.create",
      schema: blockerCreateSchema,
      description: "为当前关联任务或其中的轻量步骤记录结构化阻碍，来源会话和 Turn 始终取可信 invocation。",
      capabilities: capabilities(true),
      allowedModes: ["chat"],
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", format: "uuid" },
          planItemId: { type: ["string", "null"], format: "uuid" },
          reason: { type: "string", minLength: 1 },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      execute: (input, context) => {
        const trusted = identity(context)
        const currentTaskId = service.agentCurrentTaskId(trusted.threadId)
        const targetTaskId = input.taskId ?? currentTaskId
        if (targetTaskId !== currentTaskId) throw new AgentError("PERMISSION_DENIED", "只能为当前关联任务记录阻碍", 403)
        return planning.createBlocker({
          ...input,
          taskId: targetTaskId,
          operationId: trusted.operationId,
          sourceThreadId: trusted.threadId,
          sourceTurnId: trusted.turnId,
        })
      },
    },
    {
      ...base,
      sdkName: "taskboard_blocker_resolve",
      name: "taskboard.blocker.resolve",
      schema: blockerResolveSchema,
      description: "解决当前关联任务的结构化阻碍，并记录非空解决说明。",
      capabilities: capabilities(true),
      allowedModes: ["chat"],
      inputSchema: {
        type: "object",
        properties: {
          blockerId: { type: "string", format: "uuid" },
          expectedVersion: { type: "integer", minimum: 1 },
          resolution: { type: "string", minLength: 1 },
        },
        required: ["blockerId", "expectedVersion", "resolution"],
        additionalProperties: false,
      },
      execute: (input, context) => {
        const trusted = identity(context)
        const currentTaskId = service.agentCurrentTaskId(trusted.threadId)
        if (planning.read(currentTaskId).snapshot.blockers.every(({ id }) => id !== input.blockerId)) {
          throw new AgentError("PERMISSION_DENIED", "只能解决当前关联任务的阻碍", 403)
        }
        return planning.resolveBlocker({ ...input, operationId: trusted.operationId })
      },
    },
    {
      ...base,
      sdkName: "taskboard_link_current",
      name: "taskboard.link.current",
      schema: linkCurrentSchema,
      description: "经用户确认后，把当前 invocation 会话关联到指定任务；不接受 threadId，关联后立即返回包含祖先的任务上下文。",
      capabilities: capabilities(true),
      approvalStrategy: "always-review",
      allowedModes: ["chat"],
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", format: "uuid" },
          expectedVersion: { type: "integer", minimum: 1 },
        },
        required: ["taskId", "expectedVersion"],
        additionalProperties: false,
      },
      execute: (input, context) => service.agentLinkCurrent({ ...identity(context), ...input }),
    },
  )
  return definitions
}
