import { describe, expect, test } from 'bun:test'
import type { Thread } from './rustAppServerProtocol/index.js'
import {
  DesktopSessionCatalog,
  type DesktopSessionCatalogService,
} from './desktopSessionCatalog.js'
import { createDesktopSessionSnapshot } from './sessionPersistence.js'

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    sessionId: id,
    preview: `preview-${id}`,
    ephemeral: false,
    modelProvider: 'test-provider',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    status: { type: 'idle' },
    cwd: 'D:/workspace',
    turns: [],
    name: `Thread ${id}`,
    ...overrides,
  }
}

function snapshot(id: string, appServerThreadId: string | null) {
  return createDesktopSessionSnapshot({
    sessionId: id,
    appServerThreadId,
    workspace: {
      path: 'D:/workspace',
      name: 'workspace',
      isGitRepo: true,
      branchName: null,
    },
    standalone: false,
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })
}

function service(
  listThreads: DesktopSessionCatalogService['listAllThreads'],
): DesktopSessionCatalogService {
  return {
    listAllThreads: listThreads,
    archiveThread: async () => ({}),
    unarchiveThread: async () => ({ thread: thread('unused') }),
    deleteThread: async () => ({}),
    setThreadName: async () => ({}),
  }
}

describe('DesktopSessionCatalog', () => {
  test('uses paginated app-server threads as the active catalog and preserves matching overlay state', async () => {
    const existing = snapshot('desktop-1', 'thread-1')
    existing.item.pinnedAt = '2026-01-01T00:00:00.000Z'
    existing.item.unreadAt = '2026-01-02T00:00:00.000Z'
    const legacy = snapshot('legacy-1', null)
    const pending = {
      ...snapshot('pending-1', null),
      appServerThreadPending: true,
    }
    const catalog = new DesktopSessionCatalog(
      service(async ({ archived }) => {
        expect(archived).toBe(false)
        return [thread('thread-1', { name: 'Server title' }), thread('thread-2')]
      }),
    )

    const result = await catalog.list({
      archived: false,
      localSnapshots: [existing, legacy, pending],
    })

    expect(result.status).toEqual({ state: 'ready', error: null })
    expect(result.removeLocalSessionIds).toEqual(['legacy-1'])
    expect(result.sessions.map(item => item.item.id)).toEqual([
      'desktop-1',
      'app-server:thread-2',
      'pending-1',
    ])
    expect(result.sessions[0]?.item.pinnedAt).toBe(existing.item.pinnedAt)
    expect(result.sessions[0]?.item.unreadAt).toBe(existing.item.unreadAt)
    expect(result.sessions[0]?.item.sessionName).toBe('Server title')
    expect(result.sessions[1]?.appServerThreadId).toBe('thread-2')
    expect(result.sessions[1]?.item.firstPrompt).toBe('preview-thread-2')
    expect(result.sessions[2]?.appServerThreadPending).toBe(true)
  })

  test('only removes stale Thread mappings from the requested catalog scope', async () => {
    const active = snapshot('active', 'active-thread')
    const staleActive = snapshot('stale-active', 'missing-active-thread')
    const archived = snapshot('archived', 'archived-thread')
    archived.item.archivedAt = '2026-01-01T00:00:00.000Z'
    const staleArchived = snapshot('stale-archived', 'missing-archived-thread')
    staleArchived.item.archivedAt = '2026-01-01T00:00:00.000Z'
    const catalog = new DesktopSessionCatalog(
      service(async () => [thread('active-thread')]),
    )

    const activeResult = await catalog.list({
      archived: false,
      localSnapshots: [active, staleActive, archived, staleArchived],
    })

    expect(activeResult.removeLocalSessionIds).toEqual(['stale-active'])
  })

  test('returns an empty catalog and caller-safe unavailable status when app-server listing fails', async () => {
    const catalog = new DesktopSessionCatalog(
      service(async () => {
        throw new Error('Bearer secret must not reach the renderer')
      }),
    )

    const pending = catalog.list({ archived: false, localSnapshots: [] })
    expect(catalog.getStatus()).toEqual({ state: 'loading', error: null })
    const result = await pending

    expect(result.sessions).toEqual([])
    expect(result.removeLocalSessionIds).toEqual([])
    expect(result.status).toEqual({
      state: 'unavailable',
      error: 'The app-server is unavailable. Please try again.',
    })
  })

  test('maps archived server threads into lightweight archived snapshots', async () => {
    const catalog = new DesktopSessionCatalog(
      service(async ({ archived }) => {
        expect(archived).toBe(true)
        return [thread('archived-thread')]
      }),
    )

    const result = await catalog.list({ archived: true, localSnapshots: [] })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.item.id).toBe('app-server:archived-thread')
    expect(result.sessions[0]?.item.archivedAt).toBe('2023-11-14T22:13:21.000Z')
  })
})
