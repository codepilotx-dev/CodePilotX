import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@codepilotx/agent-protocol'
import { SessionCatalogCoordinator } from '../src/services/desktop-client/SessionCatalogCoordinator.js'

describe('SessionCatalogCoordinator', () => {
  test('deduplicates list-level thread refreshes and waits for the catalog commit', async () => {
    let releaseRefresh = () => {}
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })
    const refreshed: string[][] = []
    let providerUpdates = 0
    const coordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {},
      onProviderCredentialUpdated: () => {
        providerUpdates += 1
      },
      onConfigUpdated: () => {},
      onWorkspaceFileChanged: () => {},
      onWorkspaceGitChanged: () => {},
      refreshThreads: async threadIds => {
        refreshed.push([...threadIds])
        await refreshGate
      },
    })

    let committed = false
    const delivery = coordinator.deliverBatch([
      threadEvent('thread/created', 'event-1'),
      threadEvent('thread/updated', 'event-2'),
      providerCredentialEvent(),
    ]).then(() => {
      committed = true
    })

    await Promise.resolve()
    expect(refreshed).toEqual([['thread-1']])
    expect(providerUpdates).toBe(1)
    expect(committed).toBe(false)

    releaseRefresh()
    await delivery
    expect(committed).toBe(true)
  })
})

function threadEvent(
  type: 'thread/created' | 'thread/updated',
  eventId: string,
): EventEnvelope {
  const thread = {
    id: 'thread-1',
    title: 'Thread',
    projectID: null,
    gitBranch: null,
    settings: {
      taskMode: 'chat' as const,
      permissionConfig: {
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        approvalsReviewer: 'user' as const,
      },
    },
    createdAt: 1,
    updatedAt: 2,
  }
  if (type === 'thread/created') {
    return {
      eventId,
      streamId: 'global',
      type,
      version: 1,
      occurredAt: 2,
      durability: 'durable',
      sequence: eventId === 'event-1' ? 1 : 2,
      payload: { thread },
    }
  }
  return {
    eventId,
    streamId: 'global',
    type,
    version: 1,
    occurredAt: 2,
    durability: 'durable',
    sequence: eventId === 'event-1' ? 1 : 2,
    payload: { thread, version: 1 },
  }
}

function providerCredentialEvent(): EventEnvelope {
  return {
    eventId: 'provider-event-1',
    streamId: 'global',
    type: 'provider/credential/updated',
    version: 1,
    occurredAt: 2,
    durability: 'live',
    sequence: null,
    afterSequence: 2,
    payload: { providerId: 'openai' },
  }
}
