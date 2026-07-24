import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"
import { PermissionConfigSchema } from "./permission"
import { SendStrategySchema, TaskModeSchema, ThreadSettingsSchema } from "./settings"

export const ProjectSettingsSchema = Schema.Struct({
  defaultModel: Schema.NullOr(Model.Ref),
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

export const TurnStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting-permission",
  "waiting-question",
  "waiting-plan-confirmation",
  "waiting-subagents",
  "completed",
  "failed",
  "stopped",
  "interrupted",
  "cancelled",
])
export type TurnStatus = typeof TurnStatusSchema.Type

export const ThreadWorkspaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project"),
    projectID: Schema.String,
    workspaceRoot: Schema.String,
    cwd: Schema.String,
    outputDirectory: Schema.Null,
  }),
  Schema.Struct({
    kind: Schema.Literal("projectless"),
    projectID: Schema.Null,
    workspaceRoot: Schema.String,
    cwd: Schema.String,
    outputDirectory: Schema.String,
  }),
])
export type ThreadWorkspace = typeof ThreadWorkspaceSchema.Type

export const ThreadSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  workspace: Schema.optional(ThreadWorkspaceSchema),
  settings: ThreadSettingsSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Thread = typeof ThreadSchema.Type

export const ThreadListItemSchema = Schema.Struct({
  id: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  workspace: Schema.optional(ThreadWorkspaceSchema),
  title: Schema.String,
  preview: Schema.NullOr(Schema.String),
  firstUserMessage: Schema.NullOr(Schema.String),
  messageCount: Schema.Number,
  latestTurnStatus: Schema.NullOr(TurnStatusSchema),
  archivedAt: Schema.NullOr(Schema.Number),
  settings: ThreadSettingsSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ThreadListItem = typeof ThreadListItemSchema.Type

export const TurnSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  sourceInputID: Schema.String,
  status: TurnStatusSchema,
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  rootAgentId: Schema.String,
  canContinueFromPlan: Schema.Boolean,
  mergedInputIDs: Schema.Array(Schema.String),
  queuePosition: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  elapsedSeconds: Schema.Number,
  error: Schema.NullOr(Schema.String),
})
export type Turn = typeof TurnSchema.Type
