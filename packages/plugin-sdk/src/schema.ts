/**
 * Manifest v1 与 Application Wire v1 的权威 JSON Schema 文档。
 *
 * 这是跨语言 SDK 的单一权威描述；TypeScript 类型与 Effect 侧校验通过
 * 一致性测试锁定（同一组 fixture 在 ajv 与 SDK 校验下结果一致，字段集合
 * 与类型层常量一致）。scripts/generate-json-schema.ts 把本文件内容
 * 写入 schema/*.json 供其他语言加载。
 */

import type { JsonSchema } from "./json-schema"

const SHA256_PATTERN_JS = "^[0-9a-f]{64}$"
const RELATIVE_PATH_PATTERN_JS = "^[A-Za-z0-9_.\\-/]+$"

const pluginCapabilitiesSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    filesystem: { enum: ["none", "read", "workspace-write", "host-write"] },
    network: { enum: ["none", "declared", "unrestricted"] },
    process: { type: "boolean" },
    externalState: { type: "boolean" },
    userInteraction: { type: "boolean" },
  },
}

const toolContributionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "inputSchema"],
  properties: {
    name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" },
    description: { type: "string", minLength: 1, maxLength: 1000 },
    inputSchema: { type: "object" },
    // 注意：不允许 "never-review" —— 插件不能绕过 Host 权限链。
    approvalStrategy: { enum: ["policy", "always-review"] },
    visibility: { enum: ["eager", "deferred"] },
    capabilities: pluginCapabilitiesSchema,
  },
}

const skillContributionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["root"],
  properties: {
    root: { type: "string", pattern: RELATIVE_PATH_PATTERN_JS, minLength: 1, maxLength: 512 },
    name: { type: "string", minLength: 1, maxLength: 128 },
    description: { type: "string", maxLength: 1000 },
    allowedTools: { type: "array", items: { type: "string", minLength: 1, maxLength: 128 } },
  },
}

const mcpServerContributionSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["name", "transport"],
      properties: {
        name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" },
        transport: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "command"],
          properties: {
            kind: { const: "stdio" },
            command: { type: "string", minLength: 1, maxLength: 512 },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            env: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        toolPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            allow: { type: "array", items: { type: "string", minLength: 1 } },
            deny: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["name", "transport"],
      properties: {
        name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" },
        transport: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "url"],
          properties: {
            kind: { enum: ["http", "sse"] },
            url: { type: "string", pattern: "^https?://", maxLength: 2048 },
          },
        },
        toolPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            allow: { type: "array", items: { type: "string", minLength: 1 } },
            deny: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      },
    },
  ],
}

const promptCommandContributionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
    title: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    promptTemplate: { type: "string", minLength: 1, maxLength: 8000 },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["service", "method"],
      properties: {
        service: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*\\.[A-Za-z0-9][A-Za-z0-9_.-]*@\\d+$" },
        method: { type: "string", minLength: 1 },
        params: {},
      },
    },
  },
}

const settingsContributionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "title", "control"],
  properties: {
    key: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)*$" },
    title: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    control: { enum: ["string", "multiline", "number", "boolean", "enum", "credential"] },
    default: {},
    enumValues: { type: "array", minItems: 1, items: { type: "string" } },
    sensitive: { type: "boolean" },
  },
}

const workbenchViewContributionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
    title: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    icon: { type: "string", minLength: 1, maxLength: 64 },
  },
}

const serviceMethodSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["input", "output"],
  properties: {
    input: { type: "object" },
    output: { type: "object" },
  },
}

const serviceDeclarationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "version", "methods"],
  properties: {
    key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*\\.[A-Za-z0-9][A-Za-z0-9_.-]*@(0|[1-9][0-9]*)$" },
    version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+" },
    description: { type: "string", maxLength: 300 },
    singleton: { type: "boolean" },
    methods: {
      type: "object",
      additionalProperties: serviceMethodSchema,
    },
  },
}

const permissionRequestSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)+$", maxLength: 128 },
    reason: { type: "string", maxLength: 200 },
    scope: { enum: ["workspace", "global"] },
  },
}

const serviceRequirementsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    services: {
      type: "object",
      additionalProperties: { type: "string", minLength: 1, maxLength: 64 },
    },
    optionalServices: {
      type: "object",
      additionalProperties: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
}

const runtimeSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "declarative" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "protocol", "executable"],
      properties: {
        kind: { const: "process" },
        protocol: { const: "cpx-plugin-rpc@1" },
        executable: { type: "string", minLength: 1, maxLength: 512 },
        args: { type: "array", items: { type: "string" } },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "entry"],
      properties: {
        kind: { const: "system" },
        entry: { type: "string", minLength: 1, maxLength: 512 },
      },
    },
  ],
}

/** Manifest v1 权威 JSON Schema。 */
export const manifestV1JsonSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://codepilotx.dev/schema/plugin-manifest.v1.schema.json",
  title: "CodePilotX Plugin Manifest v1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "version", "displayName", "description", "publisher", "engines", "tier", "runtime", "files"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*\\.[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$" },
    version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-.]+)?(?:\\+[0-9A-Za-z-.]+)?$" },
    displayName: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 1000 },
    publisher: { type: "string", minLength: 1, maxLength: 120 },
    engines: {
      type: "object",
      additionalProperties: false,
      required: ["pluginApi"],
      properties: {
        pluginApi: { type: "string", minLength: 1, maxLength: 64 },
        codepilotx: { type: "string", minLength: 1, maxLength: 64 },
      },
    },
    tier: { enum: ["application", "system"] },
    runtime: runtimeSchema,
    contributes: {
      type: "object",
      additionalProperties: false,
      properties: {
        tools: { type: "array", items: toolContributionSchema },
        skills: { type: "array", items: skillContributionSchema },
        mcpServers: { type: "array", items: mcpServerContributionSchema },
        promptCommands: { type: "array", items: promptCommandContributionSchema },
        settings: { type: "array", items: settingsContributionSchema },
        workbenchViews: { type: "array", items: workbenchViewContributionSchema },
        services: { type: "array", items: serviceDeclarationSchema },
      },
    },
    requires: serviceRequirementsSchema,
    permissions: { type: "array", items: permissionRequestSchema },
    configSchema: { type: "object" },
    files: {
      type: "object",
      additionalProperties: { type: "string", pattern: SHA256_PATTERN_JS },
    },
  },
}

/** Application Wire v1 权威 JSON Schema（PluginMessage 判别联合）。 */
export const applicationWireV1JsonSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://codepilotx.dev/schema/application-wire.v1.schema.json",
  title: "CodePilotX Application Plugin Wire v1",
  type: "object",
  additionalProperties: false,
  required: ["protocol", "version", "pluginId", "generation", "kind", "method"],
  properties: {
    protocol: { const: "cpx-plugin-rpc@1" },
    version: { const: 1 },
    pluginId: { type: "string", minLength: 1, maxLength: 256 },
    generation: { type: "string", minLength: 1, maxLength: 256 },
    kind: { enum: ["request", "notification", "response", "clientRequest", "clientNotification"] },
    method: { type: "string", minLength: 1, maxLength: 128 },
    requestId: { type: "string", minLength: 1, maxLength: 256 },
    params: {},
    result: {},
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "retryable"],
      properties: {
        code: { type: "string", minLength: 1, maxLength: 128 },
        message: { type: "string", maxLength: 1000 },
        retryable: { type: "boolean" },
      },
    },
  },
}
