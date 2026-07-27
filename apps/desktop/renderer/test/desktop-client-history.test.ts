import { describe, expect, test } from 'bun:test'
import type { Project } from '@codepilotx/shared'
import type { ThreadListItem, ThreadSnapshot } from '@codepilotx/shared/thread'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const now = 1_700_000_000_000
const projectRootPath = 'F:\\CodeProject\\CodePilotX-Ts'
const primaryFolder = {
  id: 'folder-primary',
  name: 'CodePilotX-Ts',
  path: projectRootPath,
  role: 'primary' as const,
  availability: 'available' as const,
  order: 0,
  createdAt: now,
  updatedAt: now,
}
const defaultThreadSettings = {
  taskMode: 'chat' as const,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
}

const project: Project = {
  id: 'project-1',
  name: 'CodePilotX-Ts',
  primaryFolderId: primaryFolder.id,
  folders: [primaryFolder],
  removedAt: null,
  lastOpenedAt: now,
  createdAt: now,
  updatedAt: now,
  settings: {
    defaultModel: null,
    instructions: '',
    version: 1,
  },
}
const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  cwd: projectRootPath,
  runtimeWorkspaceRoots: [{
    folderId: primaryFolder.id,
    path: projectRootPath,
    role: 'primary' as const,
  }],
  instructionSources: [],
  outputDirectory: null,
}

function sessionItem(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id: 'session-1',
    projectID: project.id,
    gitBranch: null,
    workspace: projectWorkspace,
    title: '历史会话',
    preview: '预览',
    firstUserMessage: '第一条消息',
    messageCount: 1,
    latestTurnStatus: 'completed',
    archivedAt: null,
    settings: defaultThreadSettings,
    createdAt: now,
    updatedAt: now + 1000,
    ...overrides,
  }
}

function sessionSnapshot(overrides: Partial<ThreadSnapshot['thread']> = {}): ThreadSnapshot {
  return {
    thread: {
      id: 'session-1',
      title: '历史会话',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      settings: defaultThreadSettings,
      createdAt: now,
      updatedAt: now + 1000,
      ...overrides,
    },
    turns: [],
    inputs: [
      {
        id: 'input-1',
        threadId: 'session-1',
        turnId: null,
        content: '第一条消息',
        delivery: 'start',
        mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-5' },
        permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
        state: 'completed',
        createdAt: now,
      },
    ],
    messages: [],
    items: [],
    approvals: [],
    proposals: [],
    agents: [],
    subagents: [],
  }
}

