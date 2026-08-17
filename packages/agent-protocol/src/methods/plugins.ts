import { Schema } from "effect"
import { defineMethod } from "../wire/definition"
import { JsonValueSchema, OperationParamsSchema, TimestampSchema } from "../wire/primitives"

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const DigestSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
/** 严格空对象：拒绝任何多余字段（effect 空 Struct 会接受 excess）。 */
const EmptyObjectSchema = Schema.Record(Schema.String, Schema.Never)

export const PluginTierSchema = Schema.Literals(["application", "system"])
export const PluginPackageSourceSchema = Schema.Literals(["package", "linked-directory"])
export const PluginRuntimeKindSchema = Schema.Literals(["declarative", "process", "system"])
export const PluginEnableScopeSchema = Schema.Literals(["global", "workspace"])

export const PluginSummarySchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  description: Schema.String,
  publisher: NonEmptyStringSchema,
  tier: PluginTierSchema,
  runtimeKind: PluginRuntimeKindSchema,
  digest: DigestSchema,
  source: PluginPackageSourceSchema,
  linkedPath: Schema.NullOr(NonEmptyStringSchema),
  stagedDirectoryDigest: Schema.NullOr(DigestSchema),
  runtimeStatus: Schema.Literals(["waiting", "active", "retiring", "crashed", "disabled"]),
  /** 当前 digest 是否已确认信任（__digest__ grant）。 */
  trustedDigest: Schema.Boolean,
  enabledGlobal: Schema.Boolean,
  workspaceOverrides: Schema.Array(Schema.Struct({
    workspaceKey: NonEmptyStringSchema,
    enabled: Schema.Boolean,
  })),
  installedAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const PluginListResultSchema = Schema.Struct({
  plugins: Schema.Array(PluginSummarySchema),
})

export const PluginInstallParamsSchema = Schema.Struct({
  /** 本地 .cpxplugin 文件绝对路径（由 Desktop file picker 提供）。 */
  packagePath: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const PluginInstallResultSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  digest: DigestSchema,
  status: Schema.Literal("installed-disabled"),
})

export const PluginLinkParamsSchema = Schema.Struct({
  directoryPath: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const PluginIdParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const PluginEnableParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  scope: PluginEnableScopeSchema,
  workspaceKey: Schema.optional(NonEmptyStringSchema),
  ...OperationParamsSchema.fields,
})

export const PluginDisableParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  scope: PluginEnableScopeSchema,
  workspaceKey: Schema.optional(NonEmptyStringSchema),
  force: Schema.optional(Schema.Boolean),
  ...OperationParamsSchema.fields,
})

export const PluginConfigGetParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
})

export const PluginConfigResultSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  config: JsonValueSchema,
})

export const PluginConfigUpdateParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  config: JsonValueSchema,
  ...OperationParamsSchema.fields,
})

export const PluginGrantEntrySchema = Schema.Struct({
  permissionId: NonEmptyStringSchema,
  granted: Schema.Boolean,
})

export const PluginGrantsGetParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
})

export const PluginGrantsResultSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  digest: DigestSchema,
  grants: Schema.Array(PluginGrantEntrySchema),
})

export const PluginGrantsUpdateParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  grants: Schema.Array(PluginGrantEntrySchema),
  ...OperationParamsSchema.fields,
})

export const PluginProfileSummarySchema = Schema.Struct({
  id: NonEmptyStringSchema,
  pluginId: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  digest: DigestSchema,
  status: Schema.Literals(["staged", "active", "last-good", "retired", "failed"]),
  createdAt: TimestampSchema,
})

export const PluginProfileListResultSchema = Schema.Struct({
  profiles: Schema.Array(PluginProfileSummarySchema),
})

export const PluginProfileStageParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  config: JsonValueSchema,
  ...OperationParamsSchema.fields,
})

export const PluginProfileStageResultSchema = Schema.Struct({
  generationId: NonEmptyStringSchema,
  status: Schema.Literal("staged"),
})

