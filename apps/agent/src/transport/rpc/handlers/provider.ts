import type { RpcMethod } from "@codepilotx/agent-protocol"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import { decodeRpcParams as decodeParams, optionalRpcRecord as optionalRecord, rpcRecord as record } from "../decoders"
import {
  AgentError,
  Capabilities,
  Effect,
  Model,
  WorkspaceService,
  globalEventSequence,
  secretScrubber,
  aiReviewModel,
  aiReviewPrompt,
  aiReviewTitle,
  attachmentView,
  booleanParam,
  decodeOffsetCursor,
  decodePermissionConfig,
  decodeQueueInput,
  decodeQueueResume,
  decodeQueueUpdate,
  decodeReviewAiStart,
  decodeReviewApply,
  decodeReviewBranches,
  decodeReviewCommentID,
  decodeReviewCommentList,
  decodeReviewCommentSave,
  decodeReviewCommit,
  decodeReviewCommits,
  decodeReviewFileDiff,
  decodeReviewStatus,
  decodeReviewSummary,
  decodeSandboxUninstall,
  decodeThreadSettings,
  decodeThreadSettingsPatch,
  encodeOffsetCursor,
  enumValue,
  githubPullRequestIdentity,
  githubRepositoryIdentity,
  memoryEntryView,
  modelRef,
  modelRefOrNull,
  parseJsonRecord,
  positiveIntegerParam,
  providerFailureCategory,
  providerSetting,
  resolveAiReviewSource,
  resolveMemoryProjectID,
  resolveMemoryProjectKey,
  resolveProjectWorkspace,
  stringParam,
  submitMessage,
  supportedPermissionConfig,
} from "../RpcRouter"
import type { RpcHandlerGroup } from "./types"

const ANTHROPIC_USAGE_INTEGRATION_ID = "usage.anthropic.subscription"
const emitUsageSourceUpdated = async (runtime: RpcRouter, integrationID: string) => {
  if (integrationID !== ANTHROPIC_USAGE_INTEGRATION_ID) return
  await runtime.emit("usage/source/updated", {
    sourceId: "anthropic-subscription",
    changedAt: Date.now(),
  })
}

