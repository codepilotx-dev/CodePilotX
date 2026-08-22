import { Schema } from "effect"
import { TurnStatusSchema } from "./thread/schema"

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const PositionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const TASKBOARD_POSITION_GAP = 1_024
export const TASKBOARD_TITLE_MAX_LENGTH = 200
export const TASKBOARD_DESCRIPTION_MAX_LENGTH = 65_536
export const TASKBOARD_COMMENT_MAX_LENGTH = 32_768
export const TASKBOARD_LABEL_MAX_LENGTH = 40
export const TASKBOARD_LABELS_PER_TASK_MAX = 20

export const TaskboardStatusSchema = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
])
export type TaskboardStatus = typeof TaskboardStatusSchema.Type

export const TaskboardPrioritySchema = Schema.Literals([
  "none",
  "urgent",
  "high",
  "medium",
  "low",
])
export type TaskboardPriority = typeof TaskboardPrioritySchema.Type

export const TaskboardThreadRoleSchema = Schema.Literals(["primary", "supporting"])
export type TaskboardThreadRole = typeof TaskboardThreadRoleSchema.Type

export const TaskboardActorSchema = Schema.Literals(["user", "agent", "system"])
export type TaskboardActor = typeof TaskboardActorSchema.Type

export const TaskboardWorktreeStatusSchema = Schema.Literals([
  "creating",
  "ready",
  "ready-with-setup-error",
  "deleting",
  "cleaned",
  "restoring",
  "restore-conflict",
])
export type TaskboardWorktreeStatus = typeof TaskboardWorktreeStatusSchema.Type
export const ManagedWorktreeStatusSchema = TaskboardWorktreeStatusSchema
export type ManagedWorktreeStatus = TaskboardWorktreeStatus

export const TaskboardLabelSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  projectId: NonEmptyStringSchema,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(TASKBOARD_LABEL_MAX_LENGTH)),
  normalizedName: NonEmptyStringSchema,
  version: VersionSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type TaskboardLabel = typeof TaskboardLabelSchema.Type

const TaskboardTaskFields = {
  id: NonEmptyStringSchema,
  projectId: NonEmptyStringSchema,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(TASKBOARD_TITLE_MAX_LENGTH)),
  description: Schema.String.check(Schema.isMaxLength(TASKBOARD_DESCRIPTION_MAX_LENGTH)),
  status: TaskboardStatusSchema,
  priority: TaskboardPrioritySchema,
  position: PositionSchema,
  version: VersionSchema,
  labels: Schema.Array(TaskboardLabelSchema).check(Schema.isMaxLength(TASKBOARD_LABELS_PER_TASK_MAX)),
  archivedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
} as const

export const TaskboardTaskSchema = Schema.Struct(TaskboardTaskFields)
export type TaskboardTask = typeof TaskboardTaskSchema.Type

export const TaskboardThreadAttentionSchema = Schema.Literals([
  "idle",
  "running",
  "needs_input",
  "completed",
])
export type TaskboardThreadAttention = typeof TaskboardThreadAttentionSchema.Type

export const TaskboardThreadExecutionSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("local"),
    branchName: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    worktreeId: NonEmptyStringSchema,
    branchName: Schema.NullOr(Schema.String),
    status: TaskboardWorktreeStatusSchema,
  }),
])
export type TaskboardThreadExecution = typeof TaskboardThreadExecutionSchema.Type

export const TaskboardThreadLinkSchema = Schema.Struct({
  taskId: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  role: TaskboardThreadRoleSchema,
  title: Schema.String,
  latestTurnStatus: Schema.NullOr(TurnStatusSchema),
  pendingPlanApproval: Schema.optional(Schema.Boolean),
  attention: TaskboardThreadAttentionSchema,
  execution: TaskboardThreadExecutionSchema,
  version: VersionSchema,
  linkedAt: Schema.Number,
})
export type TaskboardThreadLink = typeof TaskboardThreadLinkSchema.Type

