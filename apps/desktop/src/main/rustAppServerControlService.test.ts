import { describe, expect, test } from 'bun:test'
import type {
  InitializeParams,
  InitializeResponse,
  Thread,
  ThreadListParams,
  ThreadListResponse,
} from './rustAppServerProtocol/index.js'
import {
  RUST_APP_SERVER_CONTROL_ERROR_MESSAGE,
  RustAppServerControlError,
  RustAppServerControlService,
  redactRustAppServerControlDiagnostic,
  type RustAppServerControlClient,
} from './rustAppServerControlService.js'

function thread(id: string): Thread {
  return {
    id,
    sessionId: id,
    preview: '',
    ephemeral: false,
    modelProvider: 'test-provider',
    createdAt: 1,
    updatedAt: 1,
    status: { type: 'idle' },
    cwd: 'D:/workspace',
    turns: [],
    name: null,
  }
}

type Calls = {
  initialized: number
  initialize: InitializeParams[]
  lists: ThreadListParams[]
  archives: string[]
  unarchives: string[]
  deletes: string[]
  names: Array<{ threadId: string; name: string }>
  disposes: number
}

function createClient(
  calls: Calls,
  list: (params: ThreadListParams) => Promise<ThreadListResponse>,
): RustAppServerControlClient {
  return {
    initialize: async params => {
      calls.initialize.push(params)
      return {
        userAgent: 'test-app-server',
        codexHome: 'D:/config',
        platformFamily: 'windows',
        platformOs: 'windows',
      } as InitializeResponse
    },
    notifyInitialized: () => {
      calls.initialized += 1
    },
    listThreads: async params => {
      calls.lists.push(params)
      return list(params)
    },
    archiveThread: async ({ threadId }) => {
      calls.archives.push(threadId)
      return {}
    },
    unarchiveThread: async ({ threadId }) => {
      calls.unarchives.push(threadId)
      return { thread: thread(threadId) }
    },
    deleteThread: async ({ threadId }) => {
      calls.deletes.push(threadId)
      return {}
    },
    setThreadName: async ({ threadId, name }) => {
      calls.names.push({ threadId, name })
      return {}
    },
  }
}

