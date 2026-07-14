import { Schema } from "effect"
import { ModelRefSchema } from "./model"

export const PermissionModeSchema = Schema.Literals(["ask", "review", "full"])
export type PermissionMode = typeof PermissionModeSchema.Type

export const SendStrategySchema = Schema.Literals(["queue", "guide"])
export type SendStrategy = typeof SendStrategySchema.Type

export const TaskModeSchema = Schema.Literals(["chat", "plan"])
export type TaskMode = typeof TaskModeSchema.Type

export const AgentRoleSchema = Schema.Literals(["planner", "developer", "reviewer"])
export type AgentRole = typeof AgentRoleSchema.Type

export const WorkflowStageStatusSchema = Schema.Literals([
  "pending",
  "running",
  "waiting-question",
  "completed",
  "failed",
  "interrupted",
])
export type WorkflowStageStatus = typeof WorkflowStageStatusSchema.Type

export const WorkflowStageSchema = Schema.Struct({
  runID: Schema.String,
  role: AgentRoleSchema,
  attempt: Schema.Number,
  status: WorkflowStageStatusSchema,
  model: ModelRefSchema,
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
})
export type WorkflowStage = typeof WorkflowStageSchema.Type

export const ProposalStatusSchema = Schema.Literals(["pending", "reviewed", "rejected"])
export type ProposalStatus = typeof ProposalStatusSchema.Type

export const ProjectSettingsSchema = Schema.Struct({
  defaultModel: Schema.NullOr(ModelRefSchema),
  plannerModel: Schema.NullOr(ModelRefSchema),
  developerModel: Schema.NullOr(ModelRefSchema),
  reviewerModel: Schema.NullOr(ModelRefSchema),
})
export type ProjectSettings = typeof ProjectSettingsSchema.Type

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rootPath: Schema.String,
  lastOpenedAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  settings: ProjectSettingsSchema,
})
export type Project = typeof ProjectSchema.Type

export const ProposalSchema = Schema.Struct({
  id: Schema.String,
  runID: Schema.String,
  projectID: Schema.String,
  role: AgentRoleSchema,
  kind: Schema.Literals(["patch", "command"]),
  title: Schema.String,
  payload: Schema.Unknown,
  review: Schema.NullOr(Schema.String),
  status: ProposalStatusSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Proposal = typeof ProposalSchema.Type

export const RunStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting-permission",
  "waiting-question",
  "waiting-plan-confirmation",
  "completed",
  "failed",
  "stopped",
  "interrupted",
])
export type RunStatus = typeof RunStatusSchema.Type

export const SessionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Session = typeof SessionSchema.Type

export const RunSchema = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  sourceInputID: Schema.String,
  status: RunStatusSchema,
  mode: TaskModeSchema,
  model: ModelRefSchema,
  permissionMode: PermissionModeSchema,
  currentStage: Schema.NullOr(AgentRoleSchema),
  canContinueFromPlan: Schema.Boolean,
  stages: Schema.Array(WorkflowStageSchema),
  mergedInputIDs: Schema.Array(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  elapsedSeconds: Schema.Number,
  error: Schema.NullOr(Schema.String),
})
export type Run = typeof RunSchema.Type

export const InputSchema = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  runID: Schema.NullOr(Schema.String),
  content: Schema.String,
  strategy: SendStrategySchema,
  mode: TaskModeSchema,
  model: ModelRefSchema,
  permissionMode: PermissionModeSchema,
  state: Schema.Literals(["queued", "merged", "active", "completed", "cancelled"]),
  createdAt: Schema.Number,
})
export type Input = typeof InputSchema.Type

export const MessageSchema = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  runID: Schema.NullOr(Schema.String),
  role: Schema.Literals(["user", "assistant", "system"]),
  createdAt: Schema.Number,
})
export type Message = typeof MessageSchema.Type

export const ToolStateSchema = Schema.Literals([
  "pending",
  "waiting-permission",
  "running",
  "completed",
  "error",
  "interrupted",
])
export type ToolState = typeof ToolStateSchema.Type