export const providerHandlers = {
  name: "provider",
  methods: [
    "provider/list",
    "model/list",
    "model/refresh",
    "model/setDefault",
    "model/setReviewer",
    "provider/test",
    "provider/updateSettings",
    "apiKey/list",
    "apiKey/create",
    "apiKey/update",
    "apiKey/setActive",
    "apiKey/setEnabled",
    "apiKey/reorder",
    "apiKey/test",
    "apiKey/delete",
    "integration/list",
    "integration/connect",
    "integration/authorize",
    "integration/authorizeComplete",
    "integration/authorizeStatus",
    "integration/disconnect",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { config, db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, sandbox, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "provider/list":
        return runtime.providerList()
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
        return {
          defaultModel: model,
          settingsVersion: catalog.catalogVersion,
        }
      }
      case "model/setReviewer": {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        await config.batchWrite({
          edits: [
            { keyPath: ["task_models", "reviewer"], value: model ? String(model.id) : null },
          ],
        })
        const catalog = await runtime.publishCatalogUpdated(false)
        return {
          reviewerModel: model,
          settingsVersion: catalog.catalogVersion,
        }
      }
      case "provider/test": {
        const providerID = stringParam(params, "providerId")
        const testedAt = Date.now()
        const startedAt = performance.now()
        const model = (await providers.models()).find((item) => item.providerID === providerID)
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
      case "provider/updateSettings": {
        const setting = providerSetting(params)
        const flatten = (
          value: Record<string, unknown>,
          prefix: string[],
        ): Array<{ keyPath: string[]; value: never }> =>
          Object.entries(value).flatMap(([key, child]) =>
            child && typeof child === "object" && !Array.isArray(child)
              ? flatten(child as Record<string, unknown>, [...prefix, key])
              : [{ keyPath: [...prefix, key], value: child as never }],
          )
        const edits = flatten(
          setting.config as unknown as Record<string, unknown>,
          ["model_providers", setting.id],
        )
        if (edits.length) await config.batchWrite({ edits })
        await providers.reload()
        const catalog = await runtime.publishCatalogUpdated()
        const catalogProvider = catalog.providers.find(({ provider }) => provider.id === setting.id)
        if (!catalogProvider) throw new AgentError("PROVIDER_UNAVAILABLE", `Provider ${setting.id} 当前不可用`, 409)
        const integration = (await integrations.list()).find((item) => item.id === catalogProvider.provider.integrationID)
        return {
          provider: {
            id: catalogProvider.provider.id,
            name: catalogProvider.provider.name,
            disabled: catalogProvider.provider.disabled === true,
            ...(catalogProvider.provider.integrationID
              ? { integrationId: catalogProvider.provider.integrationID }
              : {}),
            configured: integration ? integration.connections.length > 0 : true,
            modelCount: catalogProvider.models.length,
          },
          catalogVersion: catalog.catalogVersion,
        }
      }
      case "apiKey/list": {
        return {
          apiKeys: await apiKeys.list(typeof params.providerId === "string" ? params.providerId : undefined),
        }
      }
      case "apiKey/create": {
        const apiKey = await apiKeys.create({
          providerID: stringParam(params, "providerId"),
          label: stringParam(params, "label"),
          key: stringParam(params, "key"),
        })
        await providers.reload()
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(apiKey.providerId)))
        await runtime.publishCatalogUpdated()
        return { apiKey }
      }
      case "apiKey/update": {
        const apiKey = await apiKeys.update({
          credentialID: stringParam(params, "credentialId"),
          ...(typeof params.label === "string" ? { label: params.label } : {}),
          ...(typeof params.key === "string" ? { key: params.key } : {}),
        })
        await providers.reload()
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(apiKey.providerId)))
        await runtime.publishCatalogUpdated()
        return { apiKey }
      }
      case "apiKey/setActive": {
        const apiKey = await apiKeys.setActive(
          stringParam(params, "providerId"),
          stringParam(params, "credentialId"),
        )
        await providers.reload()
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(apiKey.providerId)))
        await runtime.publishCatalogUpdated()
        return { apiKey }
      }
      case "apiKey/setEnabled": {
        const apiKey = await apiKeys.setEnabled(
          stringParam(params, "credentialId"),
          booleanParam(params, "enabled"),
        )
        await providers.reload()
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(apiKey.providerId)))
        await runtime.publishCatalogUpdated()
        return { apiKey }
      }
      case "apiKey/reorder": {
        if (!Array.isArray(params.orderedCredentialIds) || params.orderedCredentialIds.some((id) => typeof id !== "string")) {
          throw new AgentError("INVALID_REQUEST", "orderedCredentialIds 参数无效", 400)
        }
        const providerID = stringParam(params, "providerId")
        const apiKeyList = await apiKeys.reorder(providerID, params.orderedCredentialIds as string[])
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(providerID))
        return { apiKeys: apiKeyList }
      }
      case "apiKey/test": {
        const credentialID = stringParam(params, "credentialId")
        const result = await apiKeys.test(credentialID)
        await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(result.apiKey.providerId)))
        return result
      }
      case "apiKey/delete": {
        const credentialID = stringParam(params, "credentialId")
        const before = (await apiKeys.list()).find((item) => String(item.id) === credentialID)
        const apiKeyList = await apiKeys.delete(credentialID)
        await providers.reload()
        if (before) await runtime.emitIntegration("integration/updated", await runtime.providerIntegrationID(String(before.providerId)))
        await runtime.publishCatalogUpdated()
        return { apiKeys: apiKeyList }
      }
      case "integration/list": {
        const listed = await integrations.list()
        return {
          integrations: listed.filter((integration) => {
            if (
              typeof params.kind === "string" &&
              !integration.methods.some((method) => method.type === params.kind)
            ) return false
            if (
              params.status === "connected" &&
              integration.connections.length === 0
            ) return false
            if (
              params.status === "disconnected" &&
              integration.connections.length > 0
            ) return false
            return true
          }),
        }
      }
      case "integration/connect": {
        const integrationID = stringParam(params, "integrationId")
        await integrations.connect({
          integrationID,
          key: stringParam(params, "key"),
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        await providers.reload()
        await runtime.emitIntegration("integration/updated", integrationID)
        await emitUsageSourceUpdated(runtime, integrationID)
        await runtime.publishCatalogUpdated()
        return { integration: await runtime.requiredIntegration(integrationID) }
      }
      case "integration/authorize": {
        const inputs = optionalRecord(params.inputs)
        const values = Object.fromEntries(Object.entries(inputs).map(([key, value]) => {
          if (typeof value !== "string") throw new AgentError("INVALID_REQUEST", `inputs.${key} 参数无效`, 400)
          return [key, value]
        }))
        const attempt = await integrations.authorize({
          integrationID: stringParam(params, "integrationId"),
          methodID: stringParam(params, "methodId"),
          inputs: values,
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        return { attempt }
      }
      case "integration/authorizeComplete": {
        const completedAttemptID = stringParam(params, "attemptId")
        const connection = await integrations.complete({ attemptID: completedAttemptID, ...(typeof params.code === "string" ? { code: params.code } : {}) })
        const completedContext = integrations.attemptContext(completedAttemptID)
        const status = await integrations.status(completedAttemptID)
        await providers.reload()
        await runtime.emit("integration/authorizationCompleted", {
          attemptId: completedAttemptID,
          integrationId: completedContext.integrationID,
        })
        await emitUsageSourceUpdated(runtime, String(completedContext.integrationID))
        await runtime.publishCatalogUpdated()
        return {
          attempt: {
            attemptId: completedAttemptID,
            integrationId: completedContext.integrationID,
            status,
            connection,
          },
          integration: await runtime.requiredIntegration(completedContext.integrationID),
        }
      }
      case "integration/authorizeStatus": {
        const attemptID = stringParam(params, "attemptId")
        const status = await integrations.status(attemptID)
        const context = integrations.attemptContext(attemptID)
        if (status.status === "complete") {
          await providers.reload()
          await runtime.emit("integration/authorizationCompleted", {
            attemptId: attemptID,
            integrationId: context.integrationID,
          })
          await emitUsageSourceUpdated(runtime, String(context.integrationID))
          await runtime.publishCatalogUpdated()
        }
        if (status.status === "failed") {
          await runtime.emit("integration/authorizationFailed", {
            attemptId: attemptID,
            integrationId: context.integrationID,
            error: {
              code: "AUTHORIZATION_FAILED",
              message: status.message,
              retryable: false,
            },
          })
        }
        return {
          attempt: {
            attemptId: attemptID,
            integrationId: context.integrationID,
            status,
            connection: context.connection ?? null,
          },
        }
      }
      case "integration/disconnect": {
        const integrationID = stringParam(params, "integrationId")
        await integrations.disconnect({
          integrationID,
          credentialID: stringParam(params, "credentialId"),
        })
        await providers.reload()
        await runtime.emitIntegration("integration/updated", integrationID)
        await emitUsageSourceUpdated(runtime, integrationID)
        await runtime.publishCatalogUpdated()
        return { integration: await runtime.requiredIntegration(integrationID) }
      }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