function createService(
  list: (params: ThreadListParams) => Promise<ThreadListResponse>,
  options: {
    timeoutMs?: number
    configureClient?: (client: RustAppServerControlClient) => void
    openConnection?: () => Promise<{
      client: RustAppServerControlClient
      dispose(): Promise<void>
    }>
  } = {},
): { service: RustAppServerControlService; calls: Calls } {
  const calls: Calls = {
    initialized: 0,
    initialize: [],
    lists: [],
    archives: [],
    unarchives: [],
    deletes: [],
    names: [],
    disposes: 0,
  }
  const client = createClient(calls, list)
  options.configureClient?.(client)
  const service = new RustAppServerControlService({
    context: {
      sessionId: 'control-session',
      workspacePath: 'D:/workspace',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    openConnection: options.openConnection ?? (async () => ({
      client,
      dispose: async () => {
        calls.disposes += 1
      },
    })),
  })
  return { service, calls }
}

describe('RustAppServerControlService', () => {
  test('lists every page after initializing a control-only connection', async () => {
    const { service, calls } = createService(async params => {
      if (!params.cursor) {
        return { data: [thread('thread-1')], nextCursor: 'next-1', backwardsCursor: null }
      }
      return { data: [thread('thread-2')], nextCursor: null, backwardsCursor: null }
    })

    await expect(service.listAllThreads({ archived: true })).resolves.toEqual([
      thread('thread-1'),
      thread('thread-2'),
    ])
    expect(calls.initialize).toHaveLength(1)
    expect(calls.initialize[0]?.capabilities.experimentalApi).toBe(true)
    expect(calls.initialized).toBe(1)
    expect(calls.lists).toEqual([
      { archived: true, cursor: null },
      { archived: true, cursor: 'next-1' },
    ])
    expect(calls.disposes).toBe(1)
  })

  test('disposes the short-lived connection after each lifecycle operation', async () => {
    const { service, calls } = createService(async () => ({
      data: [],
      nextCursor: null,
      backwardsCursor: null,
    }))

    await service.archiveThread('thread-1')
    await service.unarchiveThread('thread-1')
    await service.deleteThread('thread-1')
    await service.setThreadName('thread-1', 'New name')

    expect(calls.archives).toEqual(['thread-1'])
    expect(calls.unarchives).toEqual(['thread-1'])
    expect(calls.deletes).toEqual(['thread-1'])
    expect(calls.names).toEqual([{ threadId: 'thread-1', name: 'New name' }])
    expect(calls.disposes).toBe(4)
    expect(calls.initialized).toBe(4)
  })

  test('wraps app-server failures with an identifiable control error and disposes', async () => {
    const calls: Calls = {
      initialized: 0,
      initialize: [],
      lists: [],
      archives: [],
      unarchives: [],
      deletes: [],
      names: [],
      disposes: 0,
    }
    const service = new RustAppServerControlService({
      context: {
        sessionId: 'control-session',
        workspacePath: 'D:/workspace',
        emit: () => {},
        requestPermission: async () => ({ behavior: 'deny' }),
      },
      openConnection: async () => ({
        client: createClient(calls, async () => {
          throw new Error('app-server is unavailable')
        }),
        dispose: async () => {
          calls.disposes += 1
        },
      }),
    })

    await expect(service.listAllThreads({ archived: false })).rejects.toMatchObject({
      name: 'RustAppServerControlError',
      code: 'app-server-control-failed',
      operation: 'thread/list',
    } satisfies Partial<RustAppServerControlError>)
    expect(calls.disposes).toBe(1)
  })

  test('rejects a connection startup failure instead of swallowing it in cleanup', async () => {
    const { service } = createService(
      async () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      {
        openConnection: async () => {
          throw new Error('Bearer startup-secret')
        },
      },
    )

    await expect(service.listAllThreads({ archived: false })).rejects.toMatchObject({
      name: 'RustAppServerControlError',
      code: 'app-server-control-failed',
      operation: 'thread/list',
      message: RUST_APP_SERVER_CONTROL_ERROR_MESSAGE,
    } satisfies Partial<RustAppServerControlError>)
  })

  test('rejects and disposes after initialization times out', async () => {
    const { service, calls } = createService(
      async () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      {
        timeoutMs: 5,
        configureClient: client => {
          client.initialize = () => new Promise<InitializeResponse>(() => {})
        },
      },
    )

    await expect(service.listAllThreads({ archived: false })).rejects.toMatchObject({
      name: 'RustAppServerControlError',
      message: RUST_APP_SERVER_CONTROL_ERROR_MESSAGE,
    } satisfies Partial<RustAppServerControlError>)
    expect(calls.disposes).toBe(1)
  })

  test('rejects and disposes after a control request times out', async () => {
    const { service, calls } = createService(
      () => new Promise<ThreadListResponse>(() => {}),
      { timeoutMs: 5 },
    )

    await expect(service.listAllThreads({ archived: false })).rejects.toMatchObject({
      name: 'RustAppServerControlError',
      message: RUST_APP_SERVER_CONTROL_ERROR_MESSAGE,
    } satisfies Partial<RustAppServerControlError>)
    expect(calls.disposes).toBe(1)
  })

  test('rejects a repeated pagination cursor instead of looping indefinitely', async () => {
    const { service, calls } = createService(async () => ({
      data: [thread('thread-1')],
      nextCursor: 'repeat',
      backwardsCursor: null,
    }))

    await expect(service.listAllThreads({ archived: false })).rejects.toMatchObject({
      name: 'RustAppServerControlError',
      operation: 'thread/list',
      message: RUST_APP_SERVER_CONTROL_ERROR_MESSAGE,
    } satisfies Partial<RustAppServerControlError>)
    expect(calls.lists).toEqual([
      { archived: false, cursor: null },
      { archived: false, cursor: 'repeat' },
    ])
    expect(calls.disposes).toBe(1)
  })

  test('uses a fixed caller-safe error message and redacts credentials from diagnostics', () => {
    const error = new RustAppServerControlError(
      'thread/list',
      new Error('Bearer bearer-secret sk-secret-value api-key=key-secret token: token-secret'),
    )
    const diagnostic = redactRustAppServerControlDiagnostic(
      'Bearer bearer-secret sk-secret-value api-key=key-secret token: token-secret',
    )

    expect(error.message).toBe(RUST_APP_SERVER_CONTROL_ERROR_MESSAGE)
    expect(JSON.stringify(error)).not.toContain('bearer-secret')
    expect(diagnostic).not.toContain('bearer-secret')
    expect(diagnostic).not.toContain('sk-secret-value')
    expect(diagnostic).not.toContain('key-secret')
    expect(diagnostic).not.toContain('token-secret')
  })
})
