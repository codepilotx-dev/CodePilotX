import { Schema } from "effect"

export const PlanApprovalSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  planItemId: Schema.String,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.Literals(["pending", "implemented", "feedback", "closed", "superseded"]),
  title: Schema.String,
  markdown: Schema.String,
  nextTurnId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  resolvedAt: Schema.NullOr(Schema.Number),
})
export type PlanApproval = typeof PlanApprovalSchema.Type