export const TaskboardCommentSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  taskId: NonEmptyStringSchema,
  body: Schema.String.check(Schema.isMaxLength(TASKBOARD_COMMENT_MAX_LENGTH)),
  author: Schema.Literals(["user", "agent"]),
  sourceThreadId: Schema.NullOr(NonEmptyStringSchema),
  version: VersionSchema,
  deletedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type TaskboardComment = typeof TaskboardCommentSchema.Type

export const TaskboardActivityKindSchema = Schema.Literals([
  "task_created",
  "task_updated",
  "task_moved",
  "task_archived",
  "task_restored",
  "comment_created",
  "comment_updated",
  "comment_deleted",
  "thread_linked",
  "thread_unlinked",
  "primary_changed",
  "label_created",
  "label_updated",
  "label_deleted",
  "execution_started",
])
export type TaskboardActivityKind = typeof TaskboardActivityKindSchema.Type

export const TaskboardActivitySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  taskId: NonEmptyStringSchema,
  kind: TaskboardActivityKindSchema,
  actor: TaskboardActorSchema,
  sourceThreadId: Schema.NullOr(NonEmptyStringSchema),
  data: Schema.Record(Schema.String, Schema.Json),
  createdAt: Schema.Number,
})
export type TaskboardActivity = typeof TaskboardActivitySchema.Type

export const TaskboardTaskSummarySchema = Schema.Struct({
  ...TaskboardTaskFields,
  threads: Schema.Array(TaskboardThreadLinkSchema),
})
export type TaskboardTaskSummary = typeof TaskboardTaskSummarySchema.Type

export const TaskboardTaskDetailsSchema = Schema.Struct({
  task: TaskboardTaskSchema,
  threads: Schema.Array(TaskboardThreadLinkSchema),
  comments: Schema.Array(TaskboardCommentSchema),
  activities: Schema.Array(TaskboardActivitySchema),
})
export type TaskboardTaskDetails = typeof TaskboardTaskDetailsSchema.Type

export const TaskboardWorkflowStatusSchema = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "canceled",
])
export type TaskboardWorkflowStatus = typeof TaskboardWorkflowStatusSchema.Type

export const TaskboardWorkflowDateSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
)
export type TaskboardWorkflowDate = typeof TaskboardWorkflowDateSchema.Type

export const TaskboardWorkflowDatePresetSchema = Schema.Literals([
  "overdue",
  "due_today",
  "due_7_days",
  "no_due_date",
])
export type TaskboardWorkflowDatePreset = typeof TaskboardWorkflowDatePresetSchema.Type

export const TaskboardWorkflowSortSchema = Schema.Literals([
  "position",
  "due_date",
  "updated_at",
])
export type TaskboardWorkflowSort = typeof TaskboardWorkflowSortSchema.Type

export const TaskboardWorkflowAttentionReasonSchema = Schema.Literals([
  "review_requested",
  "blocked",
  "agent_comment",
  "execution_attention",
])
export type TaskboardWorkflowAttentionReason = typeof TaskboardWorkflowAttentionReasonSchema.Type

export const TaskboardWorkflowTransitionActionSchema = Schema.Literals([
  "submit_review",
  "report_blocked",
  "return_work",
  "accept",
  "cancel",
  "manual_move",
])
export type TaskboardWorkflowTransitionAction = typeof TaskboardWorkflowTransitionActionSchema.Type

export const TaskboardWorkflowStartModeSchema = Schema.Literals([
  "continue_primary",
  "new_primary",
])
export type TaskboardWorkflowStartMode = typeof TaskboardWorkflowStartModeSchema.Type

export const TaskboardWorkflowAttentionSchema = Schema.Struct({
  unread: Schema.Boolean,
  unreadAt: Schema.NullOr(Schema.Number),
  readAt: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(TaskboardWorkflowAttentionReasonSchema),
})
export type TaskboardWorkflowAttention = typeof TaskboardWorkflowAttentionSchema.Type

