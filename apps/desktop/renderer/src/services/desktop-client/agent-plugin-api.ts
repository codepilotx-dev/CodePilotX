import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import type { createAgentRpcClient } from '../agentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from './eventSubscriptionFilters.js'
import type { DesktopPluginApi } from './types.js'

type Dependencies = {
  mockClient: DesktopPluginApi
  hasAgentCapability: (
    name: Extract<ProtocolCapability, 'plugins.details.v1'>,
  ) => boolean
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'plugins.manage.v1'>,
  ) => void
  rpc: Pick<
    ReturnType<typeof createAgentRpcClient>,
    'call' | 'subscribeEnvelope'
  >
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentPluginApi({
  hasAgentCapability,
  mockClient,
  requireAgentCapability,
  rpc,
  withAgentOrMock,
}: Dependencies): DesktopPluginApi {
  return {
    listPlugins: (workspacePath, forceReload) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.manage.v1')
          return rpc.call('plugin/list', {
            ...(workspacePath ? { workspace: workspacePath } : {}),
            ...(forceReload === undefined ? {} : { forceReload }),
          })
        },
        () => mockClient.listPlugins(workspacePath, forceReload),
      ),
    getPluginDetails: (pluginId, workspacePath) =>
      withAgentOrMock(
        async () => {
          if (!hasAgentCapability('plugins.details.v1')) return null
          return (await rpc.call('plugin/getDetails', {
            pluginId,
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })).details
        },
        () => mockClient.getPluginDetails(pluginId, workspacePath),
      ),
    setPluginEnabled: (pluginId, enabled) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('plugins.manage.v1')
          return (await rpc.call('plugin/setEnabled', {
            pluginId,
            enabled,
            operationId: crypto.randomUUID(),
          })).plugin
        },
        () => mockClient.setPluginEnabled(pluginId, enabled),
      ),
    onPluginsUpdated: callback =>
      rpc.subscribeEnvelope(
        { liveEventTypes: AGENT_LIVE_EVENT_FILTERS.plugins },
        events => {
          for (const event of events) {
            if (event.type === 'plugins/updated') {
              callback(event.payload.generation)
            }
          }
        },
      ),
  }
}
