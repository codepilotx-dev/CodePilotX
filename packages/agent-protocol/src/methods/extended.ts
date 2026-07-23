import { Connection, Credential, Integration, Model, Provider } from "@codepilotx/model-schema"
import {
  ModelCatalogSchema,
  PermissionConfigSchema,
  SubagentProjectionSchema,
  SubagentRunSchema,
  SubagentTaskSchema,
  SubagentWorkspaceSchema,
  ThreadSnapshotSchema,
} from "@codepilotx/shared"
import { Schema } from "effect"
import { defineMethod, type MethodMap } from "../definition"
import {
  AdmissionSchema,
  CursorSchema,
  JsonValueSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  SequenceSchema,
  StreamPositionSchema,
  TimestampSchema,
} from "../wire"

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const AttachmentIDsSchema = Schema.Array(OpaqueIDSchema).check(Schema.isMaxLength(20))

const SubagentCapabilitiesSchema = Schema.Struct({
  canSend: Schema.Boolean,
  canStop: Schema.Boolean,
  canRetry: Schema.Boolean,
  canApplyWorktree: Schema.Boolean,
  canDiscardWorktree: Schema.Boolean,
  canRestoreWorkspace: Schema.Boolean,
})

const SubagentAdmissionSchema = Schema.Struct({
  ...AdmissionSchema.fields,
  taskId: OpaqueIDSchema,
  runId: OpaqueIDSchema,
})

const SubagentTerminalResultSchema = Schema.Struct({
  task: SubagentTaskSchema,
  run: SubagentRunSchema,
})

const DiffByteLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))
const DiffContextLinesSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))

const workspaceMutationResult = <const Action extends "apply" | "discard" | "restore">(action: Action) =>
  Schema.Struct({
    result: Schema.Struct({
      taskId: OpaqueIDSchema,
      action: Schema.Literal(action),
      outcome: Schema.Literals(["changed", "unchanged"]),
      workspace: SubagentWorkspaceSchema,
    }),
  })

const CatalogResultSchema = Schema.Struct({
  ...ModelCatalogSchema.fields,
  catalogVersion: SequenceSchema,
  total: Schema.optional(NonNegativeIntSchema),
  nextCursor: Schema.optional(CursorSchema),
})

const ProviderListResultSchema = Schema.Struct({
  providers: Schema.Array(Provider.Info),
  defaultModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
  catalogVersion: SequenceSchema,
})

const ModelPageLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))

const SettingsVersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// Public headers deliberately exclude names whose values must use the
// write-only sensitiveHeaders channel below.
const PublicHeaderNameSchema = Schema.String.check(
  Schema.isPattern(/^(?!(?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$)[!#$%&'*+.^_`|~0-9A-Za-z-]+$/i),
)
const PublicHeadersSchema = Schema.Record(PublicHeaderNameSchema, Schema.String)
const SensitiveHeaderNameSchema = Schema.Literals([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
])
const SensitiveHeaderWriteSchema = Schema.Struct({
  name: SensitiveHeaderNameSchema,
  value: Schema.NullOr(NonEmptyStringSchema),
})

const ProviderPublicSettingsSchema = Schema.Struct({
  name: Schema.optional(NonEmptyStringSchema),
  disabled: Schema.optional(Schema.Boolean),
  api: Schema.optional(NonEmptyStringSchema),
  npm: Schema.optional(NonEmptyStringSchema),
  env: Schema.optional(Schema.Array(NonEmptyStringSchema)),
  options: Schema.optional(JsonValueSchema),
  body: Schema.optional(JsonValueSchema),
  headers: Schema.optional(PublicHeadersSchema),
  whitelist: Schema.optional(Schema.Array(Model.ID)),
  blacklist: Schema.optional(Schema.Array(Model.ID)),
  models: Schema.optional(JsonValueSchema),
})

const ProviderSummarySchema = Schema.Struct({
  id: Provider.ID,
  name: Schema.String,
  disabled: Schema.Boolean,
  integrationId: Schema.optional(Integration.ID),
  configured: Schema.Boolean,
  modelCount: NonNegativeIntSchema,
})

const ProviderTestResultSchema = Schema.Union([
  Schema.Struct({
    providerId: Provider.ID,
    status: Schema.Literal("reachable"),
    testedAt: TimestampSchema,
    latencyMs: NonNegativeIntSchema,
  }),
  Schema.Struct({
    providerId: Provider.ID,
    status: Schema.Literal("unavailable"),
    testedAt: TimestampSchema,
    category: Schema.Literals(["authentication", "configuration", "network", "rate-limit", "unknown"]),
    message: Schema.String,
  }),
])

export const ApiKeyHealthSchema = Schema.Struct({
  status: Schema.Literals(["untested", "healthy", "auth-failed", "rate-limited", "error"]),
  lastTestedAt: Schema.optional(TimestampSchema),
  lastUsedAt: Schema.optional(TimestampSchema),
  errorCategory: Schema.optional(Schema.Literals(["authentication", "rate-limit", "network", "unknown"])),
  cooldownUntil: Schema.optional(TimestampSchema),
})

export const ApiKeySummarySchema = Schema.Struct({
  id: Credential.ID,
  providerId: Provider.ID,
  label: Schema.String,
  maskedValue: Schema.String,
  enabled: Schema.Boolean,
  active: Schema.Boolean,
  priority: NonNegativeIntSchema,
  health: ApiKeyHealthSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const ApiKeyMutationResultSchema = Schema.Struct({ apiKey: ApiKeySummarySchema })

const IntegrationAttemptStateSchema = Schema.Struct({
  attemptId: Integration.AttemptID,
  integrationId: Integration.ID,
  status: Integration.AttemptStatus,
  connection: Schema.NullOr(Connection.Info),
})

const SUBAGENT_CAPABILITY = "subagents.v1"

export const ExtendedRpcMethods = {
  "subagent/list": defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
    }),
    result: Schema.Struct({
      subagents: Schema.Array(SubagentProjectionSchema),
      nextCursor: Schema.NullOr(CursorSchema),
    }),
    errors: ["THREAD_NOT_FOUND", "CAPABILITY_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  "subagent/read": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema }),
    result: Schema.Struct({
      task: SubagentTaskSchema,
      currentRun: Schema.NullOr(SubagentRunSchema),
      snapshot: ThreadSnapshotSchema,
      capabilities: SubagentCapabilitiesSchema,
    }),
    errors: ["SUBAGENT_NOT_FOUND", "THREAD_NOT_FOUND", "CAPABILITY_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  "subagent/send": defineMethod({
    params: Schema.Struct({
      taskId: OpaqueIDSchema,
      inputId: OpaqueIDSchema,
      message: NonEmptyStringSchema,
      model: Schema.optional(Model.Ref),
      permissionConfig: Schema.optional(PermissionConfigSchema),
      attachmentIds: Schema.optional(AttachmentIDsSchema),
    }),
    result: SubagentAdmissionSchema,
    errors: [
      "SUBAGENT_NOT_FOUND",
      "MODEL_UNAVAILABLE",
      "ATTACHMENT_NOT_FOUND",
      "ATTACHMENT_LIMIT",
      "PERMISSION_DENIED",
      "CONFLICT",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "subagent/stop": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: SubagentTerminalResultSchema,
    errors: ["SUBAGENT_NOT_FOUND", "CONFLICT", "CAPABILITY_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "subagent/retry": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      task: SubagentTaskSchema,
      run: SubagentRunSchema,
      admission: AdmissionSchema,
    }),
    errors: [
      "SUBAGENT_NOT_FOUND",
      "MODEL_UNAVAILABLE",
      "PERMISSION_DENIED",
      "CONFLICT",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "subagent/worktree/diff": defineMethod({
    params: Schema.Struct({
      taskId: OpaqueIDSchema,
      maxBytes: Schema.optional(DiffByteLimitSchema),
      contextLines: Schema.optional(DiffContextLinesSchema),
    }),
    result: Schema.Struct({
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
    errors: [
      "SUBAGENT_NOT_FOUND",
      "WORKSPACE_CONFLICT",
      "PERMISSION_DENIED",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  "subagent/worktree/apply": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult("apply"),
    errors: [
      "SUBAGENT_NOT_FOUND",
      "WORKSPACE_CONFLICT",
      "PERMISSION_DENIED",
      "CONFLICT",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "subagent/worktree/discard": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult("discard"),
    errors: [
      "SUBAGENT_NOT_FOUND",
      "WORKSPACE_CONFLICT",
      "PERMISSION_DENIED",
      "CONFLICT",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "subagent/workspace/restore": defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult("restore"),
    errors: [
      "SUBAGENT_NOT_FOUND",
      "WORKSPACE_CONFLICT",
      "PERMISSION_DENIED",
      "CONFLICT",
      "CAPABILITY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  "model/list": defineMethod({
    params: Schema.Struct({
      providerId: Schema.optional(Provider.ID),
      query: Schema.optional(Schema.String),
      enabled: Schema.optional(Schema.Boolean),
      inputModality: Schema.optional(Schema.String),
      outputModality: Schema.optional(Schema.String),
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(ModelPageLimitSchema),
    }),
    result: CatalogResultSchema,
    errors: ["CURSOR_EXPIRED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "provider/list": defineMethod({
    params: Schema.Struct({}),
    result: ProviderListResultSchema,
    errors: ["RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: "model.catalog.paged.v1",
    mutation: false,
  }),

  "model/refresh": defineMethod({
    params: OperationParamsSchema,
    result: CatalogResultSchema,
    errors: ["PROVIDER_UNAVAILABLE", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "model/setDefault": defineMethod({
    params: Schema.Struct({ model: Schema.NullOr(Model.Ref), ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      defaultModel: Schema.NullOr(Model.Ref),
      settingsVersion: SettingsVersionSchema,
    }),
    errors: ["MODEL_UNAVAILABLE", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "model/setReviewer": defineMethod({
    params: Schema.Struct({ model: Schema.NullOr(Model.Ref), ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      reviewerModel: Schema.NullOr(Model.Ref),
      settingsVersion: SettingsVersionSchema,
    }),
    errors: ["MODEL_UNAVAILABLE", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "provider/test": defineMethod({
    params: Schema.Struct({ providerId: Provider.ID }),
    result: ProviderTestResultSchema,
    errors: ["PROVIDER_UNAVAILABLE", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "provider/updateSettings": defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      settings: ProviderPublicSettingsSchema,
      sensitiveHeaders: Schema.optional(Schema.Array(SensitiveHeaderWriteSchema)),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      provider: ProviderSummarySchema,
      catalogVersion: SequenceSchema,
    }),
    errors: ["PROVIDER_UNAVAILABLE", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  "apiKey/list": defineMethod({
    params: Schema.Struct({ providerId: Schema.optional(Provider.ID) }),
    result: Schema.Struct({ apiKeys: Schema.Array(ApiKeySummarySchema) }),
    errors: ["RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "apiKey/create": defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      label: NonEmptyStringSchema,
      key: NonEmptyStringSchema,
      ...OperationParamsSchema.fields,
    }),
    result: ApiKeyMutationResultSchema,
    errors: ["INTEGRATION_NOT_FOUND", "AUTHORIZATION_FAILED", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  "apiKey/update": defineMethod({
    params: Schema.Struct({
      credentialId: Credential.ID,
      label: Schema.optional(NonEmptyStringSchema),
      key: Schema.optional(NonEmptyStringSchema),
      ...OperationParamsSchema.fields,
    }),
    result: ApiKeyMutationResultSchema,
    errors: ["AUTHORIZATION_FAILED", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  "apiKey/setActive": defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      credentialId: Credential.ID,
      ...OperationParamsSchema.fields,
    }),
    result: ApiKeyMutationResultSchema,
    errors: ["INTEGRATION_NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "apiKey/setEnabled": defineMethod({
    params: Schema.Struct({
      credentialId: Credential.ID,
      enabled: Schema.Boolean,
      ...OperationParamsSchema.fields,
    }),
    result: ApiKeyMutationResultSchema,
    errors: ["CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "apiKey/reorder": defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      orderedCredentialIds: Schema.Array(Credential.ID),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ apiKeys: Schema.Array(ApiKeySummarySchema) }),
    errors: ["INTEGRATION_NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "apiKey/test": defineMethod({
    params: Schema.Struct({ credentialId: Credential.ID }),
    result: ApiKeyMutationResultSchema,
    errors: ["PROVIDER_UNAVAILABLE", "AUTHORIZATION_FAILED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "apiKey/delete": defineMethod({
    params: Schema.Struct({ credentialId: Credential.ID, ...OperationParamsSchema.fields }),
    result: Schema.Struct({ apiKeys: Schema.Array(ApiKeySummarySchema) }),
    errors: ["CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),

  "integration/list": defineMethod({
    params: Schema.Struct({
      kind: Schema.optional(Schema.Literals(["oauth", "key", "env"])),
      status: Schema.optional(Schema.Literals(["connected", "disconnected"])),
    }),
    result: Schema.Struct({ integrations: Schema.Array(Integration.Info) }),
    errors: ["RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "integration/connect": defineMethod({
    params: Schema.Struct({
      integrationId: Integration.ID,
      key: NonEmptyStringSchema,
      label: Schema.optional(NonEmptyStringSchema),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ integration: Integration.Info }),
    errors: ["INTEGRATION_NOT_FOUND", "AUTHORIZATION_FAILED", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    mutation: true,
  }),

  "integration/authorize": defineMethod({
    params: Schema.Struct({
      integrationId: Integration.ID,
      methodId: Integration.MethodID,
      inputs: Integration.Inputs,
      label: Schema.optional(NonEmptyStringSchema),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ attempt: Integration.Attempt }),
    errors: ["INTEGRATION_NOT_FOUND", "AUTHORIZATION_FAILED", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    mutation: true,
  }),

  "integration/authorizeComplete": defineMethod({
    params: Schema.Struct({
      attemptId: Integration.AttemptID,
      code: Schema.optional(NonEmptyStringSchema),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      attempt: IntegrationAttemptStateSchema,
      integration: Integration.Info,
    }),
    errors: ["INTEGRATION_NOT_FOUND", "AUTHORIZATION_FAILED", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    exactParams: true,
    mutation: true,
  }),

  "integration/authorizeStatus": defineMethod({
    params: Schema.Struct({ attemptId: Integration.AttemptID }),
    result: Schema.Struct({ attempt: IntegrationAttemptStateSchema }),
    errors: ["INTEGRATION_NOT_FOUND", "AUTHORIZATION_FAILED", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: false,
  }),

  "integration/disconnect": defineMethod({
    params: Schema.Struct({
      integrationId: Integration.ID,
      credentialId: Credential.ID,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ integration: Integration.Info }),
    errors: ["INTEGRATION_NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] as const,
    capability: null,
    mutation: true,
  }),
} as const satisfies MethodMap
