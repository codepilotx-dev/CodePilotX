import type { EventEnvelope } from '@codepilotx/agent-protocol'

const THREAD_CATALOG_EVENT_TYPES: ReadonlySet<EventEnvelope['type']> = new Set([
  'thread/created',
  'thread/updated',
  'thread/settings/updated',
  'turn/queued',
  'queue/updated',
  'turn/started',
  'turn/statusChanged',
  'turn/completed',
  'turn/failed',
  'turn/interrupted',
  'item/completed',
  'turn/plan/updated',
  'approval/requested',
  'permission/requested',
  'interaction/resolved',
  'question/requested',
  'hook/trust/requested',
  'hook/trust/resolved',
])

export type SessionCatalogCoordinatorHandlers = {
  onCatalogUpdated: () => void
  onProviderCredentialUpdated: () => void
  onConfigUpdated: (payload: unknown) => void
  onWorkspaceFileChanged: (payload: unknown) => void
  onWorkspaceGitChanged: (payload: unknown) => void
  refreshThreads: (threadIds: readonly string[]) => Promise<void>
}

/**
 * Routes global events to catalog reconciliation without retaining timeline,
 * message, tool, or interaction bodies. Active thread content is owned by the
 * canonical projection coordinator.
 */
export class SessionCatalogCoordinator {
  readonly #handlers: SessionCatalogCoordinatorHandlers

  constructor(handlers: SessionCatalogCoordinatorHandlers) {
    this.#handlers = handlers
  }

  async deliverBatch(events: readonly EventEnvelope[]): Promise<void> {
    const threadIds = new Set<string>()
    for (const event of events) {
      switch (event.type) {
        case 'catalog/updated':
          this.#handlers.onCatalogUpdated()
          break
        case 'provider/credential/updated':
          this.#handlers.onProviderCredentialUpdated()
          break
        case 'config/updated':
          this.#handlers.onConfigUpdated(event.payload)
          break
        case 'workspace/file/changed':
          this.#handlers.onWorkspaceFileChanged(event.payload)
          break
        case 'workspace/git/changed':
          this.#handlers.onWorkspaceGitChanged(event.payload)
          break
      }
      if (THREAD_CATALOG_EVENT_TYPES.has(event.type)) {
        const threadId = catalogThreadId(event)
        if (threadId) threadIds.add(threadId)
      }
    }
    if (threadIds.size > 0) {
      await this.#handlers.refreshThreads([...threadIds])
    }
  }
}

function catalogThreadId(event: EventEnvelope): string | null {
  switch (event.type) {
    case 'thread/created':
    case 'thread/updated':
      return event.payload.thread.id
    case 'thread/settings/updated':
      return event.payload.threadId
    default:
      return event.threadId ?? null
  }
}
