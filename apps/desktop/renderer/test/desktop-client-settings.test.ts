import { describe, expect, test } from 'bun:test'
import type { Project } from '@codepilotx/shared'
import type {
  ThreadListItem,
  ThreadSettings,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import { createDesktopClient } from '../src/services/desktopClient.js'

const now = 1_700_000_000_000
const defaultSettings: ThreadSettings = {
  taskMode: 'chat',
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  },
}
const project: Project = {
  id: 'project-1',
  name: 'CodePilotX-Ts',
  rootPath: 'F:\\CodeProject\\CodePilotX-Ts',
  lastOpenedAt: now,
  createdAt: now,
  updatedAt: now,
  settings: {
    defaultModel: null,
    plannerModel: null,
    developerModel: null,
    reviewerModel: null,
  },
}

describe('desktop thread settings client', () => {
  test('uses initial settings for the first turn and serializes immediate updates', async () => {
    let settings: ThreadSettings = {
      taskMode: 'plan',
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
    }
    const methods: string[] = []
    const turnStarts: unknown[] = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialize') return rpc(body.id, { ok: true, capabilities: { prompt: 2, memory: 2, compact: 1, hookTrust: 1 } })
      if (body?.method === 'project/open') return rpc(body.id, { project })
      if (body?.method === 'project/list') return rpc(body.id, { projects: [project] })
      if (body?.method === 'thread/create') {
        expect(params).toEqual({
          projectID: project.id,
          settings,
          title: 'Plan 会话',
        })
        return rpc(body.id, snapshot('session-1', settings))
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [listItem('session-1', settings)],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        return rpc(body.id, snapshot(params.threadId, settings))
      }
      if (body?.method === 'thread/settings/update') {
        methods.push(body.method)
        settings = { ...settings, ...params.settings }
        await Promise.resolve()
        return rpc(body.id, { threadId: params.threadId, settings })
      }
      if (body?.method === 'model/list') return rpc(body.id, modelCatalog())
      if (body?.method === 'turn/start') {
        methods.push(body.method)
        turnStarts.push(params)
        return rpc(body.id, { input: null, turn: null })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    const created = await client.createSession({
      workspacePath: project.rootPath,
      sessionName: 'Plan 会话',
      permissionConfig: settings.permissionConfig,
      planModeActive: true,
    })

    await client.sendUserMessage(created.sessionId, { text: '首轮' })
    expect(turnStarts[0]).toMatchObject({
      permissionConfig: settings.permissionConfig,
      taskMode: 'plan',
    })

    const planUpdate = client.setSessionPlanModeActive('session-1', false)
    const permissionUpdate = client.setSessionPermissionMode(
      'session-1',
      'full-access',
    )
    const send = client.sendUserMessage('session-1', { text: '立即发送' })
    const [, permissionSnapshot] = await Promise.all([
      planUpdate,
      permissionUpdate,
      send,
    ])

    expect(methods).toEqual([
      'turn/start',
      'thread/settings/update',
      'thread/settings/update',
      'turn/start',
    ])
    expect(turnStarts[1]).toMatchObject({
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'auto_review',
      },
      taskMode: 'chat',
    })
    expect(permissionSnapshot.item.permissionMode).toBe('full-access')
    expect(permissionSnapshot.item.planModeActive).toBe(false)
  })

  test('returns explicit unsupported errors instead of entering the mock map', async () => {
    const compactRequests: unknown[] = []
    const settingsRequests: unknown[] = []
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialize') return rpc(body.id, { ok: true, capabilities: { prompt: 2, memory: 2, compact: 1, hookTrust: 1 } })
        if (body?.method === 'project/list') return rpc(body.id, { projects: [project] })
        if (body?.method === 'thread/compact') {
          compactRequests.push(body.params)
          return rpc(body.id, { compaction: { id: 'compaction-1' } })
        }
        if (body?.method === 'thread/read') {
          return rpc(body.id, snapshot(body.params.threadId, defaultSettings))
        }
        if (body?.method === 'thread/settings/update') {
          settingsRequests.push(body.params)
          return rpc(body.id, {
            threadId: body.params.threadId,
            settings: { ...defaultSettings, ...body.params.settings },
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })
    await client.compactSession('real-uuid')
    expect(compactRequests).toEqual([{ threadId: 'real-uuid' }])
    await client.setSessionPermissionProfile('real-uuid', 'read-only', 'never')
    expect(settingsRequests).toEqual([{
      threadId: 'real-uuid',
      settings: {
        permissionConfig: {
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
        },
      },
    }])

    const unsupported: Array<[string, () => Promise<unknown>]> = [
      ['getMcpRuntimeStatus', () => client.getMcpRuntimeStatus('real-uuid')],
      ['restoreSessionTurnChanges', () => client.restoreSessionTurnChanges({ sessionId: 'real-uuid' } as never)],
      ['saveSessionReviewComment', () => client.saveSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['resolveSessionReviewComment', () => client.resolveSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['deleteSessionReviewComment', () => client.deleteSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['setSessionLocalRouterMode', () => client.setSessionLocalRouterMode('real-uuid', 'off')],
      ['updateQueuedFollowUp', () => client.updateQueuedFollowUp('real-uuid', 'follow-up', { text: 'x' })],
      ['removeQueuedFollowUp', () => client.removeQueuedFollowUp('real-uuid', 'follow-up')],
      ['sendQueuedFollowUpNow', () => client.sendQueuedFollowUpNow('real-uuid', 'follow-up')],
      ['rollbackSession', () => client.rollbackSession({ sessionId: 'real-uuid' } as never)],
      ['getSessionGoal', () => client.getSessionGoal('real-uuid')],
      ['setSessionGoal', () => client.setSessionGoal('real-uuid', {})],
      ['clearSessionGoal', () => client.clearSessionGoal('real-uuid')],
      ['startSessionReview', () => client.startSessionReview('real-uuid', { type: 'uncommittedChanges' })],
    ]

    for (const [operation, invoke] of unsupported) {
      try {
        await invoke()
        throw new Error(`${operation} unexpectedly succeeded`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).toContain('AGENT_OPERATION_UNSUPPORTED')
        expect(message).toContain(operation)
        expect(message).not.toContain('Mock session not found')
      }
    }
  })

  test('reports unavailable without mock fallback and preserves browser mock behavior', async () => {
    const unavailable = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => null,
        },
      },
    })
    expect(await unavailable.getSessionCatalogStatus()).toMatchObject({
      state: 'unavailable',
    })

    const browser = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
    })
    const created = await browser.createSession({ sessionName: 'mock' })
    const updated = await browser.setSessionPermissionMode(
      created.sessionId,
      'auto-review',
    )
    expect(created.sessionId).toStartWith('browser-mock-')
    expect(updated.item.permissionMode).toBe('auto-review')
  })

  test('refreshes only the thread named by a settings notification', async () => {
    const readThreadIds: string[] = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialize') return rpc(body.id, { ok: true, capabilities: { prompt: 2, memory: 2, compact: 1, hookTrust: 1 } })
      if (body?.method === 'project/list') return rpc(body.id, { projects: [project] })
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [
            listItem('session-1', defaultSettings),
            listItem('session-2', defaultSettings),
          ],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        readThreadIds.push(params.threadId)
        return rpc(body.id, snapshot(params.threadId, defaultSettings))
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    const unsubscribe = client.onAgentEvent(() => {})
    source.onmessage?.({
      data: JSON.stringify({
        method: 'thread/settings/updated',
        params: { threadId: 'session-2', settings: defaultSettings },
      }),
    } as MessageEvent)
    await new Promise(resolve => setTimeout(resolve, 350))
    unsubscribe()

    expect(readThreadIds).toEqual(['session-2'])
  })
})

function listItem(id: string, settings: ThreadSettings): ThreadListItem {
  return {
    id,
    projectID: project.id,
    title: 'Session',
    preview: null,
    firstUserMessage: null,
    messageCount: 0,
    latestTurnStatus: null,
    archivedAt: null,
    settings,
    createdAt: now,
    updatedAt: now,
  }
}

function snapshot(id: string, settings: ThreadSettings): ThreadSnapshot {
  return {
    thread: {
      id,
      title: 'Session',
      projectID: project.id,
      settings,
      createdAt: now,
      updatedAt: now,
    },
    turns: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
  }
}

function modelCatalog() {
  return {
    providers: [{
      provider: {
        id: 'openai',
        name: 'OpenAI',
        api: { type: 'native', settings: {} },
        request: { headers: {}, body: {} },
      },
      models: [{
        id: 'gpt-5',
        providerID: 'openai',
        name: 'GPT-5',
        api: { id: 'gpt-5', type: 'native', settings: {} },
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        request: { headers: {}, body: {} },
        variants: [],
        time: { released: now },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: 128_000, output: 8_192 },
      }],
    }],
    defaultModel: { providerID: 'openai', id: 'gpt-5' },
    reviewerModel: null,
  }
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}
