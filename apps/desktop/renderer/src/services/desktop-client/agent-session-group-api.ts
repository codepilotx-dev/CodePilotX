import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import type { createAgentRpcClient } from '../agentRpcClient.js'
import type { DesktopSessionGroupApi } from './types.js'

type Rpc = Pick<ReturnType<typeof createAgentRpcClient>, 'call'>

type Dependencies = {
  requireAgentCapability: (name: ProtocolCapability) => void
  rpc: Rpc
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentSessionGroupApi({
  requireAgentCapability,
  rpc,
  withRequiredAgent,
}: Dependencies): DesktopSessionGroupApi {
  const execute = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(async () => {
      requireAgentCapability('session-group.v1')
      return operation()
    })

  return {
    listSessionGroups: () => execute(async () =>
      [...(await rpc.call('session-group/list', {})).groups]),
    readSessionGroup: groupId => execute(async () => {
      const [value, context] = await Promise.all([
        rpc.call('session-group/read', { groupId }),
        rpc.call('session-group/context/read', { groupId }),
      ])
      return {
        group: value.group,
        members: value.memberships,
        digest: context.state.digest,
        contextEntries: context.entries,
      }
    }),
    createSessionGroup: input => execute(async () =>
      (await rpc.call('session-group/create', {
        ...input,
        operationId: crypto.randomUUID(),
      })).group),
    updateSessionGroup: ({ groupId, version, name, description }) => execute(async () =>
      (await rpc.call('session-group/update', {
        groupId,
        expectedVersion: version ?? 1,
        patch: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        },
        operationId: crypto.randomUUID(),
      })).group),
    deleteSessionGroup: (groupId, expectedVersion) => execute(async () => {
      await rpc.call('session-group/delete', {
        groupId,
        expectedVersion,
        operationId: crypto.randomUUID(),
      })
    }),
    setSessionGroupMembership: input => execute(async () => {
      await rpc.call('session-group/membership/set', {
        ...input,
        operationId: crypto.randomUUID(),
      })
    }),
    listSessionGroupSteps: groupId => execute(async () =>
      [...(await rpc.call('session-group/step/list', { groupId })).steps]),
    readSessionGroupStepDiff: input => execute(() =>
      rpc.call('session-group/step/diff', input)),
  }
}
