import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import type { createAgentRpcClient } from '../agentRpcClient.js'
import type { DesktopTaskboardApi } from './types.js'

type Dependencies = {
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'taskboard.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
}

export function createAgentTaskboardApi({
  requireAgentCapability,
  rpc,
  withRequiredAgent,
}: Dependencies): DesktopTaskboardApi {
  const execute = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(async () => {
    requireAgentCapability('taskboard.v1')
    return operation()
  })
  const operationId = (): string => crypto.randomUUID()

  return {
    listTaskboardTasks: params => execute(() => rpc.call('taskboard/task/list', params)),
    readTaskboardTask: params => execute(() => rpc.call('taskboard/task/read', params)),
    createTaskboardTask: params => execute(() => rpc.call('taskboard/task/create', {
      ...params,
      operationId: operationId(),
    })),
    updateTaskboardTask: params => execute(() => rpc.call('taskboard/task/update', {
      ...params,
      operationId: operationId(),
    })),
    moveTaskboardTask: params => execute(() => rpc.call('taskboard/task/move', {
      ...params,
      operationId: operationId(),
    })),
    archiveTaskboardTask: params => execute(() => rpc.call('taskboard/task/archive', {
      ...params,
      operationId: operationId(),
    })),
    restoreTaskboardTask: params => execute(() => rpc.call('taskboard/task/restore', {
      ...params,
      operationId: operationId(),
    })),
    deleteTaskboardTask: params => execute(() => rpc.call('taskboard/task/delete', {
      ...params,
      operationId: operationId(),
    })),
    linkTaskboardThread: params => execute(() => rpc.call('taskboard/thread/link', {
      ...params,
      operationId: operationId(),
    })),
    unlinkTaskboardThread: params => execute(() => rpc.call('taskboard/thread/unlink', {
      ...params,
      operationId: operationId(),
    })),
    setPrimaryTaskboardThread: params => execute(() => rpc.call('taskboard/thread/set-primary', {
      ...params,
      operationId: operationId(),
    })),
    createTaskboardComment: params => execute(() => rpc.call('taskboard/comment/create', {
      ...params,
      operationId: operationId(),
    })),
    updateTaskboardComment: params => execute(() => rpc.call('taskboard/comment/update', {
      ...params,
      operationId: operationId(),
    })),
    deleteTaskboardComment: params => execute(() => rpc.call('taskboard/comment/delete', {
      ...params,
      operationId: operationId(),
    })),
    listTaskboardLabels: params => execute(() => rpc.call('taskboard/label/list', params)),
    createTaskboardLabel: params => execute(() => rpc.call('taskboard/label/create', {
      ...params,
      operationId: operationId(),
    })),
    updateTaskboardLabel: params => execute(() => rpc.call('taskboard/label/update', {
      ...params,
      operationId: operationId(),
    })),
    deleteTaskboardLabel: params => execute(() => rpc.call('taskboard/label/delete', {
      ...params,
      operationId: operationId(),
    })),
    startTaskboardTask: params => execute(() => rpc.call('taskboard/task/start', {
      ...params,
      operationId: operationId(),
    })),
    readTaskboardStartStatus: params => execute(() => rpc.call('taskboard/task/start/status', params)),
    retryTaskboardStartSetup: params => execute(() => rpc.call('taskboard/task/start/retry-setup', params)),
    continueTaskboardStartWithoutSetup: params => execute(() => rpc.call(
      'taskboard/task/start/continue-without-setup',
      params,
    )),
  }
}
