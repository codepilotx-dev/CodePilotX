import type { RpcMethod } from "@codepilotx/agent-protocol"
import {
  PiProviderConfigValidationError,
  serializePiProviderDefinition,
} from "../../../provider/pi"
import type { PiProviderDefinitionInput } from "../../../provider/pi"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import { optionalRpcRecord as optionalRecord } from "../decoders"
import {
  AgentError,
  booleanParam,
  modelRefOrNull,
  providerFailureCategory,
  stringParam,
} from "../RpcRouter"
import type { RpcHandlerGroup } from "./types"

const providerMethods = [
  "provider/list",
  "model/list",
  "model/refresh",
  "model/setDefault",
  "model/setReviewer",
  "provider/test",
  "provider/create",
  "provider/update",
  "provider/delete",
  "provider/model/discover",
  "provider/credential/list",
  "provider/credential/setActive",
  "provider/credential/setEnabled",
  "provider/credential/delete",
  "provider/apiKey/create",
  "provider/apiKey/update",
  "provider/apiKey/reorder",
  "provider/apiKey/test",
  "auth/session/start",
  "auth/session/respond",
  "auth/session/status",
  "auth/session/cancel",
] as const

const object = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  }
  return value as Record<string, unknown>
}

const stringArray = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  }
  return value as string[]
}

const emitCredentialUpdated = async (runtime: RpcRouter, providerID: string) => {
  await runtime.emit("provider/credential/updated", { providerId: providerID })
}