describe('desktop history client', () => {
  test('persists appearance settings through the minimal Electron bridge', async () => {
    let stored: unknown = {
      version: 2,
      mode: 'dark',
      codeThemeIds: { light: 'auto', dark: 'dracula' },
      pointerCursorEnabled: true,
      reduceMotion: 'on',
      fontSizes: { ui: 15, code: 13 },
    }
    const client = createDesktopClient({
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => null,
          getAppearanceSettings: async () => stored,
          saveAppearanceSettings: async settings => {
            stored = settings
            return settings
          },
        },
      },
    })

    const loaded = await client.getThemeSettings()
    expect(loaded).toMatchObject({
      version: 6,
      mode: 'system',
      codeThemeIds: { light: 'codex-light', dark: 'codex-dark' },
    })
    expect(loaded.chromeThemes.light).not.toHaveProperty('opaqueWindows')

    await client.saveThemeSettings({ ...loaded, mode: 'light' })
    expect(stored).toMatchObject({ version: 6, mode: 'light' })
  })

  test('uses agent fetch for list, create, get, message, rename, archive, and delete', async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = []
    let currentItem = sessionItem()
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ path, method, body })

      if (path !== '/rpc') throw new Error(`Unhandled request: ${method} ${path}`)
      const rpcMethod = body?.method
      const params = body?.params ?? {}
      if (rpcMethod === 'initialize') return rpc(body.id, initializedResult())
      if (rpcMethod === 'initialized') return new Response(null, { status: 204 })
      if (rpcMethod === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (rpcMethod === 'project/open') {
        expect(params).toEqual({
          projectId: project.id,
          operationId: expect.any(String),
        })
        return rpc(body.id, { project })
      }
      if (rpcMethod === 'thread/list') {
        return rpc(body.id, { threads: [currentItem], nextCursor: null })
      }
      if (rpcMethod === 'thread/create') {
        expect(params).toEqual({
          workspace: { kind: 'project', projectId: project.id },
          settings: defaultThreadSettings,
          title: '新会话',
          operationId: expect.any(String),
        })
        return rpc(body.id, snapshotResult(sessionSnapshot({ title: '新会话' })))
      }
      if (rpcMethod === 'thread/read') {
        return rpc(body.id, snapshotResult(sessionSnapshot()))
      }
      if (rpcMethod === 'model/list') {
        return rpc(body.id, {
          providers: [
            {
              provider: {
                id: 'openai',
                name: 'OpenAI',
                source: {
                  type: 'pi',
                  kind: 'builtin',
                  apis: ['openai-responses'],
                },
                auth: { apiKey: true, oauth: true },
              },
              models: [
                {
                  id: 'gpt-5',
                  providerID: 'openai',
                  name: 'GPT-5',
                  api: {
                    id: 'gpt-5',
                    type: 'pi',
                    name: 'openai-responses',
                    baseUrl: 'https://api.openai.com/v1',
                  },
                  capabilities: { tools: true, input: ['text'], output: ['text'] },
                  variants: [],
                  time: { released: now },
                  cost: [],
                  status: 'active',
                  enabled: true,
                  limit: { context: 128_000, output: 8_192 },
                },
              ],
            },
          ],
          defaultModel: { providerID: 'openai', id: 'gpt-5' },
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (rpcMethod === 'turn/start') {
        expect(params).toMatchObject({
          threadId: 'session-1',
          inputId: expect.any(String),
          content: '继续推进',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
          taskMode: 'chat',
        })
        return rpc(body.id, {
          inputId: 'input-2',
          turnId: 'turn-2',
          disposition: 'accepted',
          streamPosition: {
            streamId: 'session-1',
            sequence: 2,
          },
        })
      }
      if (rpcMethod === 'thread/update') {
        if (params.patch?.title) currentItem = sessionItem({ title: params.patch.title })
        if (params.patch?.archived === true) {
          currentItem = sessionItem({ archivedAt: now + 3000 })
        }
        return rpc(body.id, { thread: currentItem })
      }
      if (rpcMethod === 'thread/delete') {
        currentItem = sessionItem({ id: 'deleted' })
        return rpc(body.id, {
          threadId: params.threadId,
          deletedAt: now + 4000,
        })
      }
      throw new Error(`Unhandled RPC method: ${rpcMethod}`)
    }

    const client = createDesktopClient({ fetch: fetcher })

    const listed = await client.listSessions()
    expect(listed[0]?.item.workspacePath).toBe(projectRootPath)

    const created = await client.createSession({
      workspacePath: projectRootPath,
      sessionName: '新会话',
    })
    expect(created).toMatchObject({ sessionId: 'session-1', standalone: false })

    const snapshot = await client.getSession('session-1')
    expect(snapshot.view.messages[0]?.text).toBe('第一条消息')

    await client.sendUserMessage('session-1', { text: '继续推进' }, {
      providerID: 'openai',
      model: 'gpt-5',
    })

    const renamed = await client.renameSession('session-1', '改名后')
    expect(renamed.item.sessionName).toBe('改名后')

    const archived = await client.updateSessionMetadata('session-1', {
      archivedAt: new Date(now + 3000).toISOString(),
    })
    expect(archived.item.archivedAt).toBe('2023-11-14T22:13:23.000Z')

    await client.disposeSession('session-1')
    expect(requests.map(request => request.body).some(body => body?.method === 'thread/delete')).toBe(true)
  })

  test('falls back to browser mock when agent is unavailable', async () => {
    const client = createDesktopClient({
      fetch: async () => new Response('nope', { status: 503 }),
    })

    const created = await client.createSession({ sessionName: 'mock only' })

    expect(created.sessionId).toStartWith('browser-mock-')
    expect(created.standalone).toBe(true)
  })

  test('selects a workspace through preload and persists desktop settings', async () => {
    const openedPaths: string[] = []
    let storedSettings: unknown = null
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const params = body?.params ?? {}
      if (body?.method === 'initialize') return rpc(body.id, initializedResult())
      if (body?.method === 'initialized') return new Response(null, { status: 204 })
      if (body?.method === 'project/list') {
        return rpc(body.id, { projects: [project], nextCursor: null })
      }
      if (body?.method === 'project/open') {
        openedPaths.push(params.projectId)
        return rpc(body.id, { project })
      }
      throw new Error(`Unhandled RPC method: ${body?.method}`)
    }
    const client = createDesktopClient({
      fetch: fetcher,
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => projectRootPath,
          getDesktopSettings: async () => storedSettings,
          saveDesktopSettings: async settings => {
            storedSettings = settings
            return settings
          },
        },
      },
    })

    const selected = await client.chooseWorkspace()
    expect(selected).toEqual({
      id: project.id,
      path: projectRootPath,
      name: project.name,
      branchName: null,
      lastOpenedAt: '2023-11-14T22:13:20.000Z',
      projectId: project.id,
      projectVersion: project.updatedAt,
      primaryFolderId: primaryFolder.id,
      folders: [primaryFolder],
      projectSettings: project.settings,
    })
    await client.openWorkspace(projectRootPath)
    await client.getWorkspaceContext(projectRootPath)
    expect(openedPaths).toEqual([
      project.id,
      project.id,
      project.id,
    ])

    const defaults = await client.getDesktopSettings()
    expect(defaults.recentWorkspaces).toEqual([])
    expect(defaults.defaultModeRequestUserInput).toBe(false)
    const saved = await client.saveDesktopSettings({
      ...defaults,
      recentWorkspaces: [selected!],
      lastActiveWorkspacePath: projectRootPath,
      defaultModeRequestUserInput: true,
    })
    expect(saved.lastActiveWorkspacePath).toBe(projectRootPath)
    expect(saved.defaultModeRequestUserInput).toBe(true)
    const restored = await client.getDesktopSettings()
    expect(restored.recentWorkspaces).toHaveLength(1)
    expect(restored.recentWorkspaces[0]).toMatchObject({
      path: projectRootPath,
      name: project.name,
      projectId: project.id,
      primaryFolderId: primaryFolder.id,
      folders: [primaryFolder],
      projectSettings: project.settings,
    })
    expect(restored.defaultModeRequestUserInput).toBe(true)
  })

  test('coalesces identical desktop settings saves and serializes distinct snapshots', async () => {
    const savedSessionNames: Array<string | undefined> = []
    let releaseFirstSave: (() => void) | undefined
    const firstSaveGate = new Promise<void>(resolve => {
      releaseFirstSave = resolve
    })
    let failRetryOnce = true
    const client = createDesktopClient({
      window: {
        codePilotXDesktop: {
          getDesktopSettings: async () => null,
          saveDesktopSettings: async settings => {
            savedSessionNames.push(settings.sessionName)
            if (settings.sessionName === 'first') await firstSaveGate
            if (settings.sessionName === 'retry' && failRetryOnce) {
              failRetryOnce = false
              throw new Error('retryable save failure')
            }
            return settings
          },
        },
      },
    })
    const defaults = await client.getDesktopSettings()
    const firstSnapshot = { ...defaults, sessionName: 'first' }
    const secondSnapshot = { ...defaults, sessionName: 'second' }

    const firstSave = client.saveDesktopSettings(firstSnapshot)
    const duplicateSave = client.saveDesktopSettings({ ...firstSnapshot })
    const secondSave = client.saveDesktopSettings(secondSnapshot)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(savedSessionNames).toEqual(['first'])

    releaseFirstSave?.()
    expect(await firstSave).toEqual(await duplicateSave)
    expect((await secondSave).sessionName).toBe('second')
    expect(savedSessionNames).toEqual(['first', 'second'])

    await expect(client.saveDesktopSettings({
      ...defaults,
      sessionName: 'retry',
    })).rejects.toThrow('retryable save failure')
    expect((await client.saveDesktopSettings({
      ...defaults,
      sessionName: 'retry',
    })).sessionName).toBe('retry')
    expect(savedSessionNames).toEqual(['first', 'second', 'retry', 'retry'])
  })

  test('does not open a project when workspace selection is cancelled', async () => {
    const client = createDesktopClient({
      fetch: async () => {
        throw new Error('RPC should not be called')
      },
      window: {
        codePilotXDesktop: {
          pickWorkspaceDirectory: async () => null,
        },
      },
    })

    expect(await client.chooseWorkspace()).toBeNull()
  })
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rpc(id: string | number, result: unknown): Response {
  return json({ jsonrpc: '2.0', id, result })
}

function snapshotResult(snapshot: ThreadSnapshot) {
  return {
    snapshot,
    streamPosition: {
      streamId: snapshot.thread.id,
      sequence: 1,
    },
  }
}

function initializedResult() {
  return {
    protocol: 'thread-rpc-v4',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}
