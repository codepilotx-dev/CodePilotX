import type { DesktopSessionCatalogStatus, DesktopSessionSnapshot } from '../shared/types.js'
import {
  createDesktopSessionSnapshot,
  createLightweightDesktopSessionSnapshot,
} from './sessionPersistence.js'
import type { Thread } from './rustAppServerProtocol/index.js'

export const DESKTOP_SESSION_CATALOG_UNAVAILABLE_MESSAGE =
  'The app-server is unavailable. Please try again.'

/** Injectable app-server catalog boundary; production uses RustAppServerControlService. */
export type DesktopSessionCatalogService = {
  listAllThreads(options: { archived: boolean }): Promise<Thread[]>
  archiveThread(threadId: string): Promise<unknown>
  unarchiveThread(threadId: string): Promise<unknown>
  deleteThread(threadId: string): Promise<unknown>
  setThreadName(threadId: string, name: string): Promise<unknown>
}

export type DesktopSessionCatalogResult = {
  sessions: DesktopSessionSnapshot[]
  removeLocalSessionIds: string[]
  status: DesktopSessionCatalogStatus
}

/**
 * Projects app-server Threads into desktop snapshots. It deliberately does not
 * persist anything: the main process applies the result atomically after a
 * successful list, which keeps this class straightforward to test without a
 * Rust binary or SQLite database.
 */
export class DesktopSessionCatalog {
  private status: DesktopSessionCatalogStatus = { state: 'loading', error: null }

  constructor(private readonly service: DesktopSessionCatalogService) {}

  getStatus(): DesktopSessionCatalogStatus {
    return this.status
  }

  getControlService(): DesktopSessionCatalogService {
    return this.service
  }

  async list(options: {
    archived: boolean
    localSnapshots: DesktopSessionSnapshot[]
  }): Promise<DesktopSessionCatalogResult> {
    this.status = { state: 'loading', error: null }
    try {
      const threads = await this.service.listAllThreads({ archived: options.archived })
      const snapshotsByThreadId = new Map<string, DesktopSessionSnapshot>()
      for (const snapshot of options.localSnapshots) {
        const threadId = snapshot.appServerThreadId ?? snapshot.item.appServerThreadId
        if (threadId) snapshotsByThreadId.set(threadId, snapshot)
      }

      const result = threads.map(thread => {
        const existing = snapshotsByThreadId.get(thread.id)
        return createLightweightDesktopSessionSnapshot(
          existing
            ? applyThreadToSnapshot(existing, thread, options.archived)
          : snapshotFromThread(thread, options.archived),
        )
      })
      if (!options.archived) {
        result.push(
          ...options.localSnapshots
            .filter(
              snapshot =>
                snapshot.appServerThreadPending === true &&
                !(snapshot.appServerThreadId ?? snapshot.item.appServerThreadId),
            )
            .map(createLightweightDesktopSessionSnapshot),
        )
      }
      this.status = { state: 'ready', error: null }
      return {
        sessions: result,
        removeLocalSessionIds: localSessionIdsToRemove(
          options.localSnapshots,
          threads,
          options.archived,
        ),
        status: this.status,
      }
    } catch {
      this.status = {
        state: 'unavailable',
        error: DESKTOP_SESSION_CATALOG_UNAVAILABLE_MESSAGE,
      }
      return { sessions: [], removeLocalSessionIds: [], status: this.status }
    }
  }
}

function localSessionIdsToRemove(
  localSnapshots: DesktopSessionSnapshot[],
  threads: Thread[],
  archived: boolean,
): string[] {
  const serverThreadIds = new Set(threads.map(thread => thread.id))
  return localSnapshots.flatMap(snapshot => {
    const threadId = snapshot.appServerThreadId ?? snapshot.item.appServerThreadId
    if (!threadId) {
      return snapshot.appServerThreadPending === true ? [] : [snapshot.item.id]
    }
    const belongsToRequestedScope = Boolean(snapshot.item.archivedAt) === archived
    return belongsToRequestedScope && !serverThreadIds.has(threadId)
      ? [snapshot.item.id]
      : []
  })
}

function snapshotFromThread(thread: Thread, archived: boolean): DesktopSessionSnapshot {
  const workspacePath = String(thread.cwd)
  const snapshot = createDesktopSessionSnapshot({
    sessionId: `app-server:${thread.id}`,
    appServerThreadId: thread.id,
    workspace: {
      path: workspacePath,
      name: workspaceName(workspacePath),
      branchName: null,
      isGitRepo: false,
    },
    standalone: false,
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })
  return applyThreadToSnapshot(snapshot, thread, archived)
}

function applyThreadToSnapshot(
  snapshot: DesktopSessionSnapshot,
  thread: Thread,
  archived: boolean,
): DesktopSessionSnapshot {
  const updatedAt = toIsoTimestamp(thread.updatedAt)
  const createdAt = toIsoTimestamp(thread.createdAt)
  const workspacePath = String(thread.cwd)
  return {
    ...snapshot,
    appServerThreadId: thread.id,
    item: {
      ...snapshot.item,
      appServerThreadId: thread.id,
      sessionName: thread.name,
      firstPrompt: thread.preview || null,
      workspacePath,
      workspaceName: workspaceName(workspacePath),
      archivedAt: archived ? updatedAt : null,
      status: desktopStatus(thread),
      lastMessageAt: updatedAt,
      createdAt,
    },
    workspace: {
      ...snapshot.workspace,
      path: workspacePath,
      name: workspaceName(workspacePath),
    },
    updatedAt,
  }
}

function desktopStatus(thread: Thread): DesktopSessionSnapshot['item']['status'] {
  if (thread.status.type === 'active') {
    return thread.status.activeFlags.includes('waitingOnApproval') ||
      thread.status.activeFlags.includes('waitingOnUserInput')
      ? 'waiting'
      : 'running'
  }
  return thread.status.type === 'systemError' ? 'error' : 'idle'
}

function toIsoTimestamp(value: number): string {
  return new Date(value).toISOString()
}

function workspaceName(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) || normalized : normalized || 'Workspace'
}
