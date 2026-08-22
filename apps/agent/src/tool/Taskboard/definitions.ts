import { z } from "zod"
import {
  TASKBOARD_COMMENT_MAX_LENGTH,
  TASKBOARD_DESCRIPTION_MAX_LENGTH,
  TASKBOARD_LABELS_PER_TASK_MAX,
  TASKBOARD_TITLE_MAX_LENGTH,
} from "@codepilotx/shared/taskboard"
import { AgentError } from "../../domain"
import type { TaskboardService } from "../../taskboard/TaskboardService"
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

export const createTaskboardDefinitions = (
  service: TaskboardService,
): readonly ToolDefinition<any, any>[] => [
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
