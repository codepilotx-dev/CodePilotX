import { Schema } from "effect"

export const ToolingIDSchema = Schema.Literals(["git-bash", "ripgrep"])
export const ToolingPreferenceSchema = Schema.Literals(["managed", "system"])
export const ToolingSourceSchema = Schema.Literals(["managed", "system"])
export const ToolingPhaseSchema = Schema.Literals([
  "idle",
  "detecting",
  "downloading",
  "installing",
  "ready",
  "error",
  "cleanup-pending",
])

const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const ToolingStatusSchema = Schema.Struct({
  id: ToolingIDSchema,
  preference: ToolingPreferenceSchema,
  phase: ToolingPhaseSchema,
  activeSource: Schema.NullOr(ToolingSourceSchema),
  pinnedVersion: Schema.String,
  managed: Schema.Struct({
    installed: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
  }),
  system: Schema.Struct({
    available: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
    path: Schema.NullOr(Schema.String),
  }),
  progress: Schema.optional(Schema.Struct({
    receivedBytes: NonNegativeIntSchema,
    totalBytes: Schema.optional(NonNegativeIntSchema),
  })),
  error: Schema.optional(Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  })),
})

export type ToolingID = typeof ToolingIDSchema.Type
export type ToolingPreference = typeof ToolingPreferenceSchema.Type
export type ToolingSource = typeof ToolingSourceSchema.Type
export type ToolingPhase = typeof ToolingPhaseSchema.Type
export type ToolingStatus = typeof ToolingStatusSchema.Type