export const EditedFileSchema = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  patch: Schema.optional(Schema.String),
})
export type EditedFile = typeof EditedFileSchema.Type

export const QuestionChoiceSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  recommended: Schema.Boolean,
})
export type QuestionChoice = typeof QuestionChoiceSchema.Type

export const TextPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("text"),
  placement: Schema.Literals(["process", "result"]),
  text: Schema.String,
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  createdAt: Schema.Number,
})
export type TextPart = typeof TextPartSchema.Type

export const ReasoningPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  createdAt: Schema.Number,
})
export type ReasoningPart = typeof ReasoningPartSchema.Type

export const ActivityCommandSchema = Schema.Struct({
  command: Schema.String,
  output: Schema.String,
  status: Schema.optional(Schema.Literals(["success", "running", "error", "interrupted"])),
  truncated: Schema.optional(Schema.Boolean),
})
export type ActivityCommand = typeof ActivityCommandSchema.Type

export const ActivityPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("activity"),
  activity: Schema.Literals(["context-compression", "file-edit", "build", "notice"]),
  title: Schema.String,
  detail: Schema.optional(Schema.String),
  commands: Schema.optional(Schema.Array(ActivityCommandSchema)),
  status: Schema.Literals(["running", "completed", "error", "interrupted"]),
  createdAt: Schema.Number,
})
export type ActivityPart = typeof ActivityPartSchema.Type

export const ToolPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("tool"),
  callID: Schema.String,
  tool: Schema.String,
  title: Schema.String,
  state: ToolStateSchema,
  input: Schema.Unknown,
  command: Schema.NullOr(Schema.String),
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
})
export type ToolPart = typeof ToolPartSchema.Type

export const PlanPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("plan"),
  title: Schema.String,
  markdown: Schema.String,
  version: Schema.Number,
  state: Schema.Literals(["draft", "awaiting-confirmation", "confirmed", "rejected"]),
  createdAt: Schema.Number,
})
export type PlanPart = typeof PlanPartSchema.Type

export const QuestionPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("question"),
  prompt: Schema.String,
  choices: Schema.Array(QuestionChoiceSchema),
  status: Schema.Literals(["pending", "answered", "ignored", "cancelled"]),
  answer: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})
export type QuestionPart = typeof QuestionPartSchema.Type

// The same durable record is exposed as a request while it is pending. Keeping
// one schema prevents the transport and renderer from drifting on choice IDs.
export const QuestionRequestSchema = QuestionPartSchema
export type QuestionRequest = typeof QuestionRequestSchema.Type

export const PatchPartSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  runID: Schema.String,
  type: Schema.Literal("patch"),
  files: Schema.Array(EditedFileSchema),
  totalAdditions: Schema.Number,
  totalDeletions: Schema.Number,
  createdAt: Schema.Number,
})
export type PatchPart = typeof PatchPartSchema.Type

export const PartSchema = Schema.Union([
  TextPartSchema,
  ReasoningPartSchema,
  ActivityPartSchema,
  ToolPartSchema,
  PlanPartSchema,
  QuestionPartSchema,
  PatchPartSchema,
])
export type Part = typeof PartSchema.Type

export const PermissionRequestSchema = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  runID: Schema.String,
  toolCallID: Schema.String,
  tool: Schema.String,
  command: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
  risk: Schema.Literals(["low", "medium", "high"]),
  reason: Schema.String,
  status: Schema.Literals(["pending", "allowed", "denied", "cancelled"]),
  createdAt: Schema.Number,
})
export type PermissionRequest = typeof PermissionRequestSchema.Type

export const SessionSnapshotSchema = Schema.Struct({
  session: SessionSchema,
  runs: Schema.Array(RunSchema),
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  parts: Schema.Array(PartSchema),
  permissions: Schema.Array(PermissionRequestSchema),
  proposals: Schema.Array(ProposalSchema),
})
export type SessionSnapshot = typeof SessionSnapshotSchema.Type
