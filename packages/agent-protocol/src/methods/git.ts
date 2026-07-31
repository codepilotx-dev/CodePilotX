import { AgentThread } from "@codepilotx/shared"
import { Schema } from "effect"
import { defineMethod, type MethodMap } from "../wire/definition"
import { OpaqueIDSchema } from "../wire/primitives"
import { ReviewGitStatusSchema } from "./review"

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))

const GitWorkspaceErrors = [
  "PROJECT_NOT_FOUND",
  "REPOSITORY_NOT_FOUND",
  "GIT_BRANCH_REQUIRED",
  "GIT_BRANCH_INVALID",
  "GIT_BRANCH_EXISTS",
  "GIT_BRANCH_NOT_FOUND",
  "GIT_CHECKOUT_CONFLICT",
  "GIT_STATUS_FAILED",
  "GIT_COMMAND_FAILED",
  "GIT_OUTPUT_TOO_LARGE",
  "GIT_OUTPUT_ENCODING_INVALID",
  "PATH_DENIED",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const

const GitWorkspaceResultSchema = Schema.Struct({
  project: AgentThread.ProjectSchema,
  status: ReviewGitStatusSchema,
})

export const GitRpcMethods = {
  "git/branch/create": defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      branchName: NonEmptyStringSchema,
      startPoint: Schema.optional(NonEmptyStringSchema),
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: "git.workspace.v1",
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  "git/branch/checkout": defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      branchName: NonEmptyStringSchema,
    }),
    result: GitWorkspaceResultSchema,
    errors: GitWorkspaceErrors,
    capability: "git.workspace.v1",
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
