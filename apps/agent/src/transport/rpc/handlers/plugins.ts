import {
  PluginCommandExecuteParamsSchema,
  PluginConfigGetParamsSchema,
  PluginConfigUpdateParamsSchema,
  PluginDisableParamsSchema,
  PluginEnableParamsSchema,
  PluginGrantsGetParamsSchema,
  PluginGrantsUpdateParamsSchema,
  PluginIdParamsSchema,
  PluginInstallParamsSchema,
  PluginLinkParamsSchema,
  PluginOperationGetParamsSchema,
  PluginProfileApplyParamsSchema,
  PluginProfileStageParamsSchema,
  PluginViewActionParamsSchema,
  PluginViewRenderParamsSchema,
  type RpcMethod,
} from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import type { RpcHandlerGroup } from "./types"

const decodeInstall = Schema.decodeUnknownSync(PluginInstallParamsSchema)
const decodeLink = Schema.decodeUnknownSync(PluginLinkParamsSchema)
const decodeId = Schema.decodeUnknownSync(PluginIdParamsSchema)
const decodeEnable = Schema.decodeUnknownSync(PluginEnableParamsSchema)
const decodeDisable = Schema.decodeUnknownSync(PluginDisableParamsSchema)
const decodeConfigGet = Schema.decodeUnknownSync(PluginConfigGetParamsSchema)
const decodeConfigUpdate = Schema.decodeUnknownSync(PluginConfigUpdateParamsSchema)
const decodeGrantsGet = Schema.decodeUnknownSync(PluginGrantsGetParamsSchema)
const decodeGrantsUpdate = Schema.decodeUnknownSync(PluginGrantsUpdateParamsSchema)
const decodeProfileStage = Schema.decodeUnknownSync(PluginProfileStageParamsSchema)
const decodeProfileApply = Schema.decodeUnknownSync(PluginProfileApplyParamsSchema)
const decodeOperationGet = Schema.decodeUnknownSync(PluginOperationGetParamsSchema)
const decodeCommandExecute = Schema.decodeUnknownSync(PluginCommandExecuteParamsSchema)
const decodeViewRender = Schema.decodeUnknownSync(PluginViewRenderParamsSchema)
const decodeViewAction = Schema.decodeUnknownSync(PluginViewActionParamsSchema)

/** 插件管理 handler：只做 decode 与调用 PluginService。 */
export const pluginHandlers = {
  name: "plugins",
  methods: [
    "plugin/list",
    "plugin/installPackage",
    "plugin/linkDirectory",
    "plugin/unlinkDirectory",
    "plugin/enable",
    "plugin/disable",
    "plugin/uninstall",
    "plugin/config/get",
    "plugin/config/update",
    "plugin/grants/get",
    "plugin/grants/update",
    "plugin/profile/list",
    "plugin/profile/stage",
    "plugin/profile/applyOnRestart",
    "plugin/operation/get",
    "plugin/contribution/list",
    "plugin/command/execute",
    "plugin/view/render",
    "plugin/view/action",
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const service = runtime.dependencies.pluginService
    switch (method) {
      case "plugin/list":
        return { plugins: service.list() }
      case "plugin/installPackage": {
        const { packagePath, operationId } = decodeInstall(rawParams)
        return service.installPackage({ packagePath, operationId })
      }
      case "plugin/linkDirectory": {
        const { directoryPath, operationId } = decodeLink(rawParams)
        return service.linkDirectory({ directoryPath, operationId })
      }
      case "plugin/unlinkDirectory": {
        const { pluginId, operationId } = decodeId(rawParams)
        return service.unlinkDirectory({ pluginId, operationId })
      }
      case "plugin/enable": {
        const { pluginId, scope, workspaceKey, operationId } = decodeEnable(rawParams)
        return service.enable({ pluginId, scope, ...(workspaceKey === undefined ? {} : { workspaceKey }), operationId })
      }
      case "plugin/disable": {
        const { pluginId, scope, workspaceKey, force, operationId } = decodeDisable(rawParams)
        return service.disable({ pluginId, scope, ...(workspaceKey === undefined ? {} : { workspaceKey }), ...(force === undefined ? {} : { force }), operationId })
      }
      case "plugin/uninstall": {
        const { pluginId, operationId } = decodeId(rawParams)
        return service.uninstall({ pluginId, operationId })
      }
      case "plugin/config/get": {
        const { pluginId } = decodeConfigGet(rawParams)
        return service.configGet({ pluginId })
      }
      case "plugin/config/update": {
        const { pluginId, config, operationId } = decodeConfigUpdate(rawParams)
        return service.configUpdate({ pluginId, config, operationId })
      }
      case "plugin/grants/get": {
        const { pluginId } = decodeGrantsGet(rawParams)
        return service.grantsGet({ pluginId })
      }
      case "plugin/grants/update": {
        const { pluginId, grants, operationId } = decodeGrantsUpdate(rawParams)
        return service.grantsUpdate({ pluginId, grants, operationId })
      }
      case "plugin/profile/list":
        return { profiles: service.profileList() }
      case "plugin/profile/stage": {
        const { pluginId, config, operationId } = decodeProfileStage(rawParams)
        return service.profileStage({ pluginId, config, operationId })
      }
      case "plugin/profile/applyOnRestart": {
        const { generationId, operationId } = decodeProfileApply(rawParams)
        return service.profileApplyOnRestart({ generationId, operationId })
      }
      case "plugin/operation/get": {
        const { operationId } = decodeOperationGet(rawParams)
        return service.operationGet({ operationId })
      }
      case "plugin/contribution/list":
        return service.contributionList()
      case "plugin/command/execute": {
        const { pluginId, commandId, args } = decodeCommandExecute(rawParams)
        return service.executeCommand({ pluginId, commandId, ...(args === undefined ? {} : { args }) })
      }
      case "plugin/view/render": {
        const { pluginId, viewId, instanceId } = decodeViewRender(rawParams)
        return service.renderView({ pluginId, viewId, instanceId })
      }
      case "plugin/view/action": {
        const { pluginId, viewId, instanceId, actionId, params } = decodeViewAction(rawParams)
        return service.viewAction({ pluginId, viewId, instanceId, actionId, ...(params === undefined ? {} : { params }) })
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