export const PluginProfileApplyParamsSchema = Schema.Struct({
  generationId: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const PluginProfileApplyResultSchema = Schema.Struct({
  generationId: NonEmptyStringSchema,
  restartRequired: Schema.Literal(true),
})

export const PluginOperationResultSchema = Schema.Struct({
  operationId: NonEmptyStringSchema,
  pluginId: NonEmptyStringSchema,
  method: NonEmptyStringSchema,
  status: Schema.Literals(["pending", "completed", "failed"]),
  result: Schema.optional(JsonValueSchema),
  errorCode: Schema.NullOr(NonEmptyStringSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const PluginCommandExecuteParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  commandId: NonEmptyStringSchema,
  /** 用户输入中命令后的剩余文本（可选）。 */
  args: Schema.optional(Schema.String),
})

export const PluginCommandExecuteResultSchema = Schema.Struct({
  /** 插入 composer 的 prompt 模板展开结果；action 型命令为 null。 */
  promptTemplate: Schema.optional(Schema.String),
  actionResult: Schema.optional(Schema.Json),
})

// ── 声明式插件视图节点（Host-owned；renderer 只渲染白名单节点） ──────────

export const PluginViewNodeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("section"),
    title: Schema.optional(Schema.String),
    children: Schema.Array(Schema.Unknown),
  }),
  Schema.Struct({
    kind: Schema.Literal("markdown"),
    content: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("status"),
    text: Schema.String,
    tone: Schema.optional(Schema.Literals(["default", "success", "warning", "danger"])),
  }),
  Schema.Struct({
    kind: Schema.Literal("table"),
    columns: Schema.Array(Schema.Struct({ key: NonEmptyStringSchema, label: Schema.String })),
    rows: Schema.Array(Schema.Record(NonEmptyStringSchema, Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal("form"),
    actionId: NonEmptyStringSchema,
    submitLabel: Schema.optional(Schema.String),
    fields: Schema.Array(Schema.Struct({
      key: NonEmptyStringSchema,
      label: Schema.String,
      control: Schema.Literals(["string", "multiline", "boolean"]),
      value: Schema.optional(Schema.Json),
    })),
  }),
  Schema.Struct({
    kind: Schema.Literal("actions"),
    items: Schema.Array(Schema.Struct({
      id: NonEmptyStringSchema,
      label: Schema.String,
      tone: Schema.optional(Schema.Literals(["default", "danger"])),
    })),
  }),
])

export const PluginViewRenderParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  viewId: NonEmptyStringSchema,
  instanceId: NonEmptyStringSchema,
})

export const PluginViewRenderResultSchema = Schema.Struct({
  nodes: Schema.Array(PluginViewNodeSchema),
})

export const PluginViewActionParamsSchema = Schema.Struct({
  pluginId: NonEmptyStringSchema,
  viewId: NonEmptyStringSchema,
  instanceId: NonEmptyStringSchema,
  actionId: NonEmptyStringSchema,
  params: Schema.optional(Schema.Json),
})

export const PluginViewActionResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
})

export const PluginOperationGetParamsSchema = Schema.Struct({
  operationId: NonEmptyStringSchema,
})

// ── 贡献目录（plugin/contribution/list；plugins.runtime.v1） ────────────

export const PluginContributionListResultSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    tool: Schema.Struct({
      name: NonEmptyStringSchema,
      description: Schema.String,
      inputSchema: Schema.Record(Schema.String, Schema.Unknown),
      approvalStrategy: Schema.optional(Schema.Literals(["policy", "always-review"])),
      visibility: Schema.optional(Schema.Literals(["eager", "deferred"])),
      capabilities: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  })),
  skills: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    skill: Schema.Struct({
      root: NonEmptyStringSchema,
      name: Schema.optional(NonEmptyStringSchema),
      description: Schema.optional(Schema.String),
      allowedTools: Schema.optional(Schema.Array(NonEmptyStringSchema)),
    }),
  })),
  mcpServers: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    server: Schema.Struct({
      name: NonEmptyStringSchema,
      transport: Schema.Unknown,
      toolPolicy: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  })),
  promptCommands: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    command: Schema.Struct({
      id: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      description: Schema.optional(Schema.String),
      promptTemplate: Schema.optional(Schema.String),
      action: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  })),
  settings: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    setting: Schema.Struct({
      key: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      description: Schema.optional(Schema.String),
      control: Schema.Literals(["string", "multiline", "number", "boolean", "enum", "credential"]),
      default: Schema.optional(Schema.Json),
      enumValues: Schema.optional(Schema.Array(Schema.String)),
      sensitive: Schema.optional(Schema.Boolean),
    }),
  })),
  workbenchViews: Schema.Array(Schema.Struct({
    pluginId: NonEmptyStringSchema,
    view: Schema.Struct({
      id: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      description: Schema.optional(Schema.String),
      icon: Schema.optional(NonEmptyStringSchema),
    }),
  })),
})

export const PluginOkResultSchema = Schema.Struct({ ok: Schema.Literal(true) })