const TaskboardWorkflowTaskFields = {
  id: NonEmptyStringSchema,
  projectId: NonEmptyStringSchema,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(TASKBOARD_TITLE_MAX_LENGTH)),
  description: Schema.String.check(Schema.isMaxLength(TASKBOARD_DESCRIPTION_MAX_LENGTH)),
  status: TaskboardWorkflowStatusSchema,
  priority: TaskboardPrioritySchema,
  position: PositionSchema,
  version: VersionSchema,
  labels: Schema.Array(TaskboardLabelSchema).check(Schema.isMaxLength(TASKBOARD_LABELS_PER_TASK_MAX)),
  archivedAt: Schema.NullOr(Schema.Number),
  startDate: Schema.NullOr(TaskboardWorkflowDateSchema),
  dueDate: Schema.NullOr(TaskboardWorkflowDateSchema),
  attention: TaskboardWorkflowAttentionSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
} as const

export const TaskboardWorkflowTaskSchema = Schema.Struct(TaskboardWorkflowTaskFields)
export type TaskboardWorkflowTask = typeof TaskboardWorkflowTaskSchema.Type

export const TaskboardWorkflowTaskSummarySchema = Schema.Struct({
  ...TaskboardWorkflowTaskFields,
  threads: Schema.Array(TaskboardThreadLinkSchema),
})
export type TaskboardWorkflowTaskSummary = typeof TaskboardWorkflowTaskSummarySchema.Type

export const TaskboardWorkflowTaskDetailsSchema = Schema.Struct({
  task: TaskboardWorkflowTaskSchema,
  threads: Schema.Array(TaskboardThreadLinkSchema),
  comments: Schema.Array(TaskboardCommentSchema),
  activities: Schema.Array(TaskboardActivitySchema),
})
export type TaskboardWorkflowTaskDetails = typeof TaskboardWorkflowTaskDetailsSchema.Type

export const TaskboardWorkflowThreadCandidateSchema = Schema.Struct({
  threadId: NonEmptyStringSchema,
  projectId: NonEmptyStringSchema,
  title: Schema.String,
  latestTurnStatus: Schema.NullOr(TurnStatusSchema),
  pendingPlanApproval: Schema.Boolean,
  updatedAt: Schema.Number,
})
export type TaskboardWorkflowThreadCandidate = typeof TaskboardWorkflowThreadCandidateSchema.Type

export const TaskboardWorkflowThreadIneligibleReasonSchema = Schema.Literals([
  "archived",
  "project_mismatch",
  "already_linked",
  "active",
  "pending_plan",
  "not_main",
])
export type TaskboardWorkflowThreadIneligibleReason = typeof TaskboardWorkflowThreadIneligibleReasonSchema.Type

export const TaskboardWorkflowThreadLookupSchema = Schema.Struct({
  threadId: NonEmptyStringSchema,
  taskId: Schema.NullOr(NonEmptyStringSchema),
  eligible: Schema.Boolean,
  ineligibleReason: Schema.NullOr(TaskboardWorkflowThreadIneligibleReasonSchema),
})
export type TaskboardWorkflowThreadLookup = typeof TaskboardWorkflowThreadLookupSchema.Type

export const normalizeTaskboardLabelName = (name: string) => name.trim().normalize("NFKC").toLocaleLowerCase("en-US")

export const taskboardAttentionFromTurnStatus = (
  status: typeof TurnStatusSchema.Type | null,
  pendingPlanApproval = false,
): TaskboardThreadAttention => {
  if (status === "running" || status === "queued" || status === "waiting-subagents") return "running"
  if (status === "waiting-permission" || status === "waiting-question") return "needs_input"
  if (pendingPlanApproval) return "needs_input"
  if (status === "completed" || status === "failed" || status === "stopped" || status === "interrupted" || status === "cancelled") return "completed"
  return "idle"
}
