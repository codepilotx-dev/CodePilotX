import { describe, expect, test } from 'bun:test'
import type { Project } from '@codepilotx/shared'
import type {
  ThreadListItem,
  ThreadSettings,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import {
  createDesktopClient,
  startGithubLoginFlow,
} from '../src/services/desktop-client/index.js'

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
const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  workspaceRoot: project.rootPath,
  cwd: project.rootPath,
  outputDirectory: null,
}

describe('desktop thread settings client', () => {
  test('routes tooling management and live updates through RPC v4', async () => {
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const toolingStatus = {
      id: 'ripgrep' as const,
      preference: 'managed' as const,
      phase: 'ready' as const,
      activeSource: 'managed' as const,
      pinnedVersion: '15.2.0',
      managed: { installed: true, version: '15.2.0' },
      system: { available: false, version: null, path: null },
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'tooling/list') {
        return rpc(body.id, { statuses: [toolingStatus] })
      }
      if (body?.method === 'tooling/refresh') {
        expect(body.params).toEqual({})
        return rpc(body.id, { statuses: [toolingStatus] })
      }
      if (body?.method === 'tooling/setPreference') {
        expect(body.params).toMatchObject({
          id: 'ripgrep',
          preference: 'system',
          operationId: expect.any(String),
        })
        return rpc(body.id, {
          status: { ...toolingStatus, preference: 'system' },
        })
      }
      if (body?.method === 'tooling/install') {
        expect(body.params).toMatchObject({
          id: 'ripgrep',
          force: true,
          operationId: expect.any(String),
        })
        return rpc(body.id, { status: toolingStatus })
      }
      if (body?.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'tooling-subscription',
          highWatermarks: [{ streamId: 'global', sequence: 3 }],
        })
      }
      if (body?.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: body.params.subscriptionId,
          acknowledged: body.params.positions,
        })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })

    expect(await client.listTooling()).toEqual([toolingStatus])
    expect(await client.refreshTooling()).toEqual([toolingStatus])
    expect(
      (await client.setToolingPreference('ripgrep', 'system')).preference,
    ).toBe('system')
    expect(await client.installTooling('ripgrep', true)).toEqual(toolingStatus)

    const updates: unknown[] = []
    const unsubscribe = client.onToolingUpdated(status => updates.push(status))
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    source.onmessage?.({
      data: JSON.stringify({
        method: 'event/next',
        params: {
          subscriptionId: 'tooling-subscription',
          event: {
            eventId: 'tooling-event-4',
            streamId: 'global',
            type: 'tooling/updated',
            version: 1,
            occurredAt: now,
            durability: 'live',
            sequence: null,
            afterSequence: 3,
            payload: { status: toolingStatus },
          },
        },
      }),
    } as MessageEvent)
    expect(updates).toEqual([toolingStatus])
    unsubscribe()
  })

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
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'project/open') return rpc(body.id, { project })
      if (body?.method === 'project/list') return rpc(body.id, { projects: [project], nextCursor: null })
      if (body?.method === 'thread/create') {
        expect(params).toEqual({
          workspace: { kind: 'project', projectId: project.id },
          settings,
          title: 'Plan 会话',
          operationId: expect.any(String),
        })
        return rpc(body.id, snapshotResult(snapshot('session-1', settings)))
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [listItem('session-1', settings)],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        return rpc(body.id, snapshotResult(snapshot(params.threadId, settings)))
      }
      if (body?.method === 'thread/settings/update') {
        methods.push(body.method)
        settings = { ...settings, ...params.settings }
        await Promise.resolve()
        return rpc(body.id, {
          threadId: params.threadId,
          settings,
          version: 1,
        })
      }
      if (body?.method === 'model/list') return rpc(body.id, modelCatalog())
      if (body?.method === 'turn/start') {
        methods.push(body.method)
        turnStarts.push(params)
        return rpc(body.id, {
          inputId: params.inputId,
          turnId: 'turn-1',
          disposition: 'accepted',
          streamPosition: {
            streamId: params.threadId,
            sequence: 1,
          },
        })
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
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'project/list') return rpc(body.id, { projects: [project], nextCursor: null })
        if (body?.method === 'thread/compact') {
          compactRequests.push(body.params)
          return rpc(body.id, {
            compaction: {
              id: 'compaction-1',
              beforeCount: 10,
              afterCount: 5,
              beforeTokens: 100,
              afterTokens: 50,
              targetTokens: 60,
              usageSampleId: 'usage-1',
              baselineVersion: 1,
            },
          })
        }
        if (body?.method === 'thread/read') {
          return rpc(
            body.id,
            snapshotResult(snapshot(body.params.threadId, defaultSettings)),
          )
        }
        if (body?.method === 'thread/settings/update') {
          settingsRequests.push(body.params)
          return rpc(body.id, {
            threadId: body.params.threadId,
            settings: { ...defaultSettings, ...body.params.settings },
            version: 1,
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })
    await client.compactSession('real-uuid')
    expect(compactRequests).toEqual([{
      threadId: 'real-uuid',
      operationId: expect.any(String),
    }])
    await client.setSessionPermissionProfile('real-uuid', 'read-only', 'never')
    expect(settingsRequests).toEqual([{
      threadId: 'real-uuid',
      operationId: expect.any(String),
      settings: {
        permissionConfig: {
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
        },
      },
    }])

    const unsupported: Array<[string, () => Promise<unknown>]> = [
      ['restoreSessionTurnChanges', () => client.restoreSessionTurnChanges({ sessionId: 'real-uuid' } as never)],
      ['saveSessionReviewComment', () => client.saveSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['resolveSessionReviewComment', () => client.resolveSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['deleteSessionReviewComment', () => client.deleteSessionReviewComment({ sessionId: 'real-uuid' } as never)],
      ['setSessionLocalRouterMode', () => client.setSessionLocalRouterMode('real-uuid', 'off')],
      ['rollbackSession', () => client.rollbackSession({ sessionId: 'real-uuid' } as never)],
      ['getSessionGoal', () => client.getSessionGoal('real-uuid')],
      ['setSessionGoal', () => client.setSessionGoal('real-uuid', {})],
      ['clearSessionGoal', () => client.clearSessionGoal('real-uuid')],
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

  test('routes MCP management through RPC with the current workspace', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const server = {
      name: 'fixture',
      scope: 'local' as const,
      enabled: true,
      diagnosticContext: true,
      transport: {
        type: 'stdio' as const,
        command: 'bun',
        args: ['fixture.ts'],
      },
    }
    const listResult = {
      servers: [{ server, effective: true }],
      generation: 4,
    }
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        requests.push({ method: body.method, params: body.params })
        if (body.method === 'mcp/status') {
          return rpc(body.id, {
            servers: [{
              name: 'fixture',
              scope: 'local',
              type: 'stdio',
              state: 'connected',
              auth: { source: 'none', canLogin: false, canLogout: false },
              toolCount: 2,
              resourceCount: 1,
              promptCount: 1,
            }],
            totalTools: 2,
            totalResources: 1,
            totalPrompts: 1,
            generation: 4,
          })
        }
        if (body.method === 'mcp/reload') {
          return rpc(body.id, {
            generation: 5,
            added: [],
            replaced: ['fixture'],
            removed: [],
            unchanged: [],
            failed: [],
          })
        }
        if (body.method === 'mcp/oauth/start') {
          return rpc(body.id, {
            attemptId: 'oauth-attempt',
            authorizationUrl: 'https://example.com/oauth',
            expiresAt: Date.now() + 60_000,
          })
        }
        if (body.method === 'mcp/oauth/status') {
          return rpc(body.id, { state: 'completed' })
        }
        if (body.method === 'mcp/oauth/logout') {
          return rpc(body.id, { generation: 6 })
        }
        return rpc(body.id, listResult)
      },
    })

    expect(await client.listMcpServers(project.rootPath)).toMatchObject([{
      name: 'fixture',
      scope: 'local',
      effective: true,
      diagnosticContext: true,
    }])
    expect(await client.getMcpRuntimeStatus(project.rootPath)).toMatchObject({
      servers: [{ name: 'fixture', state: 'connected', toolCount: 2 }],
    })
    await client.saveMcpServer({
      ...server,
      workspacePath: project.rootPath,
      originalName: 'old-fixture',
    })
    await client.setMcpServerEnabled('fixture', 'local', false, project.rootPath)
    await client.removeMcpServer('fixture', 'local', project.rootPath)
    await client.reloadMcpConfiguration(project.rootPath)
    const oauth = await client.startMcpOAuth('fixture', 'local', project.rootPath)
    expect(oauth.attemptId).toBe('oauth-attempt')
    expect(await client.getMcpOAuthStatus(oauth.attemptId)).toEqual({
      state: 'completed',
    })
    expect(await client.logoutMcpOAuth('fixture', 'local', project.rootPath)).toEqual({
      generation: 6,
    })

    expect(requests.map(request => request.method)).toEqual([
      'mcp/list',
      'mcp/status',
      'mcp/save',
      'mcp/setEnabled',
      'mcp/remove',
      'mcp/reload',
      'mcp/oauth/start',
      'mcp/oauth/status',
      'mcp/oauth/logout',
    ])
    for (const request of requests.filter(request => request.method !== 'mcp/oauth/status')) {
      expect(request.params.workspace).toBe(project.rootPath)
    }
    expect(requests[7]?.params).toEqual({ attemptId: 'oauth-attempt' })
    expect(requests[2]?.params).toMatchObject({
      originalName: 'old-fixture',
      operationId: expect.any(String),
      server,
    })
    expect(requests[3]?.params).toMatchObject({
      name: 'fixture',
      scope: 'local',
      enabled: false,
      operationId: expect.any(String),
    })
  })

  test('starts AI Review with the persisted delivery preference', async () => {
    const requests: unknown[] = []
    const client = createDesktopClient({
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => null,
          getDesktopSettings: async () => ({ reviewDelivery: 'detached' }),
        },
      },
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') {
          return rpc(body.id, initializedResult())
        }
        if (body?.method === 'review/ai/start') {
          requests.push(body.params)
          return rpc(body.id, {
            threadId: 'review-thread',
            turnId: 'review-turn',
            delivery: 'detached',
            source: { kind: 'branch', baseBranch: 'main' },
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })

    const result = await client.startSessionReview('source-thread', {
      type: 'baseBranch',
      branch: 'main',
    })

    expect(requests).toEqual([
      {
        threadId: 'source-thread',
        target: { type: 'baseBranch', branch: 'main' },
        delivery: 'detached',
      },
    ])
    expect(result).toMatchObject({
      threadId: 'review-thread',
      delivery: 'detached',
      source: { kind: 'branch', baseBranch: 'main' },
    })
  })

  test('uses real queue RPCs with optimistic queue versions', async () => {
    const queueRequests: Array<{ method: string; params: Record<string, unknown> }> = []
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'project/list') return rpc(body.id, { projects: [project], nextCursor: null })
      if (body?.method === 'thread/read') {
        return rpc(body.id, snapshotResult({
          ...snapshot(body.params.threadId, defaultSettings),
          queue: { version: 7, pauseReason: null },
        }))
      }
      if (typeof body?.method === 'string' && body.method.startsWith('queue/')) {
        queueRequests.push({ method: body.method, params: body.params })
        return rpc(body.id, {
          threadId: body.params.threadId,
          version: 8,
          pauseReason: null,
          turns: [],
          inputs: [],
          streamPosition: { streamId: 'stream-1', sequence: 8 },
        })
      }
      throw new Error(`Unexpected RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    await client.getSession('thread-queue')

    await client.updateQueuedFollowUp('thread-queue', 'input-1', { text: '更新' })
    await client.removeQueuedFollowUp('thread-queue', 'input-2')
    await client.sendQueuedFollowUpNow('thread-queue', 'input-3')
    await client.reorderQueuedFollowUps('thread-queue', ['input-3', 'input-1'])
    await client.resumeQueuedFollowUps('thread-queue')

    expect(queueRequests.map(request => request.method)).toEqual([
      'queue/update',
      'queue/remove',
      'queue/steer',
      'queue/reorder',
      'queue/resume',
    ])
    for (const request of queueRequests) {
      expect(request.params).toMatchObject({
        threadId: 'thread-queue',
        operationId: expect.any(String),
        expectedVersion: 7,
      })
    }
    expect(queueRequests[0]?.params).not.toHaveProperty('attachmentIds')
  })

  test('uses turn steer for an active follow-up without legacy strategy params', async () => {
    let steerParams: Record<string, unknown> | null = null
    const activeSnapshot = (): ThreadSnapshot => ({
      ...snapshot('thread-active', defaultSettings),
      turns: [{
        id: 'turn-active', threadId: 'thread-active', sourceInputID: 'input-active', status: 'running', mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-5' }, permissionConfig: defaultSettings.permissionConfig,
        rootAgentId: 'agent-active', canContinueFromPlan: false, mergedInputIDs: [],
        startedAt: now, finishedAt: null, elapsedSeconds: 1, error: null,
      }],
    })
    const client = createDesktopClient({
      fetch: async (_path, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        if (body?.method === 'initialized') return new Response(null, { status: 204 })
        if (body?.method === 'initialize') return rpc(body.id, initializedResult())
        if (body?.method === 'project/list') return rpc(body.id, { projects: [project], nextCursor: null })
        if (body?.method === 'thread/read') {
          return rpc(body.id, snapshotResult(activeSnapshot()))
        }
        if (body?.method === 'turn/steer') {
          steerParams = body.params
          return rpc(body.id, {
            inputId: body.params.inputId,
            turnId: 'turn-active',
            disposition: 'accepted',
            streamPosition: {
              streamId: 'thread-active',
              sequence: 1,
            },
          })
        }
        throw new Error(`Unexpected RPC method: ${body?.method}`)
      },
    })
    await client.getSession('thread-active')
    await client.submitSessionFollowUp('thread-active', { text: '补充要求' }, 'steer')

    expect(steerParams).toMatchObject({
      threadId: 'thread-active',
      turnId: 'turn-active',
      inputId: expect.any(String),
      content: '补充要求',
    })
    expect(steerParams).not.toHaveProperty('strategy')
    expect(steerParams).not.toHaveProperty('model')
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
    let subscriptionCount = 0
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'event/subscribe') {
        subscriptionCount += 1
        return rpc(body.id, {
          subscriptionId: `subscription-${subscriptionCount}`,
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
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
        return rpc(
          body.id,
          snapshotResult(snapshot(params.threadId, defaultSettings)),
        )
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    const unsubscribe = client.onAgentEvent(() => {})
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    source.onmessage?.({
      data: JSON.stringify({
        method: 'event/next',
        params: {
          subscriptionId: 'subscription-1',
          event: {
            eventId: 'event-13',
            type: 'thread/settings/updated',
            version: 1,
            occurredAt: now,
            threadId: 'session-2',
            durability: 'durable',
            sequence: 13,
            payload: {
              threadId: 'session-2',
              settings: defaultSettings,
              version: 1,
            },
          },
        },
      }),
    } as MessageEvent)
    await new Promise(resolve => setTimeout(resolve, 350))
    unsubscribe()

    expect(readThreadIds).toEqual(['session-2'])
  })

  test('reconciles the active thread after event replay completes', async () => {
    let completed = false
    const readThreadIds: string[] = []
    const observedStatuses: string[] = []
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const currentSnapshot = (): ThreadSnapshot => ({
      ...snapshot('session-1', defaultSettings),
      turns: [{
        id: 'turn-1',
        threadId: 'session-1',
        sourceInputID: 'input-1',
        status: completed ? 'completed' : 'running',
        mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-5' },
        permissionConfig: defaultSettings.permissionConfig,
        rootAgentId: 'agent-1',
        canContinueFromPlan: false,
        mergedInputIDs: [],
        startedAt: now,
        finishedAt: completed ? now + 1_000 : null,
        elapsedSeconds: completed ? 1 : 0,
        error: null,
      }],
    })
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'event/subscribe') {
        expect(params.streams).toEqual([{ streamId: 'global', after: 'latest' }])
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 12 }],
        })
      }
      if (body?.method === 'event/unsubscribe') return rpc(body.id, { ok: true })
      if (body?.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: params.subscriptionId,
          acknowledged: params.positions,
        })
      }
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'thread/list') {
        return rpc(body.id, {
          threads: [{
            ...listItem('session-1', defaultSettings),
            latestTurnStatus: completed ? 'completed' : 'running',
          }],
          nextCursor: null,
        })
      }
      if (body?.method === 'thread/read') {
        readThreadIds.push(params.threadId)
        return rpc(body.id, snapshotResult(currentSnapshot()))
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      eventSourceFactory: () => source as unknown as EventSource,
    })
    await client.listSessions()
    await client.setActiveSession('session-1')
    const unsubscribeStore = client.onSessionStoreChange(change => {
      const status = change.sessions.find(item => item.item.id === 'session-1')?.item.status
      if (status) observedStatuses.push(status)
    })
    const unsubscribeEvents = client.onAgentEvent(() => {})
    for (let index = 0; index < 20 && !source.onmessage; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    completed = true
    source.onmessage?.({
      data: JSON.stringify({
        method: 'event/replayComplete',
        params: {
          subscriptionId: 'subscription-1',
          positions: [{ streamId: 'global', sequence: 12 }],
        },
      }),
    } as MessageEvent)
    for (
      let index = 0;
      index < 50 && !observedStatuses.includes('done');
      index += 1
    ) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    unsubscribeEvents()
    unsubscribeStore()

    expect(readThreadIds).toEqual(['session-1'])
    expect(observedStatuses).toContain('done')
  })

  test('routes GitHub auth, profile, repositories, push and PR creation through Agent RPC', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const githubUser = {
      login: 'octocat',
      id: 1,
      name: 'Octocat',
      avatarUrl: null,
      htmlUrl: 'https://github.com/octocat',
    }
    const auth = { configured: true, authenticated: true, user: githubUser }
    const login = {
      loginId: 'login-1',
      mode: 'browser',
      state: 'awaiting_auth',
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=fixture',
      userCode: null,
      verificationUri: null,
      expiresAt: '2026-07-18T00:00:00.000Z',
      error: null,
      auth: null,
      elapsedMs: 0,
    }
    const fetcher = async (_path: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method !== 'initialize') {
        requests.push({ method: body.method, params })
      }
      switch (body?.method) {
        case 'initialize':
          return rpc(body.id, initializedResult())
        case 'github/auth/status':
          return rpc(body.id, auth)
        case 'github/auth/start':
        case 'github/auth/poll':
          return rpc(body.id, login)
        case 'github/auth/logout':
          return rpc(body.id, { configured: true, authenticated: false, user: null })
        case 'github/repositories':
          return rpc(body.id, { repositories: [] })
        case 'github/profileOverview':
          return rpc(body.id, {
            overview: {
              user: {
                ...githubUser,
                bio: null,
                company: null,
                location: null,
                websiteUrl: null,
                email: null,
                followers: 0,
                following: 0,
                repositoryCount: 0,
                starredRepositoryCount: 0,
                status: null,
              },
              organizations: [],
              pinnedRepositories: [],
              popularRepositories: [],
              contributions: {
                totalContributions: 0,
                totalCommitContributions: 0,
                totalIssueContributions: 0,
                totalPullRequestContributions: 0,
                totalPullRequestReviewContributions: 0,
                restrictedContributionsCount: 0,
                weeks: [],
              },
            },
          })
        case 'project/list':
          return rpc(body.id, { projects: [project], nextCursor: null })
        case 'project/open':
          return rpc(body.id, { project })
        case 'github/push':
          return rpc(body.id, {
            remote: 'origin',
            branch: 'feature',
            repositoryUrl: 'https://github.com/octocat/repo',
            status: {
              branchName: 'feature',
              upstream: 'origin/feature',
              ahead: 0,
              behind: 0,
              clean: true,
              files: [],
            },
          })
        case 'github/pullRequest/createForProject':
          return rpc(body.id, {
            pullRequest: {
              id: 7,
              number: 7,
              title: 'PR title',
              body: 'PR body',
              state: 'open',
              draft: true,
              htmlUrl: 'https://github.com/octocat/repo/pull/7',
              base: { ref: 'main', sha: 'base-sha' },
              head: { ref: 'feature', sha: 'head-sha' },
              additions: 1,
              deletions: 0,
              changedFiles: 1,
              mergeable: true,
            },
          })
        default:
          throw new Error(`Unexpected RPC method: ${body?.method}`)
      }
    }
    const client = createDesktopClient({ fetch: fetcher })

    expect(await client.getGithubAuthStatus()).toEqual(auth)
    expect(await client.startGithubLogin({ mode: 'browser' })).toEqual(login)
    expect(await client.pollGithubLogin()).toEqual(login)
    expect(await client.listGithubRepositories()).toEqual({ ok: true, repositories: [] })
    expect(await client.getGithubProfileOverview()).toMatchObject({
      ok: true,
      overview: { user: { login: 'octocat' } },
    })
    expect(await client.pushWorkspaceBranch({
      workspacePath: project.rootPath,
      setUpstream: true,
      forceWithLease: false,
    })).toMatchObject({ ok: true, status: { branchName: 'feature' } })
    expect(await client.createPullRequest({
      workspacePath: project.rootPath,
      title: 'PR title',
      body: 'PR body',
      draft: true,
    })).toEqual({
      ok: true,
      url: 'https://github.com/octocat/repo/pull/7',
      output: '已创建 Pull Request #7',
    })
    expect(await client.logoutGithub()).toEqual({
      configured: true,
      authenticated: false,
      user: null,
    })

    expect(requests).toContainEqual({
      method: 'github/auth/start',
      params: { mode: 'browser' },
    })
    expect(requests).toContainEqual({
      method: 'github/push',
      params: {
        projectId: project.id,
        setUpstream: true,
        forceWithLease: false,
      },
    })
    expect(requests).toContainEqual({
      method: 'github/pullRequest/createForProject',
      params: {
        projectId: project.id,
        title: 'PR title',
        body: 'PR body',
        draft: true,
      },
    })
  })

  test('opens browser authorization URLs and preserves launch failures', async () => {
    const opened: string[] = []
    const login = {
      loginId: 'login-browser',
      mode: 'browser' as const,
      state: 'awaiting_auth' as const,
      authorizationUrl: 'https://github.com/login/oauth/authorize?client_id=fixture',
      userCode: null,
      verificationUri: null,
      expiresAt: '2026-07-25T10:00:00.000Z',
      error: null,
      auth: null,
      elapsedMs: 0,
    }

    expect(await startGithubLoginFlow({
      startGithubLogin: async input => ({ ...login, mode: input.mode }),
      openExternalURL: async url => {
        opened.push(url)
      },
    }, 'browser')).toEqual(login)
    expect(opened).toEqual([login.authorizationUrl])

    const failed = await startGithubLoginFlow({
      startGithubLogin: async () => login,
      openExternalURL: async () => {
        throw new Error('无法打开系统浏览器')
      },
    }, 'browser')
    expect(failed).toMatchObject({
      loginId: login.loginId,
      mode: 'browser',
      state: 'failed',
      error: '无法打开系统浏览器',
    })

    const missingUrl = await startGithubLoginFlow({
      startGithubLogin: async () => ({ ...login, authorizationUrl: null }),
      openExternalURL: async () => {
        throw new Error('不应尝试打开空地址')
      },
    }, 'browser')
    expect(missingUrl).toMatchObject({
      state: 'failed',
      error: 'GitHub 登录服务未返回浏览器授权地址，请稍后重试。',
    })

    expect(await startGithubLoginFlow({
      startGithubLogin: async () => {
        throw new Error('登录服务不可用')
      },
      openExternalURL: async () => {},
    }, 'browser')).toMatchObject({
      loginId: null,
      mode: 'browser',
      state: 'failed',
      error: '登录服务不可用',
    })
  })
})

function listItem(id: string, settings: ThreadSettings): ThreadListItem {
  return {
    id,
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
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
      gitBranch: null,
      workspace: projectWorkspace,
      settings,
      createdAt: now,
      updatedAt: now,
    },
    turns: [],
    agents: [],
    subagents: [],
    inputs: [],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
  }
}

function snapshotResult(value: ThreadSnapshot) {
  return {
    snapshot: value,
    streamPosition: {
      streamId: value.thread.id,
      sequence: 1,
    },
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
    catalogVersion: 1,
  }
}

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: [
      'rpc.typed.v1',
      'events.replay.v1',
      'events.live.v1',
      'interactions.serverRequests.v1',
      'interaction.recovery.v1',
      'turn.admission.v1',
      'turn.steer.v1',
      'turn.queue.management.v1',
      'attachments.v1',
      'memory.v2',
      'workspace.editor.v1',
      'git.review.v1',
      'ai.review.v1',
      'github.oauth.v1',
      'github.pullRequests.v1',
      'context.compact.v1',
      'hooks.trust.v1',
      'subagents.v1',
      'sandbox.management.v1',
      'prompt.preview.sensitive.v1',
      'tooling.management.v1',
      'mcp.manage.v1',
      'mcp.oauth.v1',
    ],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