const PluginErrors = [
  "PLUGIN_NOT_FOUND",
  "PLUGIN_ARCHIVE_INVALID",
  "PLUGIN_ARCHIVE_UNSAFE",
  "PLUGIN_ARCHIVE_LIMIT",
  "PLUGIN_MANIFEST_INVALID",
  "PLUGIN_HASH_MISMATCH",
  "PLUGIN_LINK_INVALID",
  "PLUGIN_INSTALL_FAILED",
  "PLUGIN_DEVELOPER_MODE_REQUIRED",
  "PLUGIN_DIGEST_UNTRUSTED",
  "PLUGIN_OPERATION_NOT_FOUND",
  "PLUGIN_PROFILE_INVALID",
  "OPERATION_ID_CONFLICT",
  "CONFIG_VALIDATION_ERROR",
  "CONFIG_PATH_NOT_FOUND",
  "INTERNAL_ERROR",
] as const

const manage = {
  capability: "plugins.manage.v1" as const,
  mutation: false,
  exactParams: true,
  exactResult: true,
}

const manageMutation = { ...manage, mutation: true }

export const PluginRpcMethods = {
  "plugin/list": defineMethod({
    params: EmptyObjectSchema,
    result: PluginListResultSchema,
    errors: PluginErrors,
    ...manage,
  }),
  "plugin/installPackage": defineMethod({
    params: PluginInstallParamsSchema,
    result: PluginInstallResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/linkDirectory": defineMethod({
    params: PluginLinkParamsSchema,
    result: PluginInstallResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/unlinkDirectory": defineMethod({
    params: PluginIdParamsSchema,
    result: PluginOkResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/enable": defineMethod({
    params: PluginEnableParamsSchema,
    result: PluginOkResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/disable": defineMethod({
    params: PluginDisableParamsSchema,
    result: PluginOkResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/uninstall": defineMethod({
    params: PluginIdParamsSchema,
    result: PluginOkResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/config/get": defineMethod({
    params: PluginConfigGetParamsSchema,
    result: PluginConfigResultSchema,
    errors: PluginErrors,
    ...manage,
  }),
  "plugin/config/update": defineMethod({
    params: PluginConfigUpdateParamsSchema,
    result: PluginConfigResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/grants/get": defineMethod({
    params: PluginGrantsGetParamsSchema,
    result: PluginGrantsResultSchema,
    errors: PluginErrors,
    ...manage,
  }),
  "plugin/grants/update": defineMethod({
    params: PluginGrantsUpdateParamsSchema,
    result: PluginGrantsResultSchema,
    errors: PluginErrors,
    ...manageMutation,
  }),
  "plugin/profile/list": defineMethod({
    params: EmptyObjectSchema,
    result: PluginProfileListResultSchema,
    errors: PluginErrors,
    ...{ ...manage, capability: "plugins.system-profiles.v1" },
  }),
  "plugin/profile/stage": defineMethod({
    params: PluginProfileStageParamsSchema,
    result: PluginProfileStageResultSchema,
    errors: PluginErrors,
    ...{ ...manageMutation, capability: "plugins.system-profiles.v1" },
  }),
  "plugin/profile/applyOnRestart": defineMethod({
    params: PluginProfileApplyParamsSchema,
    result: PluginProfileApplyResultSchema,
    errors: PluginErrors,
    ...{ ...manageMutation, capability: "plugins.system-profiles.v1" },
  }),
  "plugin/operation/get": defineMethod({
    params: PluginOperationGetParamsSchema,
    result: PluginOperationResultSchema,
    errors: PluginErrors,
    ...manage,
  }),
  "plugin/contribution/list": defineMethod({
    params: EmptyObjectSchema,
    result: PluginContributionListResultSchema,
    errors: PluginErrors,
    ...{ ...manage, capability: "plugins.runtime.v1" },
  }),
  "plugin/command/execute": defineMethod({
    params: PluginCommandExecuteParamsSchema,
    result: PluginCommandExecuteResultSchema,
    errors: PluginErrors,
    ...{ ...manageMutation, capability: "plugins.runtime.v1" },
  }),
  "plugin/view/render": defineMethod({
    params: PluginViewRenderParamsSchema,
    result: PluginViewRenderResultSchema,
    errors: PluginErrors,
    ...{ ...manage, capability: "plugins.views.v1" },
  }),
  "plugin/view/action": defineMethod({
    params: PluginViewActionParamsSchema,
    result: PluginViewActionResultSchema,
    errors: PluginErrors,
    ...{ ...manageMutation, capability: "plugins.views.v1" },
  }),
} as const
