import type { ProtocolCapability } from '@codepilotx/agent-protocol'
import type { createAgentRpcClient } from '../agentRpcClient.js'
import type { DesktopTaskboardApi } from './types.js'

type Dependencies = {
  requireAgentCapability: (
    name: Extract<ProtocolCapability, 'taskboard.v1' | 'taskboard.workflow.v1' | 'taskboard.context.v1'>,
  ) => void
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
  mockClient: DesktopTaskboardApi
  withRequiredAgent: <T>(operation: () => Promise<T>) => Promise<T>
  withAgentOrMock: <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ) => Promise<T>
}

export function createAgentTaskboardApi({
  requireAgentCapability,
  rpc,
  mockClient,
  withRequiredAgent,
  withAgentOrMock,
}: Dependencies): DesktopTaskboardApi {
  const execute = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(async () => {
    requireAgentCapability('taskboard.v1')
    return operation()
  })
  const executeRead = <T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ): Promise<T> => withAgentOrMock(async () => {
    requireAgentCapability('taskboard.v1')
    return agentOperation()
  }, mockOperation)
  const executeWorkflow = <T>(operation: () => Promise<T>): Promise<T> =>
    withRequiredAgent(async () => {
      requireAgentCapability('taskboard.workflow.v1')
      return operation()
    })
  const executeWorkflowRead = <T>(operation: () => Promise<T>): Promise<T> =>
    withAgentOrMock(async () => {
      requireAgentCapability('taskboard.workflow.v1')
      return operation()
    }, () => Promise.reject(new Error('浏览器预览不支持会话任务看板。')))
  const operationId = (): string => crypto.randomUUID()
  const executeContext = <T>(operation: () => Promise<T>): Promise<T> => withRequiredAgent(async () => {
    requireAgentCapability('taskboard.context.v1')
    return operation()
  })

  return {
    readTaskContext: params => executeContext(() => rpc.call('taskboard/context/read', params)),
    updateTaskContext: params => executeContext(() => rpc.call('taskboard/context/update', params)),
    previewTaskContext: params => executeContext(() => rpc.call('taskboard/context/ai-preview', params)),
    applyTaskContextProposal: params => executeContext(() => rpc.call('taskboard/context/ai-apply', params)),
    discardTaskContextProposal: params => executeContext(() => rpc.call('taskboard/context/ai-discard', params)),
    readTaskContextPromotion: params => executeContext(() => rpc.call('taskboard/context/promotion-status', params)),
    listTaskboardWorkflowTasks: params => executeWorkflowRead(() => rpc.call('taskboard/workflow/list', params)),
    readTaskboardWorkflowTask: params => executeWorkflowRead(() => rpc.call('taskboard/workflow/read', params)),
    createTaskboardWorkflowTask: params => executeWorkflow(() => rpc.call('taskboard/workflow/create', {
      ...params,
      operationId: operationId(),
    })),
    updateTaskboardWorkflowTask: params => executeWorkflow(() => rpc.call('taskboard/workflow/update', {
      ...params,
      operationId: operationId(),
    })),
    moveTaskboardWorkflowTask: params => executeWorkflow(() => rpc.call('taskboard/workflow/move', {
      ...params,
      operationId: operationId(),
    })),
    transitionTaskboardWorkflowTask: params => executeWorkflow(() => rpc.call('taskboard/workflow/transition', {
      ...params,
      operationId: operationId(),
    })),
    markTaskboardWorkflowTaskRead: params => executeWorkflow(() => rpc.call('taskboard/workflow/mark-read', {
      ...params,
      operationId: operationId(),
    })),
    listTaskboardWorkflowThreadCandidates: params => executeWorkflowRead(() => rpc.call('taskboard/workflow/thread-candidates', params)),
    findTaskboardWorkflowTaskByThread: params => executeWorkflowRead(() => rpc.call('taskboard/workflow/find-by-thread', params)),
    linkTaskboardWorkflowThreads: params => executeWorkflow(() => rpc.call('taskboard/workflow/link-threads', {
      ...params,
      operationId: operationId(),
    })),
    startTaskboardWorkflowTask: params => executeWorkflow(() => rpc.call('taskboard/workflow/start', {
      ...params,
      operationId: operationId(),
    })),
    listTaskboardTasks: params => executeRead(
      () => rpc.call('taskboard/task/list', params),
      () => mockClient.listTaskboardTasks(params),
    ),
    readTaskboardTask: params => executeRead(
      () => rpc.call('taskboard/task/read', params),
      () => mockClient.readTaskboardTask(params),
    ),
    listTaskboardLabels: params => executeRead(
      () => rpc.call('taskboard/label/list', params),
      () => mockClient.listTaskboardLabels(params),
    ),
    readTaskboardStartStatus: params => executeRead(
      () => rpc.call('taskboard/task/start/status', params),
      () => mockClient.readTaskboardStartStatus(params),
    ),
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
    retryTaskboardStartSetup: params => execute(() => rpc.call('taskboard/task/start/retry-setup', params)),
    continueTaskboardStartWithoutSetup: params => execute(() => rpc.call(
      'taskboard/task/start/continue-without-setup',
      params,
    )),
  }
}
