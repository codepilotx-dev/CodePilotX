import type {
  ModelRef,
} from '@codepilotx/shared'
import type {
  PermissionConfig,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { desktopUserMessageInputToPreviewText } from '../../../shared/desktopUserMessage.js'
import type {
  DesktopModelSelection,
  DesktopSessionSnapshot,
  DesktopUserMessageInput,
} from '../../../shared/types.js'
import { createAgentRpcClient } from '../agentRpcClient.js'

type AgentRpcClient = ReturnType<typeof createAgentRpcClient>
type QueueStateResult = RpcResult<'queue/update'>

export type AgentMessageDelivery = 'start' | 'steer' | 'follow-up'

export type AgentMessageAdmission = {
  inputId: string
  outcome: 'sent' | 'steered' | 'queued'
}

type AgentTurnQueueClientDependencies = {
  rpc: AgentRpcClient
  awaitPendingSettingsUpdate: (sessionId: string) => Promise<void>
  importAttachments: (input: DesktopUserMessageInput) => Promise<string[]>
  resolveModelRef: (
    model: string | DesktopModelSelection | undefined,
    sessionId: string,
  ) => Promise<ModelRef>
  permissionConfigForSession: (sessionId: string) => PermissionConfig
  taskModeForSession: (sessionId: string) => 'chat' | 'plan'
  queueVersionForSession: (sessionId: string) => number | undefined
  loadThreadSnapshot: (sessionId: string) => Promise<ThreadSnapshot>
  refreshSession: (sessionId: string) => Promise<DesktopSessionSnapshot>
  emitSessionStoreChange: () => void
}

export function createAgentTurnQueueClient({
  rpc,
  awaitPendingSettingsUpdate,
  importAttachments,
  resolveModelRef,
  permissionConfigForSession,
  taskModeForSession,
  queueVersionForSession,
  loadThreadSnapshot,
  refreshSession,
  emitSessionStoreChange,
}: AgentTurnQueueClientDependencies) {
  async function submitMessage(
    sessionId: string,
    input: DesktopUserMessageInput,
    delivery: AgentMessageDelivery,
    options?: {
      inputId?: string
      model?: string | DesktopModelSelection
    },
  ): Promise<AgentMessageAdmission> {
    await awaitPendingSettingsUpdate(sessionId)
    const attachmentIds = await importAttachments(input)
    const content = desktopUserMessageInputToPreviewText(input)
    const inputId = options?.inputId ?? crypto.randomUUID()

    if (delivery === 'steer') {
      const current = await loadThreadSnapshot(sessionId)
      const activeTurn = findActiveTurn(current)
      if (activeTurn) {
        await rpc.call('turn/steer', {
          threadId: sessionId,
          turnId: activeTurn.id,
          inputId,
          content,
          ...(attachmentIds.length ? { attachmentIds } : {}),
        })
        await refreshSession(sessionId).catch(() => null)
        emitSessionStoreChange()
        return { inputId, outcome: 'steered' }
      }
      await startTurn(sessionId, inputId, content, attachmentIds, options?.model)
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      return { inputId, outcome: 'sent' }
    }

    if (delivery === 'follow-up') {
      const expectedVersion = queueVersionForSession(sessionId)
      const admission = await rpc.call('queue/add', {
        threadId: sessionId,
        inputId,
        content,
        model: await resolveModelRef(options?.model, sessionId),
        permissionConfig: permissionConfigForSession(sessionId),
        taskMode: taskModeForSession(sessionId),
        operationId: crypto.randomUUID(),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      })
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      return {
        inputId,
        outcome: admission.admission === 'queued' ? 'queued' : 'sent',
      }
    }

    await startTurn(sessionId, inputId, content, attachmentIds, options?.model)
    await refreshSession(sessionId).catch(() => null)
    emitSessionStoreChange()
    return { inputId, outcome: 'sent' }
  }

  async function callQueueMutation(
    sessionId: string,
    method: 'queue/update' | 'queue/remove' | 'queue/resume',
    params: Record<string, unknown>,
  ): Promise<QueueStateResult> {
    const expectedVersion = queueVersionForSession(sessionId)
    try {
      return await rpc.call<QueueStateResult>(method, {
        threadId: sessionId,
        ...params,
        operationId: crypto.randomUUID(),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
      })
    } catch (error) {
      await refreshSession(sessionId).catch(() => null)
      emitSessionStoreChange()
      throw error
    }
  }

  async function interrupt(sessionId: string): Promise<void> {
    const current = await loadThreadSnapshot(sessionId)
    const activeTurn = findActiveTurn(current)
    if (!activeTurn) return
    await rpc.call('turn/interrupt', {
      threadId: sessionId,
      turnId: activeTurn.id,
      operationId: crypto.randomUUID(),
    })
  }

  async function startTurn(
    sessionId: string,
    inputId: string,
    content: string,
    attachmentIds: string[],
    model: string | DesktopModelSelection | undefined,
  ): Promise<void> {
    await rpc.call('turn/start', {
      threadId: sessionId,
      inputId,
      content,
      model: await resolveModelRef(model, sessionId),
      permissionConfig: permissionConfigForSession(sessionId),
      taskMode: taskModeForSession(sessionId),
      ...(attachmentIds.length ? { attachmentIds } : {}),
    })
  }

  return {
    callQueueMutation,
    interrupt,
    submitMessage,
  }
}

function findActiveTurn(snapshot: ThreadSnapshot) {
  return [...snapshot.turns].reverse().find(turn =>
    turn.status === 'running' || turn.status.startsWith('waiting-'),
  )
}