export const providerHandlers = {
  name: "provider",
  methods: providerMethods,
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, _context: RpcRouterContext): Promise<unknown> {
    const {
      config,
      providers,
      piModels,
      apiKeys,
      providerCredentials,
      authSessions,
    } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "provider/list": {
        const [result, definitions, issues] = await Promise.all([
          runtime.providerList(),
          piModels.providerDefinitions(),
          piModels.configIssues(),
        ])
        const definitionsByID = new Map(
          definitions.map((definition) => [definition.id, definition]),
        )
        return {
          ...result,
          providers: result.providers.map((provider) => {
            const configured = definitionsByID.get(String(provider.id))
            if (!configured && provider.source.kind === "custom") {
              throw new AgentError(
                "INTERNAL_ERROR",
                "自定义 Provider 缺少可编辑配置",
                500,
              )
            }
            return {
              ...provider,
              config: configured ?? {
                kind: "builtin",
                id: provider.id,
                enabled: provider.disabled !== true,
                allowModels: [],
                denyModels: [],
                models: [],
              },
            }
          }),
          issues: issues.map((issue) => ({
            providerId: issue.providerID,
            path: issue.path,
            code: issue.code,
          })),
        }
      }
      case "model/list":
        return runtime.modelCatalog(params)
      case "model/refresh":
        await providers.refresh(true)
        return runtime.publishCatalogUpdated()
      case "model/setDefault": {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        await config.batchWrite({
          edits: model
            ? [
                { keyPath: ["model"], value: String(model.id) },
                { keyPath: ["model_provider"], value: String(model.providerID) },
                { keyPath: ["model_reasoning_effort"], value: model.variant ? String(model.variant) : null },
              ]
            : [
                { keyPath: ["model"], value: null },
                { keyPath: ["model_provider"], value: null },
                { keyPath: ["model_reasoning_effort"], value: null },
              ],
        })
        const catalog = await runtime.publishCatalogUpdated(false)
        return { defaultModel: model, settingsVersion: catalog.catalogVersion }
      }
      case "model/setReviewer": {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        await config.batchWrite({
          edits: [{ keyPath: ["task_models", "reviewer"], value: model ? String(model.id) : null }],
        })
        const catalog = await runtime.publishCatalogUpdated(false)
        return { reviewerModel: model, settingsVersion: catalog.catalogVersion }
      }
      case "provider/test": {
        const providerID = stringParam(params, "providerId")
        const testedAt = Date.now()
        const startedAt = performance.now()
        const model = (await providers.models()).find((item) => String(item.providerID) === providerID)
        if (!model) {
          return {
            providerId: providerID,
            status: "unavailable",
            testedAt,
            category: "configuration",
            message: `Provider ${providerID} 没有可用模型`,
          }
        }
        try {
          await providers.getModel({ providerID: model.providerID, id: model.id })
          return {
            providerId: providerID,
            status: "reachable",
            testedAt,
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          }
        } catch (cause) {
          return {
            providerId: providerID,
            status: "unavailable",
            testedAt,
            category: providerFailureCategory(cause),
            message: cause instanceof Error ? cause.message : "Provider 当前不可用",
          }
        }
      }
      case "provider/create":
      case "provider/update": {
        const definition = object(params.definition, "definition")
        const providerID = method === "provider/create"
          ? stringParam(definition, "id")
          : stringParam(params, "providerId")
        if (stringParam(definition, "id") !== providerID) {
          throw new AgentError("CONFLICT", "Provider ID 创建后不可修改", 409)
        }
        if (method === "provider/create" && definition.kind !== "custom") {
          throw new AgentError("INVALID_REQUEST", "只能创建自定义 Provider", 400)
        }
        const configured = object(config.snapshot().model_providers ?? {}, "model_providers")
        if (method === "provider/create" && providerID in configured) {
          throw new AgentError("CONFLICT", `Provider ${providerID} 已存在`, 409)
        }
        let serialized: ReturnType<typeof serializePiProviderDefinition>
        try {
          serialized = serializePiProviderDefinition(
            definition as unknown as PiProviderDefinitionInput,
          )
        } catch (cause) {
          if (cause instanceof PiProviderConfigValidationError) {
            throw new AgentError(
              "INVALID_REQUEST",
              "Provider 配置不合法",
              400,
              {
                issues: cause.issues.map((issue) => ({
                  providerId: issue.providerID,
                  path: issue.path,
                  code: issue.code,
                })),
              },
            )
          }
          throw cause
        }
        await config.batchWrite({
          edits: [
            { keyPath: ["model_catalog", "schema_version"], value: 2 },
            { keyPath: ["model_providers", providerID], value: serialized.value as never },
          ],
        })
        await providers.reload()
        const catalog = await runtime.publishCatalogUpdated()
        return { providerId: providerID, catalogVersion: catalog.catalogVersion }
      }
      case "provider/delete": {
        const providerID = stringParam(params, "providerId")
        const snapshot = config.snapshot()
        const configured = object(snapshot.model_providers ?? {}, "model_providers")
        if (!(providerID in configured)) {
          throw new AgentError("PROVIDER_NOT_FOUND", `Provider ${providerID} 不存在`, 404)
        }
        const definition = object(configured[providerID], `model_providers.${providerID}`)
        if (definition.kind !== "custom") {
          throw new AgentError("CONFLICT", "只能删除自定义 Provider", 409)
        }
        const taskModels = snapshot.task_models && typeof snapshot.task_models === "object"
          ? snapshot.task_models as Record<string, unknown>
          : {}
        const reviewerModelID = typeof taskModels.reviewer === "string"
          ? taskModels.reviewer
          : undefined
        const reviewerReferencesProvider = reviewerModelID
          ? (await providers.models()).some(
              (model) =>
                String(model.providerID) === providerID &&
                String(model.id) === reviewerModelID,
            )
          : false
        if (snapshot.model_provider === providerID || reviewerReferencesProvider) {
          throw new AgentError("CONFLICT", "Provider 仍被默认模型或 Reviewer 模型引用", 409)
        }
        await config.batchWrite({
          edits: [{ keyPath: ["model_providers", providerID], value: null }],
        })
        await providers.reload()
        const catalog = await runtime.publishCatalogUpdated()
        return { providerId: providerID, deleted: true, catalogVersion: catalog.catalogVersion }
      }
      case "provider/model/discover": {
        const providerID = stringParam(params, "providerId")
        const api = stringParam(params, "api") as
          | "openai-completions"
          | "openai-responses"
          | "anthropic-messages"
        if (api === "anthropic-messages") {
          throw new AgentError("PROVIDER_UNAVAILABLE", "Anthropic 兼容端点不支持自动发现", 400)
        }
        const discovered = await piModels.discoverModels(providerID)
        return {
          models: discovered.map((model) => ({
            id: model.id,
            name: model.name,
            api,
            enabled: true,
            contextWindow: 32_768,
            maxTokens: 8_192,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        }
      }
      case "provider/credential/list":
        return {
          credentials: await providerCredentials.list(
            typeof params.providerId === "string" ? params.providerId : undefined,
          ),
        }
      case "provider/credential/setActive": {
        const providerID = stringParam(params, "providerId")
        const credential = await providerCredentials.setActive(
          providerID,
          stringParam(params, "credentialId"),
        )
        await providers.reload()
        await emitCredentialUpdated(runtime, providerID)
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case "provider/credential/setEnabled": {
        const credential = await providerCredentials.setEnabled(
          stringParam(params, "credentialId"),
          booleanParam(params, "enabled"),
        )
        await providers.reload()
        await emitCredentialUpdated(runtime, String(credential.providerId))
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case "provider/credential/delete": {
        const credentialID = stringParam(params, "credentialId")
        const before = (await providerCredentials.list()).find((item) => String(item.id) === credentialID)
        const credentials = await providerCredentials.delete(credentialID)
        await providers.reload()
        if (before) await emitCredentialUpdated(runtime, String(before.providerId))
        await runtime.publishCatalogUpdated()
        return { credentials }
      }
      case "provider/apiKey/create": {
        const providerID = stringParam(params, "providerId")
        const credential = await apiKeys.create({
          providerID,
          label: stringParam(params, "label"),
          key: stringParam(params, "key"),
        })
        await providers.reload()
        await emitCredentialUpdated(runtime, providerID)
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case "provider/apiKey/update": {
        const credential = await apiKeys.update({
          credentialID: stringParam(params, "credentialId"),
          ...(typeof params.label === "string" ? { label: params.label } : {}),
          ...(typeof params.key === "string" ? { key: params.key } : {}),
        })
        await providers.reload()
        await emitCredentialUpdated(runtime, String(credential.providerId))
        await runtime.publishCatalogUpdated()
        return { credential }
      }
      case "provider/apiKey/reorder": {
        const providerID = stringParam(params, "providerId")
        await apiKeys.reorder(
          providerID,
          stringArray(params.orderedCredentialIds, "orderedCredentialIds"),
        )
        await emitCredentialUpdated(runtime, providerID)
        return { credentials: await providerCredentials.list(providerID) }
      }
      case "provider/apiKey/test": {
        const result = await apiKeys.test(stringParam(params, "credentialId"))
        await emitCredentialUpdated(runtime, String(result.credential.providerId))
        return result
      }
      case "auth/session/start":
        return { session: await authSessions.start(object(params.target, "target") as never) }
      case "auth/session/respond":
        return {
          session: await authSessions.respond(
            stringParam(params, "sessionId"),
            stringParam(params, "promptId"),
            stringParam(params, "value"),
          ),
        }
      case "auth/session/status":
        return { session: authSessions.status(stringParam(params, "sessionId")) }
      case "auth/session/cancel":
        return { session: await authSessions.cancel(stringParam(params, "sessionId")) }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
